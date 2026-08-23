"use client";

import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { base } from "wagmi/chains";
import { baseAccount, injected, walletConnect } from "wagmi/connectors";

type WalletConnectLogger = NonNullable<Parameters<typeof walletConnect>[0]["logger"]>;

function createWalletConnectLogger(bindings: Record<string, unknown> = {}): WalletConnectLogger {
  const noop = () => undefined;
  const logger = {
    level: "silent",
    fatal: noop,
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    trace: noop,
    silent: noop,
    bindings: () => bindings,
    child: (childBindings: Record<string, unknown>) =>
      createWalletConnectLogger({ ...bindings, ...childBindings }),
  };
  return logger as unknown as WalletConnectLogger;
}

const walletConnectProjectId =
  typeof window === "undefined"
    ? undefined
    : process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();

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
    ...(walletConnectProjectId
      ? [
          walletConnect({
            projectId: walletConnectProjectId,
            logger: createWalletConnectLogger(),
            showQrModal: true,
            metadata: {
              name: "Base MultiSender",
              description: "0 protocol fee multi-sender on Base",
              url: "https://bulksender.rakibhq.xyz",
              icons: ["https://bulksender.rakibhq.xyz/icon.png"],
            },
            qrModalOptions: {
              themeMode: "dark",
            },
          }),
        ]
      : []),
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
