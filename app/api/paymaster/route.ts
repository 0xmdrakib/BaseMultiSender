import { isIP } from "node:net";

export const runtime = "nodejs";

/**
 * CDP Paymaster & Bundler proxy.
 * - Keeps the CDP endpoint (and its Client API Key) server-side.
 * - Restricts forwarded JSON-RPC methods and payload sizes.
 * - Applies a best-effort, per-instance IP rate limit with burst protection.
 *
 * Env:
 * - CDP_PAYMASTER_URL (server-only)
 */
const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "600",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

const MAX_BODY_BYTES = 64 * 1024;
const MAX_BATCH_SIZE = 10;
const UPSTREAM_TIMEOUT_MS = 15_000;

// These are the public hosts that are expected to sit behind Cloudflare. On
// other hosts (including *.vercel.app previews), Vercel's trusted IP header is
// used so a caller cannot pick an arbitrary CF-Connecting-IP value.
const CLOUDFLARE_HOSTS = new Set([
  "bulksender.rakibhq.xyz",
  "multisender.online",
  "www.multisender.online",
]);

const RATE_LIMIT = {
  burst: { windowMs: 10_000, max: 30 },
  sustained: { windowMs: 10 * 60_000, max: 240 },
  burstBlockMs: 30_000,
  idleTtlMs: 20 * 60_000,
  cleanupIntervalMs: 60_000,
  maxEntries: 10_000,
} as const;

const OVERFLOW_RATE_LIMIT_KEY = "ip:overflow";

type Counter = {
  startedAt: number;
  count: number;
};

type ClientRateState = {
  burst: Counter;
  sustained: Counter;
  blockedUntil: number;
  lastSeen: number;
};

type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds?: number;
};

const rateLimitGlobal = globalThis as typeof globalThis & {
  __paymasterRateLimits?: Map<string, ClientRateState>;
  __paymasterRateLimitLastCleanup?: number;
};

const rateLimitStore =
  rateLimitGlobal.__paymasterRateLimits ??
  (rateLimitGlobal.__paymasterRateLimits = new Map<string, ClientRateState>());

const ALLOWED_BUNDLER_METHODS = new Set<string>([
  "eth_supportedEntryPoints",
  "eth_sendUserOperation",
  "eth_estimateUserOperationGas",
  "eth_getUserOperationReceipt",
  "eth_getUserOperationByHash",
  "eth_chainId",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_getUserOperationGasPrice",
]);

function isAllowedMethod(method: string) {
  return method.startsWith("pm_") || ALLOWED_BUNDLER_METHODS.has(method);
}

function normalizeIp(value: string | null) {
  if (!value) return null;

  let candidate = value.split(",", 1)[0]?.trim() ?? "";
  if (candidate.startsWith("[")) {
    const closingBracket = candidate.indexOf("]");
    if (closingBracket > 0) candidate = candidate.slice(1, closingBracket);
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/u.test(candidate)) {
    candidate = candidate.slice(0, candidate.lastIndexOf(":"));
  }

  // A zone identifier is useful locally but is not part of a public client IP.
  candidate = candidate.split("%", 1)[0] ?? "";
  return isIP(candidate) ? candidate.toLowerCase() : null;
}

function requestHostname(req: Request) {
  const value = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  return value.split(",", 1)[0]?.trim().toLowerCase().replace(/:\d+$/u, "") ?? "";
}

function clientKey(req: Request) {
  const hostname = requestHostname(req);
  if (CLOUDFLARE_HOSTS.has(hostname)) {
    const cloudflareIp = normalizeIp(req.headers.get("cf-connecting-ip"));
    if (cloudflareIp) return `ip:${cloudflareIp}`;
  }

  const vercelIp =
    normalizeIp(req.headers.get("x-vercel-forwarded-for")) ??
    normalizeIp(req.headers.get("x-forwarded-for")) ??
    normalizeIp(req.headers.get("x-real-ip"));

  // Vercel supplies an IP header in production. Keeping one shared fallback
  // bucket is safer than allowing unlimited requests when a proxy omits it.
  return `ip:${vercelIp ?? "unknown"}`;
}

