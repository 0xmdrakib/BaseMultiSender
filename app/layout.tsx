import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

const BASE_APP_ID = "6984b4b77a0334031d134545";

export const metadata: Metadata = {
  metadataBase: new URL("https://bulksender.rakibhq.xyz"),
  title: "Bulk Sender",
  description: "0 protocol fee multi-sender on Base",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Bulk Sender",
    description: "0 protocol fee multi-sender on Base",
    url: "/",
    siteName: "Bulk Sender",
    images: [
      {
        url: "/embed-v4.png",
        width: 1200,
        height: 630,
        alt: "Bulk Sender on Base Chain",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bulk Sender",
    description: "0 protocol fee multi-sender on Base",
    images: ["/embed-v4.png"],
  },
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
