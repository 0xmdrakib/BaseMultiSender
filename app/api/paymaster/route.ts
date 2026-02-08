export const runtime = "nodejs";

/**
 * CDP Paymaster & Bundler proxy.
 * - Keeps the CDP endpoint (and its Client API Key) server-side.
 * - Adds a small method allowlist to reduce abuse.
 *
 * Env:
 * - CDP_PAYMASTER_URL (server-only)
 */
const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
} as const;

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
  if (method.startsWith("pm_")) return true;
  if (ALLOWED_BUNDLER_METHODS.has(method)) return true;
  return false;
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(req: Request) {
  const upstream = process.env.CDP_PAYMASTER_URL;
  if (!upstream) return new Response("Missing CDP_PAYMASTER_URL", { status: 500, headers: corsHeaders });

  const bodyText = await req.text();

  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: corsHeaders });
  }

  const requests = Array.isArray(payload) ? payload : [payload];
  for (const r of requests as any[]) {
    const method = String(r?.method ?? "");
    if (!isAllowedMethod(method)) return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }

  const upstreamRes = await fetch(upstream, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: bodyText,
  });

  return new Response(await upstreamRes.text(), {
    status: upstreamRes.status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}
