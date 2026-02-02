"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount, usePublicClient, useReadContract, useSignTypedData, useWriteContract } from "wagmi";
import { base } from "wagmi/chains";
import {
  encodeFunctionData,
  formatEther,
  formatUnits,
  getAddress,
  isAddress,
  parseEther,
  parseUnits,
  type Address,
} from "viem";
import { publicActionsL2 } from "viem/op-stack";
import { AllowanceTransfer } from "@uniswap/permit2-sdk";
import Papa from "papaparse";


import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Check, Copy, ExternalLink, Loader2, Upload } from "lucide-react";
import WalletConnectButton from "@/components/WalletConnect";

// ---------- Config (env first, validated, with safe fallbacks) ----------
const DEFAULT_MULTISENDER_ADDRESS = "0xAd7d4483Eb4352B71aCc8C3C81482079b0636d55" as const;
const DEFAULT_PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;

// Next.js embeds NEXT_PUBLIC_* env vars into the client bundle at build time.
// Validate them so a typo can’t silently point users at the wrong contract.
const MULTISENDER_ADDRESS = (isAddress(process.env.NEXT_PUBLIC_MULTISENDER_ADDRESS ?? "")
  ? (getAddress(process.env.NEXT_PUBLIC_MULTISENDER_ADDRESS as string) as Address)
  : (DEFAULT_MULTISENDER_ADDRESS as Address));

const PERMIT2_ADDRESS = (isAddress(process.env.NEXT_PUBLIC_PERMIT2_ADDRESS ?? "")
  ? (getAddress(process.env.NEXT_PUBLIC_PERMIT2_ADDRESS as string) as Address)
  : (DEFAULT_PERMIT2_ADDRESS as Address));

// BaseScan (mainnet)
const EXPLORER_TX = (hash: string) => `https://basescan.org/tx/${hash}`;
const EXPLORER_ADDR = (addr: string) => `https://basescan.org/address/${addr}`;

// ---------- ABIs ----------
const multisenderAbi = [
  {
    type: "function",
    name: "sendETH",
    stateMutability: "payable",
    inputs: [
      { name: "recipients", type: "address[]" },
      { name: "amounts", type: "uint256[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "sendERC20Permit2",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "permitSingle",
        type: "tuple",
        components: [
          {
            name: "details",
            type: "tuple",
            components: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint160" },
              { name: "expiration", type: "uint48" },
              { name: "nonce", type: "uint48" },
            ],
          },
          { name: "spender", type: "address" },
          { name: "sigDeadline", type: "uint256" },
        ],
      },
      { name: "signature", type: "bytes" },
      { name: "recipients", type: "address[]" },
      { name: "amounts", type: "uint256[]" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "BatchETH",
    inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "recipients", type: "uint256", indexed: false },
      { name: "total", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "BatchERC20",
    inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "recipients", type: "uint256", indexed: false },
      { name: "total", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
] as const;

const erc20Abi = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const permit2Abi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
  },
] as const;

// ---------- Helpers ----------
type Mode = "ETH" | "ERC20";

function shortAddr(addr?: string) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatFeeEth(wei?: bigint) {
  if (wei === undefined) return "—";
  // show up to 6 decimals in ETH, but keep small values readable
  const eth = Number(formatEther(wei));
  if (!isFinite(eth)) return `${formatEther(wei)} ETH`;
  if (eth === 0) return "0 ETH";
  if (eth < 0.000001) return `< 0.000001 ETH`;
  return `${eth.toFixed(6)} ETH`;
}

function safeParseLines(raw: string) {
  return raw
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n");
}

