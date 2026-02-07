"use client";

import "@rainbow-me/rainbowkit/styles.css";
import React, { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { WagmiProvider, createConfig, http } from "wagmi";
import { base } from "wagmi/chains";
import { sdk } from "@farcaster/miniapp-sdk";
import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";

import MiniAppAutoConnect from "./miniapp-autoconnect";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "YOUR_PROJECT_ID";

const config = getDefaultConfig({
  appName: "Base MultiSender",
  projectId,
  chains: [base],
  ssr: false,
});

const miniAppConfig = createConfig({
  chains: [base],
  transports: {
    [base.id]: http(),
  },
  connectors: [farcasterMiniApp()],
  ssr: false,
});

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  const [isMiniApp, setIsMiniApp] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ok = await sdk.isInMiniApp();
        if (!cancelled) setIsMiniApp(Boolean(ok));
      } catch {
        if (!cancelled) setIsMiniApp(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeConfig = useMemo(() => (isMiniApp ? miniAppConfig : config), [isMiniApp]);

  return (
    <WagmiProvider config={activeConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          {isMiniApp ? <MiniAppAutoConnect /> : null}
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
