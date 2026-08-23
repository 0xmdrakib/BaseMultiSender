"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Loader2, Power, Wallet } from "lucide-react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { base } from "wagmi/chains";

type WalletConnector = ReturnType<typeof useConnect>["connectors"][number];

function shortAddress(address?: string) {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function normalizeWalletName(value: string) {
  return value
    .toLowerCase()
    .replace(/wallet/gu, "")
    .replace(/[^a-z0-9]/gu, "")
    .trim();
}

function isGenericInjected(connector: WalletConnector) {
  const id = connector.id.toLowerCase();
  const name = connector.name.toLowerCase();
  return id === "injected" || name === "injected" || name === "browser wallet" || name === "injected wallet";
}

function connectorKey(connector: WalletConnector) {
  const name = normalizeWalletName(connector.name);
  if (name && name !== "injected" && name !== "browser") return name;
  return connector.id.toLowerCase();
}

function dedupeConnectors(connectors: readonly WalletConnector[]) {
  const browserConnectors = connectors.filter((connector) => {
    const id = connector.id.toLowerCase();
    const name = connector.name.toLowerCase();
    return !id.includes("walletconnect") && !name.includes("walletconnect");
  });

  const hasNamedInjectedWallet = browserConnectors.some((connector) => !isGenericInjected(connector));
  const candidates = hasNamedInjectedWallet ? browserConnectors.filter((connector) => !isGenericInjected(connector)) : browserConnectors;

  const unique = new Map<string, WalletConnector>();
  for (const connector of candidates) {
    const key = connectorKey(connector);
    const existing = unique.get(key);
    if (!existing || (!existing.icon && connector.icon)) {
      unique.set(key, connector);
    }
  }

  return Array.from(unique.values());
}

function WalletLogo({ connector }: { connector: WalletConnector }) {
  if (connector.icon) {
    return (
      <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={connector.icon} alt="" className="h-7 w-7 object-contain" />
      </span>
    );
  }

  if (connector.id.toLowerCase() === "baseaccount") {
    return (
      <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="h-7 w-7"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M0 2.014C0 1.58105 0 1.36457 0.0815779 1.19805C0.159686 1.03861 0.288611 0.909686 0.448049 0.831578C0.61457 0.75 0.831047 0.75 1.264 0.75H14.736C15.169 0.75 15.3854 0.75 15.552 0.831578C15.7114 0.909686 15.8403 1.03861 15.9184 1.19805C16 1.36457 16 1.58105 16 2.014V15.486C16 15.919 16 16.1354 15.9184 16.302C15.8403 16.4614 15.7114 16.5903 15.552 16.6684C15.3854 16.75 15.169 16.75 14.736 16.75H1.264C0.831047 16.75 0.61457 16.75 0.448049 16.6684C0.288611 16.5903 0.159686 16.4614 0.0815779 16.302C0 16.1354 0 15.919 0 15.486V2.014Z"
            fill="#0000FF"
          />
        </svg>
      </span>
    );
  }

  return (
    <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200/70 bg-slate-950 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
      {connector.name.slice(0, 1).toUpperCase() || "W"}
    </span>
  );
}

export default function WalletConnect() {
  const { address, chainId, isConnected } = useAccount();
  const { connectors, connectAsync, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitchingChain } = useSwitchChain();

  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (isConnected) {
      setOpen(false);
      setError(null);
      setConnectingId(null);
    }
  }, [isConnected]);

  const availableConnectors = useMemo(() => dedupeConnectors(connectors), [connectors]);
  const isBaseChain = chainId === base.id;

  const connectToBrowserWallet = async (connector: WalletConnector) => {
    const id = connectorKey(connector);
    setConnectingId(id);
    setError(null);

    try {
      await connectAsync({ connector, chainId: base.id });
      setOpen(false);
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || "Wallet connection failed.");
    } finally {
      setConnectingId(null);
    }
  };

  const handleDisconnect = () => {
    setOpen(false);
    setError(null);
    disconnect();
  };

  if (!mounted) {
    return <div className="h-10 w-[148px] rounded-full bg-white/40" aria-hidden />;
  }

  if (isConnected) {
    return (
      <div className="flex items-center gap-2 sm:justify-end">
        {!isBaseChain ? (
          <button
            type="button"
            onClick={() => switchChain({ chainId: base.id })}
            disabled={isSwitchingChain}
            className="inline-flex items-center gap-2 rounded-full border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-sm font-semibold text-amber-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur-xl transition hover:bg-amber-100/90 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSwitchingChain ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Switch Base <ChevronDown className="h-4 w-4" />
          </button>
        ) : null}

        <div
          className="inline-flex max-w-[210px] items-center gap-2 rounded-full border border-white/75 bg-white/[0.70] px-3 py-2 text-sm font-semibold text-slate-700 shadow-[0_10px_26px_rgba(15,23,42,0.055),inset_0_1px_0_rgba(255,255,255,0.92)] backdrop-blur-2xl sm:max-w-none"
          title={address}
        >
          <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]" aria-hidden />
          <span className="truncate font-mono">{shortAddress(address)}</span>
          <button
            type="button"
            onClick={handleDisconnect}
            aria-label="Disconnect wallet"
            title="Disconnect"
            className="ml-1 rounded-full p-1 text-slate-400 transition hover:bg-slate-950/[0.06] hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/[0.12]"
          >
            <Power className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  const walletDialog =
    open ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close wallet dialog"
            className="absolute inset-0 bg-slate-950/30 backdrop-blur-md"
            onClick={() => setOpen(false)}
          />

          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-dialog-title"
            className="relative w-full max-w-sm rounded-[30px] border border-white/80 bg-[#fbfaf4]/95 p-4 shadow-[0_28px_76px_rgba(15,23,42,0.16),inset_0_1px_0_rgba(255,255,255,0.94)] backdrop-blur-2xl sm:p-5"
          >
            <div className="px-1 pb-3">
              <h2 id="wallet-dialog-title" className="text-lg font-semibold tracking-[-0.02em] text-slate-950">
                Choose wallet
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                {availableConnectors.length > 1
                  ? "Multiple browser wallets detected. Pick one to use on Base."
                  : "Pick the injected wallet to use on Base."}
              </p>
            </div>

            <div className="space-y-2">
              {availableConnectors.length > 0 ? (
                availableConnectors.map((connector) => {
                  const id = connectorKey(connector);
                  const isConnecting = connectingId === id;

                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => void connectToBrowserWallet(connector)}
                      disabled={isPending || Boolean(connectingId)}
                      className="group flex w-full items-center gap-3 rounded-[18px] border border-slate-200/80 bg-white/55 px-3 py-3 text-left text-sm font-semibold text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.88)] transition hover:-translate-y-0.5 hover:border-slate-300/90 hover:bg-white/90 hover:shadow-[0_12px_26px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.95)] disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      <WalletLogo connector={connector} />
                      <span className="min-w-0 flex-1 truncate">{connector.name}</span>
                      {isConnecting ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-500" /> : null}
                    </button>
                  );
                })
              ) : (
                <div className="rounded-[18px] border border-amber-200/80 bg-amber-50/70 px-3 py-3 text-sm leading-6 text-amber-800">
                  No injected wallet was detected. Install a wallet extension that supports EIP-6963, then refresh the page.
                </div>
              )}
            </div>

            {error ? <div className="mt-3 rounded-2xl border border-rose-200/80 bg-rose-50/75 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-4 rounded-full px-2 py-2 text-sm font-semibold text-slate-700 transition hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/[0.12]"
            >
              Cancel
            </button>
          </div>
      </div>
    ) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="group inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/[0.58] px-3 py-2 text-sm font-semibold text-slate-700 shadow-[0_10px_26px_rgba(15,23,42,0.055),inset_0_1px_0_rgba(255,255,255,0.92)] backdrop-blur-2xl transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/[0.86] hover:text-slate-950 hover:shadow-[0_16px_34px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.96)] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/[0.12] disabled:cursor-not-allowed disabled:opacity-70 sm:px-4"
      >
        <span className="h-2 w-2 rounded-full bg-[#020617] shadow-[0_0_0_4px_rgba(2,6,23,0.08),0_0_18px_rgba(2,6,23,0.22)]" aria-hidden />
        <Wallet className="h-4 w-4 text-slate-500 transition group-hover:text-slate-700" />
        <span className="hidden sm:inline">Connect Wallet</span>
        <span className="sm:hidden">Connect</span>
      </button>

      {walletDialog ? createPortal(walletDialog, document.body) : null}
    </>
  );
}
