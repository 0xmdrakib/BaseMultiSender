"use client";

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { base } from "wagmi/chains";
import { baseAccount, injected } from "wagmi/connectors";

const config = createConfig({
  chains: [base],
  transports: {
    // The browser only sees our same-origin proxy. BASE_RPC_URL stays server-side.
    [base.id]: http("/api/rpc", {
      batch: false,
      retryCount: 1,
      timeout: 20_000,
    }),
  },
  connectors: [
    injected({
      shimDisconnect: true,
    }),
    baseAccount({
      appName: "Base MultiSender",
    }),
  ],
  multiInjectedProviderDiscovery: true,
  ssr: false,
});

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
