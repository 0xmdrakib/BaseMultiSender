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
                className="group inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-medium text-zinc-100 shadow-sm hover:bg-white/15 hover:border-white/15 active:scale-[0.99]"
              >
                <Wallet className="h-4 w-4 text-zinc-200" />
                Connect Wallet
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
                  className="group inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-2 text-sm font-medium text-zinc-100 shadow-sm hover:bg-white/15 hover:border-white/15 active:scale-[0.99]"
                  title={account?.address}
                >
                  <span className="font-mono">{account?.displayName}</span>
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
