import type { Metadata } from "next";
import "./globals.css";
import "@rainbow-me/rainbowkit/styles.css";
import { Providers } from "./providers";
import { MiniAppReady } from "./miniapp-ready";

const APP_URL = "https://multisender.online";
const BASE_APP_ID = "6984b4b77a0334031d134545";

// Farcaster/Base Mini App embed metadata (used for previews + opening as a Mini App)
// Spec: <meta name="fc:miniapp" content="<stringified MiniAppEmbed JSON>" />
const MINIAPP_EMBED = {
  version: "1",
  // You said you'll add the embed image in /public (recommended 3:2, e.g., 1200x800)
  imageUrl: `${APP_URL}/embed.png`,
  button: {
    title: "Open Base MultiSender",
    action: {
      type: "launch_miniapp",
      name: "Base MultiSender",
      url: `${APP_URL}/`,
      // Use your existing splash assets
      splashImageUrl: `${APP_URL}/splash.png`,
      splashBackgroundColor: "#0000FF",
    },
  },
} as const;

// Backward compatibility for legacy clients that still read `fc:frame`
const LEGACY_FRAME_EMBED = {
  ...MINIAPP_EMBED,
  button: {
    ...MINIAPP_EMBED.button,
    action: {
      ...MINIAPP_EMBED.button.action,
      type: "launch_frame",
    },
  },
} as const;

export const metadata: Metadata = {
  title: "Base MultiSender",
  description: "0 protocol fee multi-sender on Base",
  other: {
    // Base Build verification
    "base:app_id": BASE_APP_ID,
    // Farcaster / Mini Apps embeds
    "fc:miniapp": JSON.stringify(MINIAPP_EMBED),
    "fc:frame": JSON.stringify(LEGACY_FRAME_EMBED),
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
