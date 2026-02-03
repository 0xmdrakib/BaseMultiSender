"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ChevronDown, Wallet } from "lucide-react";

export default function WalletConnect() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openConnectModal, openAccountModal, openChainModal }) => {
        const ready = mounted;
        const connected = ready && account && chain;

        return (
          <div
            aria-hidden={!ready}
            style={{
              opacity: !ready ? 0 : 1,
              pointerEvents: !ready ? "none" : "auto",
            }}
          >
            {!connected ? (
              <button
                onClick={openConnectModal}
                className="group inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur px-3 py-2 sm:px-4 text-sm font-medium text-zinc-100 shadow-[0_10px_24px_rgba(0,0,0,0.35)] hover:bg-white/[0.10] hover:border-white/15 active:scale-[0.99] whitespace-nowrap"
              >
                <Wallet className="h-4 w-4 text-zinc-200" />
                <span className="hidden sm:inline">Connect Wallet</span>
                <span className="sm:hidden">Connect</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                {chain?.unsupported ? (
                  <button
                    onClick={openChainModal}
                    className="inline-flex items-center gap-2 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-sm text-amber-100 hover:bg-amber-300/15"
                  >
                    Wrong network <ChevronDown className="h-4 w-4" />
                  </button>
                ) : null}

                <button
                  onClick={openAccountModal}
                  className="group inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur px-3 py-2 sm:px-4 text-sm font-medium text-zinc-100 shadow-[0_10px_24px_rgba(0,0,0,0.35)] hover:bg-white/[0.10] hover:border-white/15 active:scale-[0.99] max-w-[210px] sm:max-w-none"
                  title={account?.address}
                >
                  {chain?.hasIcon && chain.iconUrl ? (
                    <span
                      className="relative h-5 w-5 overflow-hidden rounded-full ring-1 ring-white/15"
                      style={{ background: chain.iconBackground }}
                      aria-hidden
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={chain.iconUrl} alt={chain.name ?? ""} className="h-5 w-5" />
                    </span>
                  ) : null}
                  <span className="font-mono truncate">{account?.displayName}</span>
                  <ChevronDown className="h-4 w-4 text-zinc-300 transition group-hover:text-zinc-100" />
                </button>
              </div>
            )}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
