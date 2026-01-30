"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Papa from "papaparse";
import { z } from "zod";
import { AllowanceTransfer } from "@uniswap/permit2-sdk";
import { useAccount, usePublicClient, useWalletClient, useSwitchChain } from "wagmi";
import {
  encodeFunctionData,
  formatUnits,
  isAddress,
  parseUnits,
  parseEventLogs,
  type Hex,
} from "viem";
import {
  Copy,
  ExternalLink,
  Info,
  Loader2,
  ShieldCheck,
  Upload,
  RotateCcw,
  ArrowRight,
} from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ReceiptTable, type ReceiptRow } from "@/components/ReceiptTable";
import { cn } from "@/components/ui/cn";

const WalletConnect = dynamic(() => import("@/components/WalletConnect"), { ssr: false });

const CHAIN_ID = 8453;
const EXPLORER_TX = "https://basescan.org/tx/";

const MULTISENDER = (process.env.NEXT_PUBLIC_MULTISENDER_ADDRESS ?? "") as `0x${string}`;
const PERMIT2 = (process.env.NEXT_PUBLIC_PERMIT2_ADDRESS ?? "0x000000000022D473030F116dDEE9F6B43aC78BA3") as `0x${string}`;

const MAX_UINT256 = 2n ** 256n - 1n;
const MAX_UINT160 = 2n ** 160n - 1n;
const decimalRegex = /^\d+(?:\.\d+)?$/;

const rowSchema = z.object({
  address: z.string().refine((v) => isAddress(v), "Invalid address"),
  amount: z.string().refine((v) => decimalRegex.test(v), "Invalid amount"),
});

const erc20Abi = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address", name: "owner" }, { type: "address", name: "spender" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address", name: "spender" }, { type: "uint256", name: "amount" }], outputs: [{ type: "bool" }] },
] as const;

// allowance(owner, token, spender) -> (amount, expiration, nonce)
const permit2Abi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { type: "address", name: "owner" },
      { type: "address", name: "token" },
      { type: "address", name: "spender" },
    ],
    outputs: [
      { type: "uint160", name: "amount" },
      { type: "uint48", name: "expiration" },
      { type: "uint48", name: "nonce" },
    ],
  },
] as const;