function refreshCounter(counter: Counter, now: number, windowMs: number): Counter {
  if (now - counter.startedAt >= windowMs) return { startedAt: now, count: 0 };
  return counter;
}

function cleanupRateLimitStore(now: number) {
  const lastCleanup = rateLimitGlobal.__paymasterRateLimitLastCleanup ?? 0;
  if (now - lastCleanup < RATE_LIMIT.cleanupIntervalMs) return;
  rateLimitGlobal.__paymasterRateLimitLastCleanup = now;

  for (const [key, state] of rateLimitStore) {
    if (now - state.lastSeen >= RATE_LIMIT.idleTtlMs && now >= state.blockedUntil) {
      rateLimitStore.delete(key);
    }
  }

  // The map is insertion ordered. Active keys are moved to the end when used,
  // so this removes the least-recently-used entries if an attack fills the map.
  while (rateLimitStore.size > RATE_LIMIT.maxEntries) {
    const oldestKey = rateLimitStore.keys().next().value;
    if (typeof oldestKey !== "string") break;
    rateLimitStore.delete(oldestKey);
  }
}

function consumeRateLimit(key: string, cost: number): RateLimitResult {
  const now = Date.now();
  cleanupRateLimitStore(now);

  // Reserve the last slot for a shared overflow bucket. This keeps memory
  // bounded even if a botnet presents thousands of distinct client IPs.
  const effectiveKey =
    rateLimitStore.has(key) || rateLimitStore.size < RATE_LIMIT.maxEntries - 1
      ? key
      : OVERFLOW_RATE_LIMIT_KEY;

  const existing = rateLimitStore.get(effectiveKey);
  const state: ClientRateState = existing ?? {
    burst: { startedAt: now, count: 0 },
    sustained: { startedAt: now, count: 0 },
    blockedUntil: 0,
    lastSeen: now,
  };

  state.burst = refreshCounter(state.burst, now, RATE_LIMIT.burst.windowMs);
  state.sustained = refreshCounter(state.sustained, now, RATE_LIMIT.sustained.windowMs);
  state.lastSeen = now;

  if (state.blockedUntil > now) {
    touchRateLimitEntry(effectiveKey, state);
    return {
      allowed: false,
      limit: RATE_LIMIT.sustained.max,
      remaining: 0,
      resetAt: state.blockedUntil,
      retryAfterSeconds: Math.max(1, Math.ceil((state.blockedUntil - now) / 1000)),
    };
  }

  const normalizedCost = Math.max(1, Math.ceil(cost));
  const burstExceeded = state.burst.count + normalizedCost > RATE_LIMIT.burst.max;
  const sustainedExceeded = state.sustained.count + normalizedCost > RATE_LIMIT.sustained.max;

  if (burstExceeded || sustainedExceeded) {
    const sustainedResetAt = state.sustained.startedAt + RATE_LIMIT.sustained.windowMs;
    state.blockedUntil = sustainedExceeded
      ? sustainedResetAt
      : Math.max(now + RATE_LIMIT.burstBlockMs, state.burst.startedAt + RATE_LIMIT.burst.windowMs);
    touchRateLimitEntry(effectiveKey, state);

    return {
      allowed: false,
      limit: RATE_LIMIT.sustained.max,
      remaining: Math.max(0, RATE_LIMIT.sustained.max - state.sustained.count),
      resetAt: state.blockedUntil,
      retryAfterSeconds: Math.max(1, Math.ceil((state.blockedUntil - now) / 1000)),
    };
  }

  state.burst.count += normalizedCost;
  state.sustained.count += normalizedCost;
  touchRateLimitEntry(effectiveKey, state);

  return {
    allowed: true,
    limit: RATE_LIMIT.sustained.max,
    remaining: Math.max(0, RATE_LIMIT.sustained.max - state.sustained.count),
    resetAt: state.sustained.startedAt + RATE_LIMIT.sustained.windowMs,
  };
}

