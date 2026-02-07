"use client";

import { useEffect, useRef } from "react";
import { useAccount, useConnect } from "wagmi";

/**
 * Auto-connect inside Farcaster/Base Mini App hosts.
 *
 * In mini-app mode our wagmi config only includes the Farcaster Mini App connector,
 * so `connectors[0]` is always the host wallet connector.
 */
export default function MiniAppAutoConnect() {
  const { isConnected } = useAccount();
  const { connectors, connectAsync } = useConnect();
  const attempted = useRef(false);

  useEffect(() => {
    if (isConnected || attempted.current) return;
    const connector = connectors[0];
    if (!connector) return;

    attempted.current = true;
    connectAsync({ connector }).catch(() => {
      // If the host is not available (or user cancels), don't loop.
    });
  }, [isConnected, connectors, connectAsync]);

  return null;
}