const multisenderAbi = [
  // functions
  {
    type: "function",
    name: "sendETHStrict",
    stateMutability: "payable",
    inputs: [
      { type: "address[]", name: "recipients" },
      { type: "uint256[]", name: "amounts" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "sendETHBestEffort",
    stateMutability: "payable",
    inputs: [
      { type: "address[]", name: "recipients" },
      { type: "uint256[]", name: "amounts" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "sendERC20Permit2Strict",
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
      { type: "address[]", name: "recipients" },
      { type: "uint256[]", name: "amounts" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "sendERC20Permit2BestEffort",
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
      { type: "address[]", name: "recipients" },
      { type: "uint256[]", name: "amounts" },
    ],
    outputs: [],
  },

  // events
  {
    type: "event",
    name: "ETH_Item",
    inputs: [
      { indexed: true, name: "index", type: "uint256" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "success", type: "bool" },
      { indexed: false, name: "returnDataTruncated", type: "bytes" },
    ],
  },
  {
    type: "event",
    name: "ERC20_Item",
    inputs: [
      { indexed: true, name: "index", type: "uint256" },
      { indexed: true, name: "token", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "success", type: "bool" },
      { indexed: false, name: "returnDataTruncated", type: "bytes" },
    ],
  },
  {
    type: "event",
    name: "BatchSummary",
    inputs: [
      { indexed: true, name: "sender", type: "address" },
      { indexed: true, name: "token", type: "address" },
      { indexed: false, name: "totalRequested", type: "uint256" },
      { indexed: false, name: "successCount", type: "uint256" },
      { indexed: false, name: "failCount", type: "uint256" },
      { indexed: false, name: "unsentOrRefundedAmount", type: "uint256" },
      { indexed: false, name: "strictMode", type: "bool" },
    ],
  },
] as const;

function shortAddr(a?: string) {
  if (!a) return "";
  return a.slice(0, 6) + "…" + a.slice(-4);
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}
function deadline(secondsFromNow: number) {
  return nowSeconds() + secondsFromNow;
}

function decodeRevertLike(dataHex?: Hex) {
  if (!dataHex || dataHex === "0x") return "No reason";
  if (dataHex.startsWith("0x08c379a0")) return "Error(string)";
  if (dataHex.startsWith("0x4e487b71")) return "Panic";
  return "Custom/unknown";
}

function friendlyError(err: any) {
  const msg = String(err?.shortMessage || err?.message || err);
  const code = err?.code ?? err?.cause?.code;

  if (code === 4001 || /User denied|User rejected|denied transaction signature/i.test(msg)) {
    return "You cancelled the wallet confirmation.";
  }
  if (/insufficient funds/i.test(msg)) return "Insufficient funds for amount + gas.";
  if (/chain/i.test(msg) && /8453|base/i.test(msg)) return "Please switch your wallet to Base mainnet.";
  return msg;
}

type ParsedList =
  | { ok: true; rows: Array<{ address: `0x${string}`; amount: string }>; warnings: string[] }
  | { ok: false; error: string };

function parseList(raw: string): ParsedList {
  const warnings: string[] = [];
  const rows: Array<{ address: `0x${string}`; amount: string }> = [];

  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  for (const line of lines) {
    const parts = line.includes(",") ? line.split(",") : line.split(/\s+/);
    const a = (parts[0] || "").trim();
    const amt = (parts[1] || "").trim();

    const check = rowSchema.safeParse({ address: a, amount: amt });
    if (!check.success) return { ok: false, error: `Invalid line: "${line}"` };

    if (amt === "0" || amt === "0.0") warnings.push("Some amounts look like 0. Double-check.");
    rows.push({ address: a as `0x${string}`, amount: amt });
  }

  return { ok: true, rows, warnings };
}

function fmtEth(eth: string) {
  const n = Number(eth);
  if (!Number.isFinite(n)) return eth;
  if (n === 0) return "0";
  // Keep readable (no scientific notation)
  if (n < 0.00000001) return "<0.00000001";
  return n.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}

export default function Page() {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { switchChain, isPending: switching } = useSwitchChain();

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const [asset, setAsset] = useState<"ETH" | "ERC20">("ETH");
  const [strict, setStrict] = useState(true);

  const [rawList, setRawList] = useState("");
  const parsed = useMemo(() => parseList(rawList), [rawList]);

  const [token, setToken] = useState<`0x${string}`>("0x0000000000000000000000000000000000000000");
  const [tokenSymbol, setTokenSymbol] = useState<string>("");
  const [tokenDecimals, setTokenDecimals] = useState<number>(18);
  const [tokenAllowance, setTokenAllowance] = useState<bigint>(0n);

  const [status, setStatus] = useState<{ kind: "idle" | "loading" | "ok" | "error"; message: string }>({
    kind: "idle",
    message: "",
  });

  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [summary, setSummary] = useState<{ successCount?: bigint; failCount?: bigint; unsent?: bigint } | null>(null);
  const [receiptRows, setReceiptRows] = useState<ReceiptRow[]>([]);

  const [fee, setFee] = useState<{ total?: bigint; gas?: bigint; gasPrice?: bigint } | null>(null);
  const [feeErr, setFeeErr] = useState<string>("");

  const onBase = chainId === CHAIN_ID;

  const recipients = useMemo(() => (parsed.ok ? parsed.rows.map((r) => r.address) : []), [parsed]);
  const amountsETH = useMemo(
    () => (parsed.ok ? parsed.rows.map((r) => parseUnits(r.amount, 18)) : []),
    [parsed]
  );
  const amountsToken = useMemo(
    () => (parsed.ok ? parsed.rows.map((r) => parseUnits(r.amount, tokenDecimals)) : []),
    [parsed, tokenDecimals]
  );

  const totals = useMemo(() => {
    if (!parsed.ok) return null;
    if (asset === "ETH") {
      const totalWei = amountsETH.reduce((acc, x) => acc + x, 0n);
      return { totalWei, display: `${fmtEth(formatUnits(totalWei, 18))} ETH` };
    }
    const totalWei = amountsToken.reduce((acc, x) => acc + x, 0n);
    const sym = tokenSymbol || "TOKEN";
    return { totalWei, display: `${formatUnits(totalWei, tokenDecimals)} ${sym}` };
  }, [parsed, asset, amountsETH, amountsToken, tokenDecimals, tokenSymbol]);

  const needsApproval = useMemo(() => {
    if (asset !== "ERC20") return false;
    if (!totals) return false;
    if (!isAddress(token) || token === "0x0000000000000000000000000000000000000000") return true;
    return tokenAllowance < totals.totalWei;
  }, [asset, totals, token, tokenAllowance]);

  const canSend =
    !!address &&
    onBase &&
    parsed.ok &&
    parsed.rows.length > 0 &&
    isAddress(MULTISENDER) &&
    (asset === "ETH" || (isAddress(token) && token !== "0x0000000000000000000000000000000000000000" && !needsApproval));
  // Recipients editor (line-numbered; collapsible)
  const [editorExpanded, setEditorExpanded] = useState(false);

  // Default is 10 lines "folded". When content exceeds, the editor shows an internal scrollbar.
  // If user expands, the editor grows with content and the full page scrolls.
  const BASE_LINES = 10;
  const LINE_HEIGHT_PX = 24; // Tailwind leading-6
  const PAD_Y_PX = 16; // Tailwind p-4 / py-4

  const rawLineCount = useMemo(() => (rawList.length ? rawList.split("\n").length : 2), [rawList]);
  const lineCount = useMemo(() => Math.max(BASE_LINES, rawLineCount), [rawLineCount]);

  const collapsedHeightPx = BASE_LINES * LINE_HEIGHT_PX + PAD_Y_PX * 2;
  const contentHeightPx = lineCount * LINE_HEIGHT_PX + PAD_Y_PX * 2;

  function resetAll() {
    setRawList("");
    setTxHash(null);
    setSummary(null);
    setReceiptRows([]);
    setStatus({ kind: "idle", message: "" });
  }

  async function uploadCsv(file: File) {
    const text = await file.text();
    const out = Papa.parse(text, { header: false, skipEmptyLines: true });
    if (out.errors?.length) throw new Error(out.errors[0].message);
    const lines = (out.data as any[])
      .map((r) => `${String(r[0] ?? "").trim()},${String(r[1] ?? "").trim()}`)
      .filter((l) => l !== ",")
      .join("\n");
    setRawList(lines);
  }

  async function ensureReady() {
    if (!isAddress(MULTISENDER)) throw new Error("Set NEXT_PUBLIC_MULTISENDER_ADDRESS in .env.local");
    if (!isAddress(PERMIT2)) throw new Error("Invalid Permit2 address (check env)");
    if (!address) throw new Error("Connect your wallet");
    if (!publicClient || !walletClient) throw new Error("Wallet not ready");
    if (!onBase) throw new Error("Switch wallet to Base mainnet");
    if (!parsed.ok) throw new Error(parsed.error);
    if (parsed.rows.length === 0) throw new Error("Add at least 1 recipient");
  }

  async function refreshTokenMeta(t: `0x${string}`) {
    if (!publicClient || !address) return;
    if (!isAddress(t) || t === "0x0000000000000000000000000000000000000000") return;

    try {
      const [decimals, symbol] = await Promise.all([
        publicClient.readContract({ address: t, abi: erc20Abi, functionName: "decimals" }),
        publicClient.readContract({ address: t, abi: erc20Abi, functionName: "symbol" }),
      ]);
      setTokenDecimals(Number(decimals));
      setTokenSymbol(String(symbol));
    } catch {
      setTokenDecimals(18);
      setTokenSymbol("");
    }

    try {
      const allowance = await publicClient.readContract({
        address: t,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, PERMIT2],
      });
      setTokenAllowance(allowance);
    } catch {
      setTokenAllowance(0n);
    }
  }

  // Auto refresh token meta/allowance after token input settles
  useEffect(() => {
    if (asset !== "ERC20") return;
    const h = setTimeout(() => {
      refreshTokenMeta(token).catch(() => void 0);
    }, 450);
    return () => clearTimeout(h);
  }, [asset, token, address]);

  async function approveTokenExact() {
    await ensureReady();
    if (asset !== "ERC20") throw new Error("Switch to ERC20 mode");
    if (!totals) throw new Error("Enter recipients first");
    if (!isAddress(token) || token === "0x0000000000000000000000000000000000000000") throw new Error("Enter a valid token address");

    const approveAmount = totals.totalWei; // exact amount required for this batch
    if (approveAmount === 0n) throw new Error("Total amount is 0");
    if (tokenAllowance >= approveAmount) {
      setStatus({ kind: "ok", message: "Already approved for this batch amount." });
      return;
    }

    setStatus({ kind: "loading", message: "Approving exact amount..." });

    async function doApprove(amount: bigint) {
      const data = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [PERMIT2, amount],
      });
      const hash = await walletClient!.sendTransaction({ to: token, data, account: address! });
      await publicClient!.waitForTransactionReceipt({ hash });
    }

    try {
      await doApprove(approveAmount);
    } catch (e: any) {
      // Some tokens require resetting allowance to 0 first
      try {
        setStatus({ kind: "loading", message: "Token requires reset. Setting allowance to 0..." });
        await doApprove(0n);
        setStatus({ kind: "loading", message: "Approving exact amount..." });
        await doApprove(approveAmount);
      } catch {
        throw e;
      }
    }

    setStatus({ kind: "ok", message: "Approval confirmed. You can send now." });
    await refreshTokenMeta(token);
  }

  const feeDisplay = useMemo(() => {
    if (!fee?.total) return null;
    return `${fmtEth(formatUnits(fee.total, 18))} ETH`;
  }, [fee]);

  // Better fee estimate for Base (OP Stack): try estimateTotalFee; fallback to (gas * gasPrice)
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        setFeeErr("");
        setFee(null);

        if (!publicClient || !address) return;
        if (!onBase) return;
        if (asset !== "ETH") return;
        if (!parsed.ok || parsed.rows.length === 0) return;
        if (!isAddress(MULTISENDER)) return;

        const total = amountsETH.reduce((a, b) => a + b, 0n);
        const fn = strict ? "sendETHStrict" : "sendETHBestEffort";
        const data = encodeFunctionData({ abi: multisenderAbi, functionName: fn, args: [recipients, amountsETH] });

        const req = { account: address, to: MULTISENDER, data, value: total } as const;

        // L2 execution gas
        const gas = await publicClient.estimateGas(req);
        const gasPrice = await publicClient.getGasPrice();
        let totalFee = gas * gasPrice;

        // OP Stack total fee (L1 data + L2 + operator), if available on this client
        try {
          const anyClient = publicClient as any;
          if (typeof anyClient.estimateTotalFee === "function") {
            totalFee = await anyClient.estimateTotalFee(req);
          }
        } catch {
          // ignore - fallback already set
        }

        setFee({ total: totalFee, gas, gasPrice });
      } catch (e: any) {
        setFeeErr(String(e?.shortMessage || e?.message || e));
        setFee(null);
      }
    }, 350);

    return () => clearTimeout(t);
  }, [publicClient, address, onBase, asset, strict, recipients, amountsETH, parsed]);

  async function decodeReceipt(logs: any[], decimals: number, unitLabel: string) {
    const decoded = parseEventLogs({ abi: multisenderAbi, logs });
    const rows: ReceiptRow[] = [];
    let lastSummary: any = null;

    for (const e of decoded) {
      if (e.eventName === "BatchSummary") lastSummary = e.args;

      if (e.eventName === "ETH_Item") {
        const idx = Number(e.args.index as bigint);
        const to = String(e.args.to);
        const amt = e.args.amount as bigint;
        const ok = Boolean(e.args.success);
        const rd = e.args.returnDataTruncated as Hex;
        rows.push({
          index: idx,
          to,
          amount: `${fmtEth(formatUnits(amt, decimals))} ${unitLabel}`,
          status: ok ? "success" : "failed",
          reason: ok ? undefined : decodeRevertLike(rd),
        });
      }

      if (e.eventName === "ERC20_Item") {
        const idx = Number(e.args.index as bigint);
        const to = String(e.args.to);
        const amt = e.args.amount as bigint;
        const ok = Boolean(e.args.success);
        const rd = e.args.returnDataTruncated as Hex;
        rows.push({
          index: idx,
          to,
          amount: `${formatUnits(amt, decimals)} ${unitLabel}`,
          status: ok ? "success" : "failed",
          reason: ok ? undefined : decodeRevertLike(rd),
        });
      }
    }

    rows.sort((a, b) => a.index - b.index);
    setReceiptRows(rows);

    if (lastSummary) {
      setSummary({
        successCount: lastSummary.successCount as bigint,
        failCount: lastSummary.failCount as bigint,
        unsent: lastSummary.unsentOrRefundedAmount as bigint,
      });
    } else {
      setSummary(null);
    }
  }

  async function sendETH() {
    await ensureReady();

    setTxHash(null);
    setSummary(null);
    setReceiptRows([]);

    setStatus({ kind: "loading", message: "Preparing transaction..." });

    const total = amountsETH.reduce((a, b) => a + b, 0n);
    const fn = strict ? "sendETHStrict" : "sendETHBestEffort";
    const data = encodeFunctionData({ abi: multisenderAbi, functionName: fn, args: [recipients, amountsETH] });

    const hash = await walletClient!.sendTransaction({
      to: MULTISENDER,
      data,
      value: total,
      account: address!,
    });

    setTxHash(hash);
    setStatus({ kind: "loading", message: "Confirming on-chain..." });

    const rcpt = await publicClient!.waitForTransactionReceipt({ hash });
    await decodeReceipt(rcpt.logs, 18, "ETH");

    setStatus({ kind: "ok", message: "Batch sent successfully." });
  }

  async function sendERC20() {
    await ensureReady();
    if (!isAddress(token) || token === "0x0000000000000000000000000000000000000000") {
      throw new Error("Enter a valid token address");
    }
    if (!parsed.ok) throw new Error(parsed.error);
    if (!totals) throw new Error("Enter recipients first");

    setTxHash(null);
    setSummary(null);
    setReceiptRows([]);

    const total = totals.totalWei;
    if (total > MAX_UINT160) throw new Error("Total exceeds uint160 limit. Split into smaller batches.");
    if (tokenAllowance < total) throw new Error("Not approved yet. Click Approve first.");

    setStatus({ kind: "loading", message: "Preparing signature..." });

    const allowanceData = await publicClient!.readContract({
      address: PERMIT2,
      abi: permit2Abi,
      functionName: "allowance",
      args: [address!, token, MULTISENDER],
    });

    const nonce = allowanceData[2];

    const permitSingle = {
      details: {
        token,
        amount: total,
        expiration: deadline(60 * 60 * 24 * 30),
        nonce,
      },
      spender: MULTISENDER,
      sigDeadline: BigInt(deadline(60 * 10)),
    } as const;

    const { domain, types, values } = AllowanceTransfer.getPermitData(permitSingle as any, PERMIT2, CHAIN_ID);

    setStatus({ kind: "loading", message: "Requesting signature..." });
    const signature = await walletClient!.signTypedData({
      account: address!,
      domain: domain as any,
      types: types as any,
      primaryType: "PermitSingle",
      message: values as any,
    });

    setStatus({ kind: "loading", message: "Sending transaction..." });
    const fn = strict ? "sendERC20Permit2Strict" : "sendERC20Permit2BestEffort";
    const data = encodeFunctionData({
      abi: multisenderAbi,
      functionName: fn as any,
      args: [permitSingle as any, signature, recipients, amountsToken],
    });

    const hash = await walletClient!.sendTransaction({ to: MULTISENDER, data, account: address! });

    setTxHash(hash);
    setStatus({ kind: "loading", message: "Confirming on-chain..." });

    const rcpt = await publicClient!.waitForTransactionReceipt({ hash });
    await decodeReceipt(rcpt.logs, tokenDecimals, tokenSymbol || "TOKEN");
    await refreshTokenMeta(token);

    setStatus({ kind: "ok", message: "Batch sent successfully." });
  }

  // skeleton to prevent initial flash / hydration mismatch
  if (!mounted) {
    return (
      <main className="min-h-screen text-zinc-100">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <div className="h-9 w-64 rounded-xl bg-white/10" />
          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-7 rounded-2xl border border-white/10 bg-white/[0.04] p-6">
              <div className="h-8 w-44 rounded-xl bg-white/10" />
              <div className="mt-5 h-48 w-full rounded-2xl bg-white/5" />
              <div className="mt-5 h-10 w-40 rounded-xl bg-white/10" />
            </div>
            <div className="lg:col-span-5 space-y-6">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                <div className="h-6 w-28 rounded-xl bg-white/10" />
                <div className="mt-4 h-28 w-full rounded-2xl bg-white/5" />
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                <div className="h-6 w-28 rounded-xl bg-white/10" />
                <div className="mt-4 h-24 w-full rounded-2xl bg-white/5" />
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen text-zinc-100">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-zinc-200" />
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Base MultiSender</h1>
              <Badge className="ml-2" tone="neutral">
                No protocol fee
              </Badge>
            </div>
            <p className="text-sm text-zinc-400">No protocol fee. Pay only network gas.</p>
          </div>
          <WalletConnect />
        </header>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left */}
          <div className="lg:col-span-7">
            <Card>
          <CardHeader>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setAsset("ETH")}
                    className={cn(
                      "inline-flex items-center rounded-xl border px-3 py-2 text-sm font-medium transition",
                      asset === "ETH"
                        ? "border-white/30 bg-white text-black shadow-[0_0_0_1px_rgba(255,255,255,0.35),0_0_24px_rgba(255,255,255,0.12)]"
                        : "border-white/12 bg-white/5 text-zinc-200 hover:bg-white/10"
                    )}
                  >
                    ETH
                  </button>
                  <button
                    onClick={() => setAsset("ERC20")}
                    className={cn(
                      "inline-flex items-center rounded-xl border px-3 py-2 text-sm font-medium transition",
                      asset === "ERC20"
                        ? "border-white/30 bg-white text-black shadow-[0_0_0_1px_rgba(255,255,255,0.35),0_0_24px_rgba(255,255,255,0.12)]"
                        : "border-white/12 bg-white/5 text-zinc-200 hover:bg-white/10"
                    )}
                  >
                    ERC20
                  </button>
                </div>

                <div className="ml-auto flex flex-col items-end gap-3">
  <div className="flex flex-wrap items-center gap-2">
    <span className="text-xs text-zinc-400">Mode</span>
    <button
      onClick={() => setStrict(true)}
      className={cn(
        "inline-flex items-center rounded-xl border px-3 py-2 text-sm font-medium transition",
        strict
          ? "border-white/30 bg-white text-black shadow-[0_0_0_1px_rgba(255,255,255,0.35),0_0_24px_rgba(255,255,255,0.12)]"
          : "border-white/12 bg-white/5 text-zinc-200 hover:bg-white/10"
      )}
      title="All-or-nothing"
    >
      Strict
    </button>
    <button
      onClick={() => setStrict(false)}
      className={cn(
        "inline-flex items-center rounded-xl border px-3 py-2 text-sm font-medium transition",
        !strict
          ? "border-white/30 bg-white text-black shadow-[0_0_0_1px_rgba(255,255,255,0.35),0_0_24px_rgba(255,255,255,0.12)]"
          : "border-white/12 bg-white/5 text-zinc-200 hover:bg-white/10"
      )}
      title="Continue on failures and report results"
    >
      Best-effort
    </button>
  </div>

  <div className="flex flex-wrap items-center justify-end gap-2">
    <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/12 bg-white/5 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/10">
      <Upload className="h-4 w-4" />
      Upload CSV
      <input
        type="file"
        accept=".csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) uploadCsv(f).catch((err) => setStatus({ kind: "error", message: friendlyError(err) }));
        }}
      />
    </label>

    <button
      onClick={resetAll}
      className="inline-flex items-center gap-2 rounded-xl border border-white/12 bg-white/5 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:bg-white/10"
      title="Clear recipients and receipt"
    >
      <RotateCcw className="h-4 w-4" />
      Reset
    </button>
  </div>
