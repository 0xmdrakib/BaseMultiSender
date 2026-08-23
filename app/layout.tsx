import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

const BASE_APP_ID = "6984b4b77a0334031d134545";

export const metadata: Metadata = {
  title: "Base MultiSender",
  description: "0 protocol fee multi-sender on Base",
  other: {
    // Base App registration. Keep this when serving the app as a standard web app.
    "base:app_id": BASE_APP_ID,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
