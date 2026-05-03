"use client";

import React, { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { base } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { sdk } from "@farcaster/miniapp-sdk";
import { farcasterMiniApp } from "@farcaster/miniapp-wagmi-connector";

import MiniAppAutoConnect from "./miniapp-autoconnect";

const browserConfig = createConfig({
  chains: [base],
  transports: {
    [base.id]: http(),
  },
  connectors: [
    injected({
      shimDisconnect: true,
    }),
  ],
  multiInjectedProviderDiscovery: true,
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

  const activeConfig = useMemo(() => (isMiniApp ? miniAppConfig : browserConfig), [isMiniApp]);

  return (
    <WagmiProvider config={activeConfig}>
      <QueryClientProvider client={queryClient}>
        {isMiniApp ? <MiniAppAutoConnect /> : null}
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
