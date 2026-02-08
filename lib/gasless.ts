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
  const e = err as any;
  // EIP-1193 user rejected request
  if (e?.code === 4001) return true;
  const msg = String(e?.message ?? "").toLowerCase();
  return msg.includes("user rejected") || msg.includes("rejected the request");
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
  const msg = String(e?.message ?? "").toLowerCase();
  return msg.includes("version") || msg.includes("invalid params") || msg.includes("invalid argument");
}

async function walletSendCalls(params: {
  request: RpcRequester;
  address: Address;
  chainIdHex: Hex;
  paymasterProxyUrl: string;
  calls: Array<{ to: Address; data: Hex; value?: bigint }>;
  version: "2.0.0" | "1.0";
}): Promise<Hex> {
  const { request, address, chainIdHex, paymasterProxyUrl, calls, version } = params;

  return (await request({
    method: "wallet_sendCalls",
    params: [
      {
        version,
        from: address,
        chainId: chainIdHex,
        calls: calls.map((c) => ({
          to: c.to,
          data: c.data,
          ...(typeof c.value === "bigint" ? { value: toHexValue(c.value) } : {}),
        })),
        capabilities: {
          paymasterService: { url: paymasterProxyUrl },
        },
      },
    ],
  })) as Hex;
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

  let id: Hex;
  try {
    id = await walletSendCalls({ request, address, chainIdHex, paymasterProxyUrl, calls, version: "2.0.0" });
  } catch (e) {
    if (looksLikeUnsupportedSendCalls(e)) throw e;
    // Some wallets only support "1.0". If the error looks like a version/params issue, retry once with "1.0".
    if (looksLikeVersionIssue(e)) {
      id = await walletSendCalls({ request, address, chainIdHex, paymasterProxyUrl, calls, version: "1.0" });
    } else {
      throw e;
    }
  }

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = await request({ method: "wallet_getCallsStatus", params: [id] });

    const state = String(status?.status ?? "").toUpperCase();
    if (state === "CONFIRMED") {
      const receipts = status?.receipts ?? [];
      const first = receipts?.[0];
      const hash: Hex | undefined =
        first?.transactionHash ??
        first?.transactionReceipt?.transactionHash ??
        status?.transactionHash;

      if (!hash) throw new Error("Sponsored call confirmed, but no transactionHash was returned.");
      return hash as Hex;
    }

    if (state === "FAILED") {
      const reason = status?.error?.message ? String(status.error.message) : "Sponsored call failed.";
      throw new Error(reason);
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error("Timed out waiting for sponsored transaction confirmation.");
}
