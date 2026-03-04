"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSocket } from "@/lib/socket";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

function OAuthCallbackContent() {
  const searchParams = useSearchParams();
  const { socket } = useSocket();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const errorParam = searchParams.get("error");

    if (errorParam) {
      setStatus("error");
      setError(searchParams.get("error_description") || errorParam);
      return;
    }

    if (!code) {
      setStatus("error");
      setError("No authorization code received");
      return;
    }

    // Determine provider from the path
    const path = window.location.pathname;
    let provider = "";
    if (path.includes("/oauth/google")) provider = "google";
    else if (path.includes("/oauth/microsoft")) provider = "microsoft";
    else if (path.includes("/oauth/github")) provider = "github";

    if (!provider) {
      setStatus("error");
      setError("Unknown OAuth provider");
      return;
    }

    // Get redirect URI from session storage
    const redirectUri = sessionStorage.getItem("oauth_redirect_uri") || undefined;

    // Wait for socket connection
    const connectSocket = () => {
      if (!socket) {
        setTimeout(connectSocket, 100);
        return;
      }

      // Send the code to the gateway
      socket.emit(`oauth:${provider}:callback`, { code, state, redirectUri });

      // Listen for response
      socket.on(`oauth:connected`, (data: { provider: string; success: boolean; token?: string }) => {
        if (data.provider === provider && data.success) {
          // If token provided, store it and auto-authenticate
          if (data.token) {
            localStorage.setItem("gateway_token", data.token);
            localStorage.setItem("setup_completed", "true");
          }
          setStatus("success");
        }
      });

      socket.on(`oauth:error`, (data: { provider: string; error: string }) => {
        if (data.provider === provider) {
          setStatus("error");
          setError(data.error);
        }
      });
    };

    connectSocket();
  }, [socket, searchParams]);

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white/[0.03] border border-white/[0.06] rounded-2xl p-8 text-center">
        {status === "loading" && (
          <>
            <Loader2 className="w-16 h-16 text-blue-400 animate-spin mx-auto mb-4" />
            <h1 className="text-xl font-light text-white mb-2">Connecting...</h1>
            <p className="text-white/40 text-sm">Please wait while we complete the authentication.</p>
          </>
        )}

        {status === "success" && (
          <>
            <CheckCircle className="w-16 h-16 text-emerald-400 mx-auto mb-4" />
            <h1 className="text-xl font-light text-white mb-2">Connected Successfully!</h1>
            <p className="text-white/40 text-sm mb-4">Your account has been linked. You can close this window.</p>
            <button
              onClick={() => window.close()}
              className="px-6 py-2 bg-emerald-500 hover:bg-emerald-400 text-black text-sm font-medium rounded-xl transition-colors"
            >
              Close Window
            </button>
          </>
        )}

        {status === "error" && (
          <>
            <XCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
            <h1 className="text-xl font-light text-white mb-2">Connection Failed</h1>
            <p className="text-white/40 text-sm mb-4">{error || "An error occurred during authentication."}</p>
            <button
              onClick={() => window.close()}
              className="px-6 py-2 bg-white/10 hover:bg-white/20 text-white text-sm font-medium rounded-xl transition-colors"
            >
              Close Window
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function OAuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <Loader2 className="w-16 h-16 text-blue-400 animate-spin" />
      </div>
    }>
      <OAuthCallbackContent />
    </Suspense>
  );
}
