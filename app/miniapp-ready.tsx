"use client";

import { useEffect, useRef } from "react";
import { sdk } from "@farcaster/miniapp-sdk";

/**
 * Signals to Base App / Farcaster hosts that the Mini App is ready to be shown.
 * Safe to run on the open web: if the SDK/host isn't available, it silently no-ops.
 */
export function MiniAppReady() {
  const called = useRef(false);

  useEffect(() => {
    if (called.current) return;
    called.current = true;

    (async () => {
      try {
        // Only call ready when hosted in a Mini App environment.
        const isMiniApp = typeof sdk?.isInMiniApp === "function" ? sdk.isInMiniApp() : true;
        if (!isMiniApp) return;

        await sdk.actions.ready();
      } catch {
        // Not running inside a Mini App host (or SDK not available) — ignore.
      }
    })();
  }, []);

  return null;
}