</div>
              </div>
            </CardHeader>

            <CardContent className="space-y-5">
              {!onBase && (
                <div className="flex items-start gap-3 rounded-xl border border-amber-400/20 bg-amber-400/10 p-4">
                  <Info className="h-5 w-5 text-amber-200 mt-0.5" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-amber-100">Wrong network</div>
                    <div className="text-xs text-amber-200/80 mt-1">Switch your wallet to Base mainnet.</div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={switching}
                    onClick={() => switchChain({ chainId: CHAIN_ID })}
                  >
                    {switching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Switch"}
                  </Button>
                </div>
              )}

              {asset === "ERC20" ? (
                <div className="space-y-2">
                  <label className="text-sm text-zinc-300">Token</label>
                  <Input
                    value={token}
                    onChange={(e) => setToken(e.target.value as any)}
                    placeholder="Token address (0x...)"
                    spellCheck={false}
                  />
                  <div className="flex flex-wrap gap-3 text-xs text-zinc-400">
                    <span>
                      Symbol: <span className="text-zinc-200">{tokenSymbol || "-"}</span>
                    </span>
                    <span>
                      Decimals: <span className="text-zinc-200">{tokenDecimals}</span>
                    </span>
                    <span>
                      Allowance:{" "}
                      <span className="text-zinc-200">
                        {tokenSymbol ? `${formatUnits(tokenAllowance, tokenDecimals)} ${tokenSymbol}` : tokenAllowance.toString()}
                      </span>
                    </span>
                  </div>
                  <div className="text-xs text-zinc-500">
                    Approve is a one-time permission for this batch amount. You still sign the transaction.
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm text-zinc-300">Recipients</label></div>

                {/* Numbered editor */}
                <div className="rounded-xl border border-white/10 bg-black/30 focus-within:ring-2 focus-within:ring-white/10">
                  <div
                    className={cn(
                      "flex w-full",
                      "scrollbar-dark ", "bg-black/30 ", editorExpanded ? "overflow-visible" : "overflow-y-auto"
                    )}
                    style={!editorExpanded ? { height: collapsedHeightPx } : undefined}
                  >
                    <pre
                      className="flex-none select-none border-r border-white/10 bg-white/[0.04] px-3 py-4 text-right font-mono text-sm tabular-nums leading-6 text-zinc-500"
                      style={{ width: 46 }}
                      aria-hidden="true"
                    >
                      {Array.from({ length: lineCount }, (_, i) => i + 1).join("\n")}
                    </pre>

                    <textarea
                      value={rawList}
                      onChange={(e) => setRawList(e.target.value)}
                      placeholder={`0x1111111111111111111111111111111111111111,0.01\n0x2222222222222222222222222222222222222222,0.02`}
                      wrap="off"
                      spellCheck={false}
                      className={cn(
                        "w-full bg-transparent p-4 font-mono text-sm leading-6 text-zinc-100 outline-none",
                        "resize-none whitespace-pre [overflow-wrap:normal]",
                        "overflow-x-auto overflow-y-hidden"
                      )}
                      style={{ height: contentHeightPx, resize: "none" }}
                    />
                  </div>
                </div>

<div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="text-zinc-400">
                    {parsed.ok ? (
                      <span>
                        Parsed: <span className="text-zinc-200">{parsed.rows.length}</span> recipients
                        {parsed.warnings.length ? <span className="ml-2 text-amber-200">({parsed.warnings[0]})</span> : null}
                      </span>
                    ) : (
                      <span className="text-red-200">{parsed.error}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
  <span className="text-zinc-500">Format: address,amount (one per line)</span>
  <button
    type="button"
    onClick={() => setEditorExpanded((v) => !v)}
    className={cn(
      "inline-flex items-center rounded-xl border px-3 py-1.5 text-xs font-medium transition",
      editorExpanded
        ? "border-white/30 bg-white text-black shadow-[0_0_0_1px_rgba(255,255,255,0.35),0_0_24px_rgba(255,255,255,0.12)]"
        : "border-white/12 bg-white/5 text-zinc-200 hover:bg-white/10"
    )}
    title="Increase editor height (page will expand)"
  >
    {editorExpanded ? "Collapse" : "Expand"}
  </button>
</div>
                </div>
              </div>

              {/* Primary actions (separate layer) */}
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="flex flex-wrap items-center gap-3">
                  {asset === "ERC20" ? (
                    <Button
                      variant="secondary"
                      disabled={!address || !onBase || !parsed.ok || parsed.rows.length === 0 || !isAddress(token) || token === "0x0000000000000000000000000000000000000000" || status.kind === "loading" || !needsApproval}
                      onClick={() => {
                        setStatus({ kind: "idle", message: "" });
                        approveTokenExact().catch((e) => setStatus({ kind: "error", message: friendlyError(e) }));
                      }}
                      title="Approve exact total amount for this batch"
                    >
                      {status.kind === "loading" && needsApproval ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Approve
                    </Button>
                  ) : null}

                  <Button
                    variant="primary"
                    disabled={!canSend || status.kind === "loading"}
                    onClick={() => {
                      setStatus({ kind: "idle", message: "" });
                      (asset === "ETH" ? sendETH() : sendERC20()).catch((e) =>
                        setStatus({ kind: "error", message: friendlyError(e) })
                      );
                    }}
                  >
                    {status.kind === "loading" && canSend ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {asset === "ETH" ? "Send ETH" : "Send Token"}
                    <ArrowRight className="h-4 w-4" />
                  </Button>

                  {txHash ? (
                    <Button variant="secondary" onClick={() => window.open(EXPLORER_TX + txHash, "_blank")}>
                      Explorer <ExternalLink className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </div>

              {status.kind !== "idle" && status.message ? (
                <div
                  className={
                    "rounded-xl border p-4 text-sm " +
                    (status.kind === "error"
                      ? "border-red-400/20 bg-red-400/10 text-red-100"
                      : status.kind === "ok"
                      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                      : "border-white/10 bg-black/20 text-zinc-200")
                  }
                >
                  {status.message}
                </div>
              ) : null}
            </CardContent>
          </Card>
          </div>

          {/* Right */}
          <div className="lg:col-span-5 space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">Review</div>
                  <Badge tone={strict ? "good" : "warn"}>{strict ? "Strict" : "Best-effort"}</Badge>
                </div>
              </CardHeader>

              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Network</span>
                  <span className="text-zinc-200">{onBase ? "Base mainnet" : "Not Base"}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Sender</span>
                  <span className="font-mono text-xs">{address ? shortAddr(address) : "-"}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Contract</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs">{isAddress(MULTISENDER) ? shortAddr(MULTISENDER) : "-"}</span>
                    {isAddress(MULTISENDER) ? (
                      <button
                        className="rounded-lg border border-white/10 bg-white/10 p-1 hover:bg-white/15"
                        onClick={() => navigator.clipboard.writeText(MULTISENDER)}
                        title="Copy address"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="h-px bg-white/10 my-3" />

                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Recipients</span>
                  <span className="text-zinc-200">{parsed.ok ? parsed.rows.length : 0}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Total</span>
                  <span className="text-zinc-200">{totals ? totals.display : "-"}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Estimated fee</span>
                  <span className="text-zinc-200">{asset === "ETH" ? feeDisplay ?? "—" : "—"}</span>
                </div>

                {feeErr && asset === "ETH" ? (
                  <div className="text-xs text-amber-200/80">Fee estimate unavailable: {feeErr}</div>
                ) : null}

                {asset === "ERC20" && needsApproval ? (
                  <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-xs text-amber-100">
                    <Info className="h-4 w-4 mt-0.5" />
                    <div>
                      Approval required for this batch total. Click <b>Approve</b>, then <b>Send Token</b>.
                    </div>
                  </div>
                ) : null}

                <div className="mt-3 flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-zinc-300">
                  <Info className="h-4 w-4 mt-0.5 text-zinc-400" />
                  <div>
                    {strict ? (
                      <span>Strict mode is atomic (all-or-nothing). If any transfer fails, the transaction reverts.</span>
                    ) : (
                      <span>Best-effort continues on failures and reports which recipients failed.</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {txHash ? (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">Receipt</div>
                    <Badge tone="neutral" className="font-mono">
                      {shortAddr(txHash)}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {summary ? (
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                        <div className="text-xs text-zinc-400">Success</div>
                        <div className="mt-1 text-lg font-semibold text-zinc-100">{String(summary.successCount ?? 0n)}</div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                        <div className="text-xs text-zinc-400">Failed</div>
                        <div className="mt-1 text-lg font-semibold text-zinc-100">{String(summary.failCount ?? 0n)}</div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                        <div className="text-xs text-zinc-400">Unsent / Refunded</div>
                        <div className="mt-1 text-lg font-semibold text-zinc-100">
                          {summary.unsent ? fmtEth(formatUnits(summary.unsent, asset === "ETH" ? 18 : tokenDecimals)) : "0"}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <ReceiptTable rows={receiptRows} />

                  <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                    <div className="flex flex-wrap gap-3">
                      <Button
                        variant="secondary"
                        className="min-w-[140px]"
                        onClick={() => window.open(EXPLORER_TX + txHash, "_blank")}
                      >
                        Explorer <ExternalLink className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        className="min-w-[160px]"
                        onClick={() => navigator.clipboard.writeText(txHash)}
                      >
                        Copy Tx Hash <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
