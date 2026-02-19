import type { Address, Hex } from "viem";

type RpcRequester = (args: { method: string; params?: unknown[] }) => Promise<any>;

function toHexChainId(chainId: number): Hex {
  return ("0x" + chainId.toString(16)) as Hex;
}

function toHexValue(value: bigint): Hex {
  return ("0x" + value.toString(16)) as Hex;
}

export function getRpcRequester(walletClient: any): RpcRequester {
  // Prefer a client-scoped requester (works for WalletConnect and injected connectors).
  if (walletClient?.request && typeof walletClient.request === "function") {
    return (args) => walletClient.request(args);
  }
  if (walletClient?.transport?.request && typeof walletClient.transport.request === "function") {
    return (args) => walletClient.transport.request(args);
  }

  // Last resort: injected provider.
  const injected = (globalThis as any)?.ethereum;
  if (injected?.request && typeof injected.request === "function") {
    return (args) => injected.request(args);
  }

  throw new Error("No EIP-1193 requester available (wallet not connected).");
}

export async function supportsPaymasterService(params: {
  request: RpcRequester;
  address: Address;
  chainId: number;
}): Promise<boolean> {
  const { request, address, chainId } = params;

  try {
    const caps = await request({ method: "wallet_getCapabilities", params: [address] });
    const chainHex = toHexChainId(chainId);

    // Wallets sometimes key by chainHex or by decimal chainId.
    const byHex = caps?.[chainHex];
    const byDec = caps?.[String(chainId)];
    const entry = byHex ?? byDec;

    return Boolean(entry?.paymasterService?.supported);
  } catch {
    // If the wallet doesn't implement EIP-5792, treat as unsupported.
    return false;
  }
}

export function isUserRejected(err: unknown): boolean {
  // Many libs (wagmi/viem/walletconnect) wrap the underlying ProviderRpcError.
  // Walk the "cause" chain + common nested fields to reliably detect user rejection.
  const seen = new Set<any>();

  const stack: any[] = [err];
  while (stack.length) {
    const e = stack.pop();
    if (!e || seen.has(e)) continue;
    seen.add(e);

    const code = (e as any)?.code;
    if (code === 4001) return true; // EIP-1193 user rejected request

    const msg = String((e as any)?.message ?? (e as any)?.shortMessage ?? "").toLowerCase();
    if (msg.includes("user rejected") || msg.includes("user denied") || msg.includes("rejected the request")) return true;

    // Common wrappers
    const cause = (e as any)?.cause;
    const data = (e as any)?.data;
    const details = (e as any)?.details;
    if (cause) stack.push(cause);
    if (data) stack.push(data);
    if (details) stack.push(details);

    // Some providers nest the original error here.
    const original = (e as any)?.data?.originalError || (e as any)?.originalError;
    if (original) stack.push(original);
  }

  return false;
}

function looksLikeUnsupportedSendCalls(err: unknown): boolean {
  const e = err as any;
  const msg = String(e?.message ?? "").toLowerCase();
  return (
    msg.includes("wallet_sendcalls") && msg.includes("not supported") ||
    msg.includes("method not found") ||
    msg.includes("unsupported method")
  );
}

function looksLikeVersionIssue(err: unknown): boolean {
  const e = err as any;
  // MetaMask and other wallets commonly use -32000 for "Version not supported" with wallet_sendCalls.
  if (e?.code === -32000) return true;
  const msg = String(e?.message ?? "").toLowerCase();
  return msg.includes("version not supported");
}

async function walletSendCalls(params: {
  request: RpcRequester;
  address: Address;
  chainIdHex: Hex;
  paymasterProxyUrl: string;
  calls: Array<{ to: Address; data: Hex; value?: bigint }>;
  version: "2.0.0" | "1.0";
}): Promise<string> {
  const { request, address, chainIdHex, paymasterProxyUrl, calls, version } = params;

  const id =
    (globalThis as any)?.crypto?.randomUUID?.() ??
    `calls-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // Base + MetaMask both support EIP-5792 style batching; Base's docs require version "2.0.0" and an id,
  // and many wallets behave better when value is always present (0x0 for no ETH). 
  const result = await request({
    method: "wallet_sendCalls",
    params: [
      {
        version,
        id,
        from: address,
        chainId: chainIdHex,
        atomicRequired: true,
        calls: calls.map((c) => ({
          to: c.to,
          data: c.data,
          value: toHexValue(typeof c.value === "bigint" ? c.value : 0n),
        })),
        capabilities: {
          paymasterService: { url: paymasterProxyUrl },
        },
      },
    ],
  });

  // Different wallets return slightly different shapes for the bundle identifier.
  const bundleId =
    typeof result === "string"
      ? result
      : result?.id ?? result?.batchId ?? result?.callsId;

  if (typeof bundleId !== "string" || bundleId.length === 0) {
    throw new Error("wallet_sendCalls returned an unexpected result shape (missing batch id).");
  }

  return bundleId;
}

export async function sendSponsoredCalls(params: {
  request: RpcRequester;
  address: Address;
  chainId: number;
  paymasterProxyUrl: string;
  calls: Array<{ to: Address; data: Hex; value?: bigint }>;
  pollIntervalMs?: number;
  timeoutMs?: number;
}): Promise<Hex> {
  const {
    request,
    address,
    chainId,
    paymasterProxyUrl,
    calls,
    pollIntervalMs = 800,
    timeoutMs = 60_000,
  } = params;

  const chainIdHex = toHexChainId(chainId);

  let id: string;
  try {
    id = await walletSendCalls({ request, address, chainIdHex, paymasterProxyUrl, calls, version: "2.0.0" });
  } catch (e) {
    // If the user cancels/rejects the wallet confirmation, DO NOT retry (otherwise they see a 2nd prompt).
    if (isUserRejected(e)) throw e;

    if (looksLikeUnsupportedSendCalls(e)) throw e;

    // Some wallets may only support an older draft; retry once only if the error clearly indicates version mismatch.
    if (looksLikeVersionIssue(e)) {
      id = await walletSendCalls({ request, address, chainIdHex, paymasterProxyUrl, calls, version: "1.0" });
    } else {
      throw e;
    }
  }

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = await request({ method: "wallet_getCallsStatus", params: [id] });

    // EIP-5792 defines status as numeric code: 1xx pending, 2xx confirmed, 4xx/5xx/6xx failures.
    // Some wallets may still return legacy strings; support both.
    const statusRaw = status?.status;
    const statusCode = typeof statusRaw === "number" ? statusRaw : Number(statusRaw);
    const legacyState = String(statusRaw ?? "").toUpperCase();

    const receipts = status?.receipts ?? [];
    const first = receipts?.[0];
    const hash: Hex | undefined =
      first?.transactionHash ??
      first?.transactionReceipt?.transactionHash ??
      status?.transactionHash;

    const looksConfirmed =
      (Number.isFinite(statusCode) && statusCode >= 200 && statusCode < 300) ||
      legacyState === "CONFIRMED";

    const looksFailed =
      (Number.isFinite(statusCode) && statusCode >= 400) ||
      legacyState === "FAILED";

    // If a tx hash is present, return it immediately — some wallets delay
    // updating status codes even after broadcasting.
    if (hash) return hash as Hex;

    if (looksConfirmed) {
      throw new Error("Sponsored call confirmed, but no transactionHash was returned.");
    }

    if (looksFailed) {
      const reason = status?.error?.message ? String(status.error.message) : "Sponsored call failed.";
      throw new Error(reason);
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error("Timed out waiting for sponsored transaction confirmation.");
}
