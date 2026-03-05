"use client";

import { useState, useEffect } from "react";
import { useSocket } from "@/lib/socket";
import { Key, AlertCircle, Check, Loader2 } from "lucide-react";

const PROVIDER_MODELS: Record<string, string[]> = {
  anthropic: ["claude-sonnet-4-20250514", "claude-3-5-haiku-20241022", "claude-opus-4-6-20250514"],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1", "o1-mini", "o3-mini"],
  google: ["gemini-2.0-flash", "gemini-2.0-flash-thinking", "gemini-1.5-pro", "gemini-1.5-flash"],
  mistral: ["mistral-large-latest", "pixtral-large-latest", "mistral-small-latest"],
  cohere: ["command-a-03-2025", "command-r-plus", "command-r-7b-12-2024"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  groq: ["llama-3.3-70b-versatile", "mixtral-8x7b-32768", "llama-3.1-70b-speculative"],
  ollama: ["llama3.3", "llama3.2", "mistral", "phi4", "qwen2.5", "codellama", "deepseek-coder"],
  minimax: ["M2.5", "M2.5-Lightning", "M2-her", "M2.1", "M2"],
  custom: ["MiniMax-M2.5", "any model name"],
};

interface CredentialsModalProps {
  isOpen: boolean;
  onComplete: () => void;
}

export function CredentialsModal({ isOpen, onComplete }: CredentialsModalProps) {
  const { socket, connected } = useSocket();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Form data
  const [llmProvider, setLlmProvider] = useState("minimax");
  const [llmModel, setLlmModel] = useState("M2.5");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmBaseUrl, setLlmBaseUrl] = useState("");

  if (!isOpen || success) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!socket || !connected) return;

    setError(null);
    setLoading(true);

    socket.emit("setup:complete", {
      llmProvider,
      llmModel,
      llmApiKey: llmApiKey || undefined,
      baseUrl: llmBaseUrl || undefined,
    });

    socket.once("setup:done", (data: { success: boolean; error?: string; token?: string }) => {
      setLoading(false);
      if (data.success) {
        if (data.token) {
          localStorage.setItem("gateway_token", data.token);
        }
        localStorage.setItem("credentials_configured", "true");
        setSuccess(true);
        onComplete();
      } else {
        setError(data.error || "Failed to save credentials");
      }
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      setLoading(false);
      setError("Request timed out. Please try again.");
    }, 30000);
  };

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#111] border border-white/10 rounded-2xl p-6 w-full max-w-lg">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center">
            <Key size={24} className="text-amber-400" />
          </div>
          <div>
            <h2 className="text-xl font-light text-white">Configure Your AI</h2>
            <p className="text-sm text-white/40">
              Enter your API credentials to get started
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 mb-6">
            <div>
              <label className="block text-xs text-white/40 mb-2">Provider</label>
              <select
                value={llmProvider}
                onChange={(e) => {
                  setLlmProvider(e.target.value);
                  setLlmModel(PROVIDER_MODELS[e.target.value]?.[0] || "");
                }}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-amber-500/50 appearance-none cursor-pointer"
                style={{ backgroundImage: "none" }}
              >
                <option value="anthropic" className="bg-zinc-900">Anthropic (Claude)</option>
                <option value="openai" className="bg-zinc-900">OpenAI</option>
                <option value="google" className="bg-zinc-900">Google (Gemini)</option>
                <option value="minimax" className="bg-zinc-900">MiniMax</option>
                <option value="mistral" className="bg-zinc-900">Mistral</option>
                <option value="cohere" className="bg-zinc-900">Cohere</option>
                <option value="deepseek" className="bg-zinc-900">DeepSeek</option>
                <option value="groq" className="bg-zinc-900">Groq</option>
                <option value="ollama" className="bg-zinc-900">Ollama (Local)</option>
                <option value="custom" className="bg-zinc-900">Custom (Any OpenAI-compatible)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-white/40 mb-2">Model</label>
              <input
                type="text"
                value={llmModel}
                onChange={(e) => setLlmModel(e.target.value)}
                placeholder={PROVIDER_MODELS[llmProvider]?.[0] || "Enter model name"}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-amber-500/50"
              />
            </div>

            {llmProvider !== "ollama" && (
              <div>
                <label className="block text-xs text-white/40 mb-2">API Key</label>
                <input
                  type="password"
                  value={llmApiKey}
                  onChange={(e) => setLlmApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-amber-500/50"
                  required
                />
              </div>
            )}

            {(llmProvider === "openai" || llmProvider === "ollama" || llmProvider === "custom") && (
              <div>
                <label className="block text-xs text-white/40 mb-2">
                  Base URL {llmProvider === "ollama" ? "(default: localhost:11434)" : ""}
                </label>
                <input
                  type="url"
                  value={llmBaseUrl}
                  onChange={(e) => setLlmBaseUrl(e.target.value)}
                  placeholder={
                    llmProvider === "ollama" ? "http://localhost:11434" :
                    llmProvider === "custom" ? "https://api.minimax.io/v1" :
                    "https://api.openai.com/v1"
                  }
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-amber-500/50"
                />
              </div>
            )}
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-2">
              <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || (llmProvider !== "ollama" && !llmApiKey)}
            className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:bg-white/10 disabled:text-white/40 text-black font-medium py-3 rounded-xl transition-colors"
          >
            {loading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Check size={18} />
                Save & Continue
              </>
            )}
          </button>

          <p className="text-center text-white/30 text-xs mt-4">
            You can configure more settings in the Settings page later
          </p>
        </form>
      </div>
    </div>
  );
}

/**
 * Hook to check if credentials need to be configured
 * Shows modal only once on first installation
 */
export function useCredentialsCheck() {
  const [showCredentialsModal, setShowCredentialsModal] = useState(false);
  const { socket, connected } = useSocket();

  useEffect(() => {
    if (!socket || !connected) return;

    // Check if credentials have already been configured
    const credentialsConfigured = localStorage.getItem("credentials_configured");
    if (credentialsConfigured) {
      return;
    }

    // Check with gateway if setup is needed
    socket.emit("setup:check");
    socket.on("setup:status", (data: { needsSetup: boolean; isConfigured: boolean }) => {
      // Show modal if not configured (first-time setup)
      if (data.needsSetup || !data.isConfigured) {
        setShowCredentialsModal(true);
      }
    });

    return () => {
      socket.off("setup:status");
    };
  }, [socket, connected]);

  const completeCredentials = () => {
    setShowCredentialsModal(false);
  };

  return { showCredentialsModal, completeCredentials };
}