function touchRateLimitEntry(key: string, state: ClientRateState) {
  if (rateLimitStore.has(key)) rateLimitStore.delete(key);
  rateLimitStore.set(key, state);
}

function rateLimitHeaders(result: RateLimitResult) {
  const headers: Record<string, string> = {
    "x-ratelimit-limit": String(result.limit),
    "x-ratelimit-remaining": String(result.remaining),
    "x-ratelimit-reset": String(Math.ceil(result.resetAt / 1000)),
  };
  if (result.retryAfterSeconds) headers["retry-after"] = String(result.retryAfterSeconds);
  return headers;
}

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  rateLimit?: RateLimitResult,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders,
      ...(rateLimit ? rateLimitHeaders(rateLimit) : {}),
    },
  });
}

function rateLimitedResponse(result: RateLimitResult) {
  return jsonResponse(
    429,
    {
      error: "Too many requests",
      retryAfter: result.retryAfterSeconds,
    },
    result,
  );
}

function rpcRequestCost(method: string) {
  if (method === "eth_sendUserOperation") return 5;
  if (method === "eth_estimateUserOperationGas" || method.startsWith("pm_")) return 2;
  return 1;
}

export async function OPTIONS(req: Request) {
  const rateLimit = consumeRateLimit(clientKey(req), 1);
  if (!rateLimit.allowed) return rateLimitedResponse(rateLimit);
  return new Response(null, {
    status: 204,
    headers: { ...corsHeaders, ...rateLimitHeaders(rateLimit) },
  });
}

export async function POST(req: Request) {
  const key = clientKey(req);
  let rateLimit = consumeRateLimit(key, 1);
  if (!rateLimit.allowed) return rateLimitedResponse(rateLimit);

  const contentLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return jsonResponse(413, { error: "Request body too large" }, rateLimit);
  }

  const bodyText = await req.text();
  if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) {
    return jsonResponse(413, { error: "Request body too large" }, rateLimit);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return jsonResponse(400, { error: "Invalid JSON" }, rateLimit);
  }

  const requests = Array.isArray(payload) ? payload : [payload];
  if (requests.length === 0 || requests.length > MAX_BATCH_SIZE) {
    return jsonResponse(400, { error: `JSON-RPC batch must contain 1-${MAX_BATCH_SIZE} requests` }, rateLimit);
  }

  let operationCost = 0;
  for (const request of requests) {
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      return jsonResponse(400, { error: "Invalid JSON-RPC request" }, rateLimit);
    }

    const method = String((request as { method?: unknown }).method ?? "");
    if (method.length === 0 || method.length > 100) {
      return jsonResponse(400, { error: "Invalid JSON-RPC method" }, rateLimit);
    }
    if (!isAllowedMethod(method)) {
      return jsonResponse(403, { error: "Forbidden JSON-RPC method" }, rateLimit);
    }
    operationCost += rpcRequestCost(method);
  }

  // The initial request already consumed one point. Charge the rest only after
  // the payload has passed validation, so batches and expensive calls cost more.
  if (operationCost > 1) {
    rateLimit = consumeRateLimit(key, operationCost - 1);
    if (!rateLimit.allowed) return rateLimitedResponse(rateLimit);
  }

  const upstream = process.env.CDP_PAYMASTER_URL;
  if (!upstream) {
    return jsonResponse(503, { error: "Paymaster service is unavailable" }, rateLimit);
  }

  try {
    const upstreamRes = await fetch(upstream, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: bodyText,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: {
        "content-type": upstreamRes.headers.get("content-type") ?? "application/json",
        ...corsHeaders,
        ...rateLimitHeaders(rateLimit),
      },
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return jsonResponse(
      timedOut ? 504 : 502,
      { error: timedOut ? "Paymaster service timed out" : "Paymaster service request failed" },
      rateLimit,
    );
  }
}
