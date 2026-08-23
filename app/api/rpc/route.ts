import {
  createIpRateLimiter,
  rateLimitHeaders,
  requestHostname,
  type RateLimitResult,
} from "@/lib/server/ipRateLimit";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_BATCH_SIZE = 20;
const UPSTREAM_TIMEOUT_MS = 20_000;

const rpcRateLimiter = createIpRateLimiter({
  namespace: "base-rpc",
  cloudflareHosts: ["bulksender.rakibhq.xyz", "multisender.online", "www.multisender.online"],
  burst: { windowMs: 10_000, max: 60 },
  sustained: { windowMs: 10 * 60_000, max: 1_200 },
  burstBlockMs: 30_000,
  maxEntries: 10_000,
});

// Only methods used by the app's Viem public client are exposed. Wallet-only,
// transaction relay, debug, trace, admin, and subscription methods stay private.
const ALLOWED_RPC_METHODS = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_chainId",
  "eth_estimateGas",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_getBalance",
  "eth_getBlockByHash",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getTransactionByHash",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_maxPriorityFeePerGas",
]);

const baseHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const;

function requestOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  try {
    return new URL(origin);
  } catch {
    return null;
  }
}

function isAllowedOrigin(req: Request) {
  const originHeader = req.headers.get("origin");
  if (!originHeader) return true;
  const origin = requestOrigin(req);
  return Boolean(origin && origin.host.toLowerCase() === requestHostname(req));
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = requestOrigin(req);
  if (!origin || origin.host.toLowerCase() !== requestHostname(req)) return {};
  return {
    "access-control-allow-origin": origin.origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
    vary: "origin",
  };
}

function jsonResponse(
  req: Request,
  status: number,
  body: Record<string, unknown>,
  rateLimit?: RateLimitResult,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...baseHeaders,
      ...corsHeaders(req),
      ...(rateLimit ? rateLimitHeaders(rateLimit) : {}),
    },
  });
}

function rateLimitedResponse(req: Request, result: RateLimitResult) {
  return jsonResponse(
    req,
    429,
    { error: "Too many RPC requests", retryAfter: result.retryAfterSeconds },
    result,
  );
}

function rpcRequestCost(method: string) {
  if (method === "eth_estimateGas" || method === "eth_call") return 3;
  if (method === "eth_getBlockByHash" || method === "eth_getBlockByNumber") return 2;
  return 1;
}

function privateRpcUrl() {
  const raw = process.env.BASE_RPC_URL?.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:")) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export async function OPTIONS(req: Request) {
  const rateLimit = rpcRateLimiter.consume(req, 1);
  if (!rateLimit.allowed) return rateLimitedResponse(req, rateLimit);
  if (!isAllowedOrigin(req)) return jsonResponse(req, 403, { error: "Cross-origin RPC access is forbidden" }, rateLimit);

  return new Response(null, {
    status: 204,
    headers: {
      ...baseHeaders,
      ...corsHeaders(req),
      ...rateLimitHeaders(rateLimit),
    },
  });
}

export async function POST(req: Request) {
  let rateLimit = rpcRateLimiter.consume(req, 1);
  if (!rateLimit.allowed) return rateLimitedResponse(req, rateLimit);
  if (!isAllowedOrigin(req)) return jsonResponse(req, 403, { error: "Cross-origin RPC access is forbidden" }, rateLimit);

  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return jsonResponse(req, 415, { error: "Content-Type must be application/json" }, rateLimit);
  }

  const contentLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return jsonResponse(req, 413, { error: "RPC request body too large" }, rateLimit);
  }

  const bodyText = await req.text();
  if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) {
    return jsonResponse(req, 413, { error: "RPC request body too large" }, rateLimit);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return jsonResponse(req, 400, { error: "Invalid JSON" }, rateLimit);
  }

  const requests = Array.isArray(payload) ? payload : [payload];
  if (requests.length === 0 || requests.length > MAX_BATCH_SIZE) {
    return jsonResponse(
      req,
      400,
      { error: `JSON-RPC batch must contain 1-${MAX_BATCH_SIZE} requests` },
      rateLimit,
    );
  }

  let operationCost = 0;
  for (const request of requests) {
    if (!request || typeof request !== "object" || Array.isArray(request)) {
      return jsonResponse(req, 400, { error: "Invalid JSON-RPC request" }, rateLimit);
    }

    const rpcRequest = request as { jsonrpc?: unknown; method?: unknown; params?: unknown };
    if (rpcRequest.jsonrpc !== "2.0") {
      return jsonResponse(req, 400, { error: "Only JSON-RPC 2.0 requests are supported" }, rateLimit);
    }

    const method = typeof rpcRequest.method === "string" ? rpcRequest.method : "";
    if (!ALLOWED_RPC_METHODS.has(method)) {
      return jsonResponse(req, 403, { error: "Forbidden JSON-RPC method" }, rateLimit);
    }

    if (
      rpcRequest.params !== undefined &&
      !Array.isArray(rpcRequest.params) &&
      (typeof rpcRequest.params !== "object" || rpcRequest.params === null)
    ) {
      return jsonResponse(req, 400, { error: "Invalid JSON-RPC params" }, rateLimit);
    }

    operationCost += rpcRequestCost(method);
  }

  if (operationCost > 1) {
    rateLimit = rpcRateLimiter.consume(req, operationCost - 1);
    if (!rateLimit.allowed) return rateLimitedResponse(req, rateLimit);
  }

  const upstream = privateRpcUrl();
  if (!upstream) {
    return jsonResponse(req, 503, { error: "Private Base RPC is not configured" }, rateLimit);
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
        ...baseHeaders,
        ...corsHeaders(req),
        ...rateLimitHeaders(rateLimit),
      },
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return jsonResponse(
      req,
      timedOut ? 504 : 502,
      { error: timedOut ? "Private Base RPC timed out" : "Private Base RPC request failed" },
      rateLimit,
    );
  }
}
