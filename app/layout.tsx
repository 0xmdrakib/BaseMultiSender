import type { Metadata } from "next";
import "./globals.css";
import "@rainbow-me/rainbowkit/styles.css";
import { Providers } from "./providers";
import { MiniAppReady } from "./miniapp-ready";

export const metadata: Metadata = {
  title: "Base MultiSender",
  description: "0 protocol fee multi-sender on Base",
  other: {
    "base:app_id": "6984b4b77a0334031d134545",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>
          <MiniAppReady />
          {children}
        </Providers>
      </body>
    </html>
  );
}
