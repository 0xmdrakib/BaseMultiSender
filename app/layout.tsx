import type { Metadata } from "next";
import "./globals.css";
import "@rainbow-me/rainbowkit/styles.css";
import { Providers } from "./providers";

// Mini App compatibility
import { MiniAppReady } from "./miniapp-ready";

const APP_URL = "https://multisender.online";
const BASE_APP_ID = "6984b4b77a0334031d134545";

// Embed metadata (fc:miniapp) is what Base Build Preview uses to render the image preview.
// It must be present on the *homeUrl* page.
const MINIAPP_EMBED = {
  version: "next",
  // Put this file in /public (or change the path to whatever you use).
  imageUrl: `${APP_URL}/hero.png`,
  button: {
    title: "Open Base MultiSender",
    action: {
      type: "launch_frame",
      url: `${APP_URL}/`,
    },
  },
} as const;

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: "Base MultiSender",
  description: "0 protocol fee multi-sender on Base",
  other: {
    // Base App verification
    "base:app_id": BASE_APP_ID,
    // Rich embeds / previews (Base + Farcaster)
    "fc:miniapp": JSON.stringify(MINIAPP_EMBED),
    // Backward compatibility for some clients/tools
    "fc:frame": JSON.stringify(MINIAPP_EMBED),
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
