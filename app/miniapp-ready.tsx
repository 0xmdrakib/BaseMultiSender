"use client";

import { useEffect, useRef } from "react";

export function MiniAppReady() {
  const called = useRef(false);

  useEffect(() => {
    if (called.current) return;
    called.current = true;

    (async () => {
      try {
        const { sdk } = await import("@farcaster/miniapp-sdk");
        await sdk.actions.ready();
      } catch {
        // Not running inside a Mini App host (or SDK not available) — ignore.
      }
    })();
  }, []);

  return null;
}
