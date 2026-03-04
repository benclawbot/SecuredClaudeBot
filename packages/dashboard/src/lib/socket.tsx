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
  const dashboardPort = typeof window !== "undefined" ? window.location.port : "3100";

  // First try the dashboard's API endpoint (works in production too)
  try {
    const res = await fetch(`/api/gateway/port`, {
      method: "GET",
    });
    if (res.ok) {
      const data = await res.json();
      if (data.port) {
        return data.port;
      }
    }
  } catch {
    // Fall through to next method
  }

  // Fallback: try common ports
  const ports = [18789, 3100];

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
  authenticated: boolean;
  login: (pin: string) => Promise<boolean>;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  connected: false,
  authenticated: false,
  login: async () => false,
});

export function SocketProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const socketRef = useRef<Socket | null>(null);

  // Get stored token
  const getStoredToken = (): string | null => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("gateway_token");
  };

  // Store token
  const storeToken = (token: string) => {
    if (typeof window === "undefined") return;
    localStorage.setItem("gateway_token", token);
  };

  // Login function
  const login = async (pin: string): Promise<boolean> => {
    if (!socketRef.current) return false;

    return new Promise((resolve) => {
      // Set a timeout in case the server doesn't respond
      const timeout = setTimeout(() => {
        resolve(false);
      }, 5000);

      socketRef.current!.emit("auth:login", { pin }, (response: { token?: string; error?: string }) => {
        clearTimeout(timeout);
        if (response.token) {
          storeToken(response.token);
          setAuthenticated(true);
          resolve(true);
        } else {
          resolve(false);
        }
      });
    });
  };

  useEffect(() => {
    discoverGatewayPort().then((port) => {
      const hostname = typeof window !== "undefined" ? window.location.hostname : "127.0.0.1";
      const url = `http://${hostname}:${port}`;
      const token = getStoredToken();

      const s = io(url, {
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
        auth: token ? { token } : undefined,
      });

      s.on("connect", () => {
        setConnected(true);
        // Check if authenticated by trying auth:login with empty PIN
        // If we have a stored token, we assume we're authenticated
        if (token) {
          setAuthenticated(true);
        }
      });
      s.on("disconnect", () => {
        setConnected(false);
        setAuthenticated(false);
      });
      s.on("auth:error", () => {
        setAuthenticated(false);
        localStorage.removeItem("gateway_token");
      });
      setSocket(s);
      socketRef.current = s;
    });
  }, []);

  return (
    <SocketContext.Provider value={{ socket, connected, authenticated, login }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  return useContext(SocketContext);
}
