"use client";

import { useEffect, useState } from "react";
import { useSocket } from "./socket";
import type { SystemStatus } from "./types";

/**
 * Hook for system status polling.
 */
export function useStatus(intervalMs = 5000) {
  const { socket, connected } = useSocket();
  const [status, setStatus] = useState<SystemStatus | null>(null);

  useEffect(() => {
    if (!socket || !connected) return;

    const request = () => socket.emit("status:request");

    socket.on("status:update", (data: SystemStatus) => setStatus(data));

    // Request immediately and then at interval
    request();
    const handle = setInterval(request, intervalMs);

    return () => {
      socket.off("status:update");
      clearInterval(handle);
    };
  }, [socket, connected, intervalMs]);

  return { status, connected };
}
