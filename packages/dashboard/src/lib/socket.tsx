"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { io, type Socket } from "socket.io-client";

// Discover gateway port dynamically
async function discoverGatewayPort(): Promise<number> {
  const hostname = typeof window !== "undefined" ? window.location.hostname : "127.0.0.1";
  const ports = [18789, 3100]; // Default port + dashboard port (for proxy)

  for (const port of ports) {
    try {
      const res = await fetch(`http://${hostname}:${port}/.gateway-port`, {
        method: "GET",
      });
      if (res.ok) {
        const data = await res.json();
        return data.port;
      }
    } catch {
      // Port not available, try next
    }
  }
  return 18789; // Fallback to default
}

interface SocketContextValue {
  socket: Socket | null;
  connected: boolean;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  connected: false,
});

export function SocketProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [gatewayUrl, setGatewayUrl] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    discoverGatewayPort().then((port) => {
      const hostname = typeof window !== "undefined" ? window.location.hostname : "127.0.0.1";
      const url = `http://${hostname}:${port}`;
      setGatewayUrl(url);

      const s = io(url, {
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
      });

      socketRef.current = s;

      s.on("connect", () => setConnected(true));
      s.on("disconnect", () => setConnected(false));
    });
  }, []);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, connected }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