function parseRecipients({
  raw,
  mode,
  decimals,
}: {
  raw: string;
  mode: Mode;
  decimals?: number;
}): {
  recipients: Address[];
  amounts: bigint[];
  total: bigint;
  invalidLine?: string;
} {
  const lines = safeParseLines(raw);
  const recipients: Address[] = [];
  const amounts: bigint[] = [];
  let total = 0n;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // allow comma or whitespace separators
    const parts = trimmed.includes(",") ? trimmed.split(",") : trimmed.split(/\s+/);
    const addrRaw = (parts[0] || "").trim();
    const amtRaw = (parts[1] || "").trim();

    if (!isAddress(addrRaw)) return { recipients, amounts, total, invalidLine: trimmed };
    if (!amtRaw) return { recipients, amounts, total, invalidLine: trimmed };

    let amt: bigint;
    try {
      if (mode === "ETH") {
        amt = parseEther(amtRaw);
      } else {
        if (decimals === undefined) return { recipients, amounts, total, invalidLine: trimmed };
        amt = parseUnits(amtRaw, decimals);
      }
    } catch {
      return { recipients, amounts, total, invalidLine: trimmed };
    }

    if (amt <= 0n) return { recipients, amounts, total, invalidLine: trimmed };

    recipients.push(getAddress(addrRaw));
    amounts.push(amt);
    total += amt;
  }

  return { recipients, amounts, total };
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers / contexts where Clipboard API isn't available.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "0";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function Home() {
  const { address, chainId, isConnected } = useAccount();
  const isBaseChain = chainId === base.id;

  const publicClient = usePublicClient({ chainId: base.id });

  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [mode, setMode] = useState<Mode>("ETH");

  // Recipients editor
  const [rawList, setRawList] = useState("");
  const [expanded, setExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const numsRef = useRef<HTMLDivElement | null>(null);
  const numsInnerRef = useRef<HTMLDivElement | null>(null);
  const csvInputRef = useRef<HTMLInputElement | null>(null);

  const [copied, setCopied] = useState<null | "contract" | "tx">(null);

  // Token
  const [tokenInput, setTokenInput] = useState("");
  const tokenAddress = (isAddress(tokenInput) ? (getAddress(tokenInput) as Address) : undefined);

  // Receipt
  const [txHash, setTxHash] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // Fee estimate (ETH is accurate pre-tx; ERC20 is shown right before send)
  const [feeWei, setFeeWei] = useState<bigint | undefined>(undefined);
  const [feeLoading, setFeeLoading] = useState(false);

  // Visible editor sizing
  const visibleLines = 10;
  const lineHeightPx = 24;

  const lineCount = useMemo(() => {
    const lines = safeParseLines(rawList);
    // count at least visibleLines so the editor looks stable
    return Math.max(visibleLines, lines.length || visibleLines);
  }, [rawList]);

  // Keep line numbers perfectly in sync with the textarea scroll.
  // Important: the number rail itself should NOT be independently scrollable
  // (otherwise users have to scroll twice). Instead, we translate the numbers
  // by the textarea's scrollTop.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;

    const sync = () => {
      const st = ta.scrollTop;
      if (numsInnerRef.current) {
        numsInnerRef.current.style.transform = `translateY(-${st}px)`;
      }
    };

    sync();
    ta.addEventListener("scroll", sync, { passive: true });
    return () => ta.removeEventListener("scroll", sync);
  }, []);

  const tokenDecimalsRead = useReadContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: !!tokenAddress && mode === "ERC20" },
  });

  const tokenSymbolRead = useReadContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: !!tokenAddress && mode === "ERC20" },
  });

  const decimals = tokenDecimalsRead.data !== undefined ? Number(tokenDecimalsRead.data) : undefined;
  const symbol = tokenSymbolRead.data || "";

  const parsed = useMemo(() => parseRecipients({ raw: rawList, mode, decimals }), [rawList, mode, decimals]);
  const recipients = parsed.recipients;
  const amounts = parsed.amounts;
  const total = parsed.total;
  const invalidLine = parsed.invalidLine;

  // Token allowance to Permit2 (on the token contract)
  const tokenAllowanceToPermit2 = useReadContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && tokenAddress ? [address, PERMIT2_ADDRESS] : undefined,
    query: { enabled: !!address && !!tokenAddress && mode === "ERC20" },
  });

  // Permit2 allowance tuple (gives us nonce for the signature)
  const permit2Allowance = useReadContract({
    address: PERMIT2_ADDRESS,
    abi: permit2Abi,
    functionName: "allowance",
    args: address && tokenAddress ? [address, tokenAddress, MULTISENDER_ADDRESS] : undefined,
    query: { enabled: !!address && !!tokenAddress && mode === "ERC20" },
  });

  const allowanceToPermit2 = tokenAllowanceToPermit2.data ?? 0n;
  const permit2Nonce = permit2Allowance.data?.[2] ?? 0; // uint48

  const needsApprove =
    mode === "ERC20" && tokenAddress && address && total > 0n ? allowanceToPermit2 < total : false;

  // ETH fee estimate (best-effort; wallet shows final)
  useEffect(() => {
    let cancelled = false;

    async function run() {
      setFeeWei(undefined);

      if (!mounted) return;
      if (!publicClient) return;
      if (!address) return;
      if (!isBaseChain) return;
      if (mode !== "ETH") return;
      if (recipients.length === 0) return;
      if (invalidLine) return;

      setFeeLoading(true);
      try {
        const gasPrice = await publicClient.getGasPrice();
        const gas = await publicClient.estimateContractGas({
          address: MULTISENDER_ADDRESS,
          abi: multisenderAbi,
          functionName: "sendETH",
          args: [recipients, amounts],
          account: address,
          value: total,
        });

        let l1Fee = 0n;
        try {
          const l2 = publicClient.extend(publicActionsL2());
          const data = encodeFunctionData({
            abi: multisenderAbi,
            functionName: "sendETH",
            args: [recipients, amounts],
          });
          // viem/op-stack will do the correct L1-fee estimation on OP Stack chains.
          // estimateL1Fee does NOT take `gas` or legacy `gasPrice` (it only needs account/to/data/value,
          // plus optional EIP-1559 fields). Passing `gas`/`gasPrice` breaks typechecking in CI builds.
          l1Fee = await l2.estimateL1Fee({ account: address, to: MULTISENDER_ADDRESS, data, value: total });
        } catch {
          // If extension isn't available, we still show L2 fee (still a useful approximation).
          l1Fee = 0n;
        }

        const l2Fee = gas * gasPrice;
        if (!cancelled) setFeeWei(l2Fee + l1Fee);
      } catch {
        if (!cancelled) setFeeWei(undefined);
      } finally {
        if (!cancelled) setFeeLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [mounted, publicClient, address, isBaseChain, mode, recipients, amounts, total, invalidLine]);

  function resetAll() {
    setRawList("");
    setTxHash(null);
    setStatus(null);
  }

  function flashCopied(which: "contract" | "tx") {
    setCopied(which);
    window.setTimeout(() => setCopied(null), 1200);
  }

  async function onUploadCsv(file: File) {
    const text = await file.text();

    const parsedCsv = Papa.parse<string[]>(text, {
      skipEmptyLines: true,
    });

    if (parsedCsv.errors?.length) {
      setStatus(`CSV parse error: ${parsedCsv.errors[0]?.message ?? "Unknown error"}`);
      return;
    }

    const rows = (parsedCsv.data || [])
      .map((row) => (Array.isArray(row) ? row : [String(row)]))
      .map((row) => row.map((c) => String(c ?? "").trim()));

    const firstRow = rows[0] ?? [];
    const headerProbe = firstRow.join(",").toLowerCase();
    const looksHeader = headerProbe.includes("address") && headerProbe.includes("amount");

    const bodyRows = looksHeader ? rows.slice(1) : rows;

    const cleaned = bodyRows
      .map((r) => {
        const c0 = (r[0] ?? "").trim();
        const c1 = (r[1] ?? "").trim();

        if (!c0) return "";

        // Some exports put "address amount" in one column.
        if (!c1 && /\s+/.test(c0)) {
          const parts = c0.split(/\s+/);
          return `${(parts[0] ?? "").trim()}, ${(parts[1] ?? "").trim()}`.trim();
        }

        return `${c0}, ${c1}`.trim();
      })
      .filter(Boolean)
      .join("\n");

    setRawList(cleaned);
    setTxHash(null);
    setStatus(null);
  }


  async function approveExact() {
    if (!address || !tokenAddress) return;
    if (!isBaseChain) {
      setStatus("Please switch to Base mainnet.");
      return;
    }
    if (total <= 0n) return;

    setPending(true);
    setStatus("Preparing approval…");
    setTxHash(null);

    const wait = async (hash: `0x${string}`, label: string) => {
      setTxHash(hash);
      setStatus(label);
      await publicClient?.waitForTransactionReceipt({ hash });
    };

    try {
      // Most tokens support updating allowance directly.
      const hash = await writeContractAsync({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [PERMIT2_ADDRESS, total],
      });

      await wait(hash, "Approval submitted. Waiting for confirmation…");

      // refresh reads
      tokenAllowanceToPermit2.refetch?.();
      permit2Allowance.refetch?.();

      setStatus("Approved. You can send now.");
    } catch (e: any) {
      // Some tokens (USDT-style) require setting allowance to 0 before updating it.
      const msg = e?.shortMessage || e?.message || "Approval failed.";

      if (allowanceToPermit2 > 0n && total !== allowanceToPermit2) {
        try {
          setStatus("Approval failed (token requires reset). Resetting to 0…");

          const resetHash = await writeContractAsync({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: "approve",
            args: [PERMIT2_ADDRESS, 0n],
          });

          await wait(resetHash, "Reset submitted. Waiting for confirmation…");

          const hash2 = await writeContractAsync({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: "approve",
            args: [PERMIT2_ADDRESS, total],
          });

          await wait(hash2, "Approval submitted. Waiting for confirmation…");

          tokenAllowanceToPermit2.refetch?.();
          permit2Allowance.refetch?.();

          setStatus("Approved. You can send now.");
        } catch (e2: any) {
          setStatus(e2?.shortMessage || e2?.message || msg);
        }
      } else {
        setStatus(msg);
      }
    } finally {
      setPending(false);
    }
  }


  async function sendEth() {
    if (!address) return;
    if (!isBaseChain) {
      setStatus("Please switch to Base mainnet.");
      return;
    }
    if (recipients.length === 0) return;
    if (invalidLine) return;

    setPending(true);
    setStatus("Preparing transaction…");
    setTxHash(null);

    try {
      const hash = await writeContractAsync({
        address: MULTISENDER_ADDRESS,
        abi: multisenderAbi,
        functionName: "sendETH",
        args: [recipients, amounts],
        value: total,
      });

      setTxHash(hash);
      setStatus("Submitted. Waiting for confirmation…");

      await publicClient?.waitForTransactionReceipt({ hash });

      setStatus("Batch sent successfully.");
    } catch (e: any) {
      setStatus(e?.shortMessage || e?.message || "Transaction failed.");
    } finally {
      setPending(false);
    }
  }

  async function sendToken() {
    if (!address) return;
    if (!isBaseChain) {
      setStatus("Please switch to Base mainnet.");
      return;
    }
    if (!tokenAddress) return;
    if (decimals === undefined) return;
    if (recipients.length === 0) return;
    if (invalidLine) return;

    if (needsApprove) {
      setStatus("Approval is required before sending.");
      return;
    }

    setPending(true);
    setStatus("Preparing signature…");
    setTxHash(null);

    try {
      // Build Permit2 PermitSingle
      const now = Math.floor(Date.now() / 1000);
      const expiration = now + 60 * 60 * 24 * 30; // 30 days
      const sigDeadline = BigInt(now + 60 * 20); // 20 minutes

      const permitSingle = {
        details: {
          token: tokenAddress,
          amount: total, // uint160 in contract; contract will validate bounds
          expiration,
          nonce: Number(permit2Nonce),
        },
        spender: MULTISENDER_ADDRESS,
        sigDeadline,
      };
      const { domain, types, values } = AllowanceTransfer.getPermitData(
        permitSingle as any,
        PERMIT2_ADDRESS,
        chainId ?? base.id
      ) as any;

      // Permit2 SDK returns { domain, types, values }. viem/wagmi requires an explicit primaryType.
      const signature = await signTypedDataAsync({
        domain,
        types,
        primaryType: "PermitSingle",
        message: values,
      } as any);

      setStatus("Submitting transaction…");

      const hash = await writeContractAsync({
        address: MULTISENDER_ADDRESS,
        abi: multisenderAbi,
        functionName: "sendERC20Permit2",
        args: [permitSingle as any, signature as any, recipients, amounts],
      });

      setTxHash(hash);
      setStatus("Submitted. Waiting for confirmation…");

      await publicClient?.waitForTransactionReceipt({ hash });

      setStatus("Batch sent successfully.");
      // refresh nonce/allowances
      permit2Allowance.refetch?.();
    } catch (e: any) {
      setStatus(e?.shortMessage || e?.message || "Transaction failed.");
    } finally {
      setPending(false);
    }
  }

  // Derived UI strings
  const totalLabel =
    mode === "ETH"
      ? `${Number(formatEther(total || 0n)).toLocaleString(undefined, { maximumFractionDigits: 8 })} ETH`
      : decimals !== undefined
        ? `${Number(formatUnits(total || 0n, decimals)).toLocaleString(undefined, { maximumFractionDigits: 8 })} ${symbol || "TOKEN"}`
        : `—`;

  const canSend =
    isConnected &&
    isBaseChain &&
    !pending &&
    !invalidLine &&
    recipients.length > 0 &&
    (mode === "ETH" ? total > 0n : !!tokenAddress && decimals !== undefined && total > 0n && !needsApprove);

  const editorHeight = expanded ? `${lineCount * lineHeightPx}px` : `${visibleLines * lineHeightPx}px`;

  if (!mounted) {
    // Avoid hydration flicker / mismatches by rendering a stable placeholder on first paint.
    return (
      <main className="min-h-screen px-6 py-10">
        <div className="mx-auto max-w-5xl">
          <div className="h-10 w-64 rounded-xl bg-white/5" />
          <div className="mt-6 h-80 rounded-3xl bg-white/5" />
        </div>
      </main>
    );
  }

  return (
    <>
      <main className="min-h-screen px-6 py-10">
        <div className="mx-auto max-w-6xl">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="relative mt-0.5 h-10 w-10 overflow-hidden rounded-2xl bg-white/[0.06] ring-1 ring-white/12 shadow-[0_8px_20px_rgba(0,0,0,0.35)]">
                <img src="/logo-mark.png" alt="Multi Sender" className="h-full w-full object-contain" />
              </div>

              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-3xl font-semibold tracking-tight text-white">Base MultiSender</h1>
                  <Badge className="bg-white/10 text-white/80 ring-1 ring-white/10">No protocol fee</Badge>
                </div>
                <p className="mt-1 text-sm text-white/60">Non-custodial. You pay only network gas.</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <WalletConnectButton />
            </div>
          </div>

          <div className="my-8 h-px bg-white/10" />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Left: composer */}
            <Card className="lg:col-span-7 bg-white/[0.04] ring-1 ring-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.45)] rounded-3xl">
              <CardHeader className="pb-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="inline-flex items-center gap-1 rounded-2xl bg-white/5 ring-1 ring-white/10 p-1">
                      <button
                        type="button"
                        onClick={() => setMode("ETH")}
                        className={[
                          "px-3 py-1.5 text-sm font-medium rounded-xl transition",
                          mode === "ETH"
                            ? "bg-white text-black shadow"
                            : "text-white/80 hover:bg-white/10",
                        ].join(" ")}
                      >
                        ETH
                      </button>
                      <button
                        type="button"
                        onClick={() => setMode("ERC20")}
                        className={[
                          "px-3 py-1.5 text-sm font-medium rounded-xl transition",
                          mode === "ERC20"
                            ? "bg-white text-black shadow"
                            : "text-white/80 hover:bg-white/10",
                        ].join(" ")}
                      >
                        ERC20
                      </button>
                    </div>

                    <Badge className="bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-500/20">Strict</Badge>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={csvInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) onUploadCsv(f);
                        e.currentTarget.value = "";
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => csvInputRef.current?.click()}
                      className="gap-2 bg-white/0 border-white/15 text-white/80 hover:bg-white/10 hover:text-white"
                    >
                      <Upload className="h-4 w-4" />
                      Upload CSV
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      onClick={resetAll}
                      className="bg-white/0 border-white/15 text-white/80 hover:bg-white/10 hover:text-white"
                    >
                      Reset
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                {mode === "ERC20" && (
                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="text-sm text-white/70">Token</label>
                        <div className="text-xs text-white/45">
                          {tokenAddress && decimals !== undefined ? (
                            <>
                              {symbol ? `${symbol} · ` : ""}
                              Decimals: {decimals}
                            </>
                          ) : (
                            "Paste token contract address"
                          )}
                        </div>
                      </div>
                      <Input
                        value={tokenInput}
                        onChange={(e) => setTokenInput(e.target.value)}
                        placeholder="0x…"
                        className="mt-1 bg-black/30 border-white/10 text-white placeholder:text-white/30 rounded-2xl"
                      />
                      <div className="mt-1 text-[11px] text-white/45">
                        Approve grants Permit2 permission to pull exactly the batch total (not unlimited).
                      </div>
                    </div>

                    {tokenAddress && total > 0n && (
                      <div className="flex items-center justify-between text-xs text-white/45">
                        <div>
                          Permit2 allowance (token → Permit2):{" "}
                          <span className="text-white/70">
                            {decimals !== undefined
                              ? formatUnits(allowanceToPermit2, decimals)
                              : allowanceToPermit2.toString()}
                          </span>
                        </div>
                        <div className={needsApprove ? "text-amber-200" : "text-emerald-200"}>
                          {needsApprove ? "Needs approval" : "Approved"}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Recipients editor */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-white/70">Recipients</label>
                    <div className="flex items-center gap-2 text-xs text-white/45">
                      Format: address,amount (one per line)
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setExpanded((v) => !v)}
                        className="h-7 rounded-xl bg-white/0 border-white/15 text-white/70 hover:bg-white/10"
                      >
                        {expanded ? "Collapse" : "Expand"}
                      </Button>
                    </div>
                  </div>

                  <div className="relative overflow-hidden rounded-2xl ring-1 ring-white/10 bg-black/30">
                    <div className="flex">
                      <div
                        ref={numsRef}
                        aria-hidden
                        className="select-none overflow-hidden border-r border-white/10 bg-white/[0.03] px-3 py-2 text-right text-xs leading-6 text-white/35"
                        onWheel={(e) => {
                          const ta = textareaRef.current;
                          if (!ta) return;

                          // Scroll the textarea (single source of truth).
                          const prev = ta.scrollTop;
                          ta.scrollTop += e.deltaY;

                          // Prevent the page from scrolling if the editor can still scroll.
                          if (ta.scrollTop !== prev) e.preventDefault();
                        }}
                        style={{ height: editorHeight }}
                      >
                        <div ref={numsInnerRef}>
                          {Array.from({ length: lineCount }, (_, i) => (
                            <div key={i} style={{ height: `${lineHeightPx}px` }} className="leading-6">
                              {i + 1}
                            </div>
                          ))}
                        </div>
                      </div>

                      <textarea
                        ref={textareaRef}
                        value={rawList}
                        onChange={(e) => {
                          setRawList(e.target.value);
                          setTxHash(null);
                          setStatus(null);
                        }}
                        placeholder={`0x1111...1111, 0.01\n0x2222...2222, 0.02`}
                        spellCheck={false}
                        wrap="off"
                        className={[
                          // Disable line-wrapping so each logical line remains one visual line.
                          // This keeps line numbers perfectly aligned with each address line.
                          "w-full resize-none bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-white/20 scrollbar-dark whitespace-pre overflow-x-auto",
                          expanded ? "overflow-y-hidden" : "overflow-y-auto",
                        ].join(" ")}
                        style={{
                          height: editorHeight,
                          lineHeight: `${lineHeightPx}px`,
                        }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <div className="text-white/50">
                      Parsed: <span className="text-white/70">{recipients.length}</span> recipients
                      {invalidLine ? (
                        <span className="ml-2 text-rose-300">
                          Invalid line: <span className="text-rose-200/90">"{invalidLine}"</span>
                        </span>
                      ) : null}
                    </div>
                    <div className="text-white/45">
                      Total: <span className="text-white/70">{totalLabel}</span>
                    </div>
                  </div>
                </div>

                {/* Primary action */}
                <div className="rounded-2xl bg-white/[0.03] ring-1 ring-white/10 p-4">
                  {mode === "ETH" ? (
                    <Button
                      type="button"
                      onClick={sendEth}
                      disabled={!canSend}
                      className="w-full rounded-2xl bg-white text-black hover:bg-white/90"
                    >
                      {pending ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" /> Sending…
                        </span>
                      ) : (
                        "Send ETH"
                      )}
                    </Button>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Button
                        type="button"
                        onClick={approveExact}
                        disabled={
                          !isConnected ||
                          !isBaseChain ||
                          pending ||
                          !tokenAddress ||
                          total <= 0n ||
                          !needsApprove
                        }
                        className={
                          needsApprove
                            ? "w-full rounded-2xl bg-white text-black hover:bg-white/90"
                            : "w-full rounded-2xl bg-white/0 border border-white/15 text-white/70"
                        }
                      >
                        {pending && status?.toLowerCase().includes("approval") ? (
                          <span className="inline-flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" /> Approving…
                          </span>
                        ) : !needsApprove && tokenAddress && total > 0n ? (
                          <span className="inline-flex items-center gap-2">
                            <Check className="h-4 w-4" /> Approved
                          </span>
                        ) : (
                          "Approve"
                        )}
                      </Button>

                      <Button
                        type="button"
                        onClick={sendToken}
                        disabled={
                          !isConnected ||
                          !isBaseChain ||
                          pending ||
                          !!invalidLine ||
                          recipients.length === 0 ||
                          !tokenAddress ||
                          decimals === undefined ||
                          total <= 0n ||
                          needsApprove
                        }
                        className="w-full rounded-2xl bg-white text-black hover:bg-white/90"
                      >
                        {pending && !status?.toLowerCase().includes("approval") ? (
                          <span className="inline-flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" /> Sending…
                          </span>
                        ) : (
                          "Send Token"
                        )}
                      </Button>
                    </div>
                  )}

                  {status ? (
                    <div className="mt-3 rounded-xl bg-black/30 ring-1 ring-white/10 px-3 py-2 text-sm text-white/70">
                      {status}
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            {/* Right: review */}
            <div className="lg:col-span-5 space-y-6">
              <Card className="bg-white/[0.04] ring-1 ring-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.45)] rounded-3xl">
                <CardHeader className="pb-3">
                  <CardTitle className="text-white">Review</CardTitle>
                  <CardDescription className="text-white/50">
                    Strict mode is atomic (all-or-nothing). If any transfer fails, the transaction reverts.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="text-white/50">Network</div>
                    <div className="text-right text-white/80">Base mainnet</div>

                    <div className="text-white/50">Sender</div>
                    <div className="text-right text-white/80">{address ? shortAddr(address) : "—"}</div>

                    <div className="text-white/50">Contract</div>
                    <div className="flex items-center justify-end gap-2">
                      <a
                        href={EXPLORER_ADDR(MULTISENDER_ADDRESS)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-white/80 hover:text-white underline-offset-4 hover:underline"
                      >
                        {shortAddr(MULTISENDER_ADDRESS)}
                      </a>
                      <Button
                        type="button"
                        variant="outline"
                        aria-label="Copy contract address"
                        className="h-8 w-8 p-0 rounded-xl bg-white/0 border-white/15 text-white/70 hover:bg-white/10"
                        onClick={async () => {
                          const ok = await copyToClipboard(MULTISENDER_ADDRESS);
                          if (ok) flashCopied("contract");
                        }}
                      >
                        {copied === "contract" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>

                    {mode === "ERC20" && (
                      <>
                        <div className="text-white/50">Token</div>
                        <div className="text-right text-white/80">{tokenAddress ? shortAddr(tokenAddress) : "—"}</div>
                      </>
                    )}

                    <div className="text-white/50">Recipients</div>
                    <div className="text-right text-white/80">{recipients.length}</div>

                    <div className="text-white/50">Total</div>
                    <div className="text-right text-white/80">{totalLabel}</div>

                    <div className="text-white/50">Estimated fee</div>
                    <div className="text-right text-white/80">
                      {feeLoading ? <Loader2 className="ml-auto h-4 w-4 animate-spin" /> : formatFeeEth(feeWei)}
                    </div>
                  </div>

                  {mode === "ERC20" ? (
                    <div className="rounded-2xl bg-black/25 ring-1 ring-white/10 p-3 text-xs text-white/55">
                      Token transfers will be sent from the contract to recipients. There is also a single on-chain
                      transfer into the contract (your wallet → contract) to fund the batch.
                    </div>
                  ) : (
                    <div className="rounded-2xl bg-black/25 ring-1 ring-white/10 p-3 text-xs text-white/55">
                      ETH is forwarded by the contract in one atomic batch.
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Receipt */}
              {txHash ? (
                <Card className="bg-white/[0.04] ring-1 ring-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.45)] rounded-3xl">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle className="text-white">Receipt</CardTitle>
                      <Badge className="bg-white/10 text-white/70 ring-1 ring-white/10">{shortAddr(txHash)}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-2xl bg-white/[0.03] ring-1 ring-white/10 p-3">
                        <div className="text-xs text-white/50">Recipients</div>
                        <div className="mt-1 text-lg font-semibold text-white">{recipients.length}</div>
                      </div>
                      <div className="rounded-2xl bg-white/[0.03] ring-1 ring-white/10 p-3">
                        <div className="text-xs text-white/50">Mode</div>
                        <div className="mt-1 text-lg font-semibold text-white">{mode}</div>
                      </div>
                      <div className="rounded-2xl bg-white/[0.03] ring-1 ring-white/10 p-3">
                        <div className="text-xs text-white/50">Total</div>
                        <div className="mt-1 text-lg font-semibold text-white">{totalLabel}</div>
                      </div>
                    </div>

                    <div className="rounded-2xl bg-white/[0.03] ring-1 ring-white/10 p-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div className="text-sm text-white/70">Tx hash</div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-2xl bg-white/0 border-white/15 text-white/80 hover:bg-white/10"
                          onClick={() => window.open(EXPLORER_TX(txHash), "_blank")}
                        >
                          Explorer <ExternalLink className="ml-2 h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-2xl bg-white/0 border-white/15 text-white/80 hover:bg-white/10"
                          onClick={() => copyToClipboard(txHash)}
                        >
                          Copy <Copy className="ml-2 h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ) : null}
            </div>
          </div>

          <footer className="mt-10 text-xs text-white/40">
            Built for Base. Non-custodial.
          </footer>
        </div>
      </main>
    </>
  );
}
