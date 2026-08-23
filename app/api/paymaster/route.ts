import {
  createIpRateLimiter,
  rateLimitHeaders,
  type RateLimitResult,
} from "@/lib/server/ipRateLimit";

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

const paymasterRateLimiter = createIpRateLimiter({
  namespace: "paymaster",
  cloudflareHosts: ["bulksender.rakibhq.xyz", "multisender.online", "www.multisender.online"],
  burst: { windowMs: 10_000, max: 30 },
  sustained: { windowMs: 10 * 60_000, max: 240 },
  burstBlockMs: 30_000,
  idleTtlMs: 20 * 60_000,
  cleanupIntervalMs: 60_000,
  maxEntries: 10_000,
});

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
  const rateLimit = paymasterRateLimiter.consume(req, 1);
  if (!rateLimit.allowed) return rateLimitedResponse(rateLimit);
  return new Response(null, {
    status: 204,
    headers: { ...corsHeaders, ...rateLimitHeaders(rateLimit) },
  });
}

export async function POST(req: Request) {
  let rateLimit = paymasterRateLimiter.consume(req, 1);
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
    rateLimit = paymasterRateLimiter.consume(req, operationCost - 1);
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
