"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { Lock, Eye, EyeOff } from "lucide-react";

export function AuthModal() {
  const { authenticated, loading, login } = useAuth();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isFirstTime, setIsFirstTime] = useState(false);
  const router = useRouter();

  // Check if PIN has been configured
  useEffect(() => {
    // Check localStorage for first-time indicator
    const hasCompletedSetup = localStorage.getItem("setup_completed");
    setIsFirstTime(!hasCompletedSetup);
  }, []);

  // Don't show modal if loading, already authenticated, or on setup page
  if (loading || authenticated || typeof window === "undefined") {
    return null;
  }

  // Check if we're on setup page
  if (typeof window !== "undefined" && window.location.pathname === "/setup") {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    const success = await login(pin);
    if (!success) {
      setError("Invalid PIN");
      setPin("");
    } else {
      // Mark setup as completed after first successful login
      localStorage.setItem("setup_completed", "true");
    }
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-[#111] border border-white/10 rounded-2xl p-8 w-full max-w-md mx-4">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center">
            <Lock size={24} className="text-emerald-400" />
          </div>
          <div>
            <h2 className="text-xl font-light">FastBot</h2>
            <p className="text-sm text-white/40">
              {isFirstTime ? "Choose a PIN to access your dashboard" : "Enter your PIN to continue"}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="relative mb-6">
            <input
              type={showPin ? "text" : "password"}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder={isFirstTime ? "Choose a PIN (min 4 characters)" : "Enter PIN"}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 pr-12 text-lg tracking-widest focus:outline-none focus:border-emerald-500/50 transition-colors"
              maxLength={20}
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPin(!showPin)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60 transition-colors"
            >
              {showPin ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>

          {error && (
            <p className="text-red-400 text-sm mb-4">{error}</p>
          )}

          <button
            type="submit"
            disabled={pin.length < 4 || submitting}
            className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-white/10 disabled:text-white/40 text-black font-medium py-3 rounded-xl transition-colors"
          >
            {submitting ? "Verifying..." : (isFirstTime ? "Set PIN" : "Unlock")}
          </button>
        </form>

        <p className="text-center text-white/30 text-sm mt-6">
          {isFirstTime ? "Choose a PIN you'll remember" : "PIN set during first-time setup"}
        </p>
      </div>
    </div>
  );
}
