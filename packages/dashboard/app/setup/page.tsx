"use client";

import { useState, useEffect } from "react";
import { useSocket } from "@/lib/socket";
import { useRouter } from "next/navigation";
import { Shield, Bot, Key, Check, AlertCircle, ArrowRight, RefreshCw } from "lucide-react";

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

type Step = "welcome" | "pin" | "telegram" | "llm" | "verify" | "complete";

export default function SetupPage() {
  const { socket, connected } = useSocket();
  const router = useRouter();
  const [step, setStep] = useState<Step>("welcome");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form data
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  // JWT secret is auto-generated on server
  const [telegramToken, setTelegramToken] = useState("");
  const [llmProvider, setLlmProvider] = useState("anthropic");
  const [llmModel, setLlmModel] = useState("");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmBaseUrl, setLlmBaseUrl] = useState("");

  useEffect(() => {
    // Check if already configured
    if (socket && connected) {
      socket.emit("setup:check");
      socket.on("setup:status", (data: { needsSetup: boolean; isConfigured: boolean }) => {
        if (!data.needsSetup && data.isConfigured) {
          router.push("/chat");
        }
      });
      return () => {
        socket.off("setup:status");
      };
    }
  }, [socket, connected, router]);

  const handleNext = () => {
    setError(null);

    switch (step) {
      case "welcome":
        setStep("pin");
        break;
      case "pin":
        if (pin.length < 4) {
          setError("PIN must be at least 4 characters");
          return;
        }
        if (pin !== confirmPin) {
          setError("PINs do not match");
          return;
        }
        // JWT secret is auto-generated on server, skip that step
        setStep("telegram");
        break;
      case "telegram":
        setStep("llm");
        break;
      case "llm":
        if (!llmModel) {
          setError("Please select a model");
          return;
        }
        if (llmProvider !== "ollama" && llmProvider !== "custom" && !llmApiKey) {
          setError("API key is required for this provider");
          return;
        }
        setStep("verify");
        break;
      case "verify":
        completeSetup();
        break;
    }
  };

  const completeSetup = async () => {
    if (!socket || !connected) return;

    setLoading(true);
    setError(null);

    socket.emit("setup:complete", {
      pin,
      telegramToken: telegramToken || undefined,
      llmProvider,
      llmModel,
      llmApiKey: llmApiKey || undefined,
      baseUrl: llmBaseUrl || undefined,
    });

    socket.on("setup:done", (data: { success: boolean; error?: string }) => {
      setLoading(false);
      if (data.success) {
        // Mark setup as completed in localStorage
        localStorage.setItem("setup_completed", "true");
        setStep("complete");
      } else {
        setError(data.error || "Setup failed");
      }
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      setLoading(false);
      setError("Setup timed out. Please try again.");
    }, 30000);
  };

  const steps: { id: Step; label: string; icon: typeof Shield }[] = [
    { id: "welcome", label: "Welcome", icon: Shield },
    { id: "pin", label: "Security PIN", icon: Key },
    { id: "telegram", label: "Telegram", icon: Bot },
    { id: "llm", label: "LLM Provider", icon: Key },
    { id: "verify", label: "Verify", icon: Check },
  ];

  const currentStepIndex = steps.findIndex((s) => s.id === step);

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-500/20">
            <span className="text-black text-2xl font-bold">FB</span>
          </div>
          <h1 className="text-2xl font-light text-white">FastBot Setup</h1>
          <p className="text-sm text-white/40 mt-1">Configure your secure AI gateway</p>
        </div>

        {/* Progress Steps */}
        {step !== "complete" && (
          <div className="flex items-center justify-center gap-2 mb-8">
            {steps.map((s, i) => {
              const Icon = s.icon;
              const isActive = s.id === step;
              const isCompleted = i < currentStepIndex;

              return (
                <div key={s.id} className="flex items-center">
                  <div
                    className={`flex items-center justify-center w-8 h-8 rounded-full transition-colors ${
                      isCompleted
                        ? "bg-emerald-500 text-black"
                        : isActive
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/50"
                        : "bg-white/5 text-white/30"
                    }`}
                  >
                    {isCompleted ? <Check size={14} /> : <Icon size={14} />}
                  </div>
                  {i < steps.length - 1 && (
                    <div
                      className={`w-8 h-0.5 mx-1 ${
                        isCompleted ? "bg-emerald-500" : "bg-white/10"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
            <AlertCircle size={18} className="text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {/* Step Content */}
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6">
          {/* Welcome Step */}
          {step === "welcome" && (
            <div className="text-center">
              <h2 className="text-xl font-light text-white mb-4">Welcome to FastBot</h2>
              <p className="text-sm text-white/50 mb-6">
                Let's set up your secure AI gateway in just a few steps.
                You'll configure your encryption PIN, connect Telegram, and set up your LLM provider.
              </p>
              <div className="space-y-3 text-left bg-white/5 rounded-xl p-4 mb-6">
                <div className="flex items-center gap-3 text-sm text-white/70">
                  <Shield size={16} className="text-emerald-400" />
                  <span>AES-256-GCM encrypted secrets</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-white/70">
                  <Bot size={16} className="text-emerald-400" />
                  <span>Telegram bot integration</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-white/70">
                  <Key size={16} className="text-emerald-400" />
                  <span>Multiple LLM provider support</span>
                </div>
              </div>
            </div>
          )}

          {/* PIN Step */}
          {step === "pin" && (
            <div>
              <h2 className="text-lg font-light text-white mb-2">Create Encryption PIN</h2>
              <p className="text-xs text-white/40 mb-6">
                This PIN encrypts all your API keys and secrets using AES-256-GCM.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-white/40 mb-2">Enter PIN</label>
                  <input
                    type="password"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    placeholder="Min 4 characters"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/40 mb-2">Confirm PIN</label>
                  <input
                    type="password"
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value)}
                    placeholder="Confirm your PIN"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Telegram Step */}
          {step === "telegram" && (
            <div>
              <h2 className="text-lg font-light text-white mb-2">Telegram Bot (Optional)</h2>
              <p className="text-xs text-white/40 mb-6">
                Connect your Telegram bot to chat with the AI from your phone.
              </p>

              <div>
                <label className="block text-xs text-white/40 mb-2">Bot Token</label>
                <input
                  type="password"
                  value={telegramToken}
                  onChange={(e) => setTelegramToken(e.target.value)}
                  placeholder="123456:ABC-DEF... (leave empty to skip)"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50"
                  autoFocus
                />
                <p className="text-[10px] text-white/30 mt-2">
                  Get your token from @BotFather on Telegram
                </p>
              </div>
            </div>
          )}

          {/* LLM Step */}
          {step === "llm" && (
            <div>
              <h2 className="text-lg font-light text-white mb-2">LLM Provider</h2>
              <p className="text-xs text-white/40 mb-6">
                Configure your AI model provider.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-white/40 mb-2">Provider</label>
                  <select
                    value={llmProvider}
                    onChange={(e) => {
                      setLlmProvider(e.target.value);
                      setLlmModel(PROVIDER_MODELS[e.target.value]?.[0] || "");
                      setLlmApiKey("");
                    }}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500/50 appearance-none cursor-pointer"
                    style={{ backgroundImage: "none" }}
                  >
                    <option value="anthropic" className="bg-zinc-900">Anthropic (Claude)</option>
                    <option value="openai" className="bg-zinc-900">OpenAI</option>
                    <option value="google" className="bg-zinc-900">Google (Gemini)</option>
                    <option value="mistral" className="bg-zinc-900">Mistral</option>
                    <option value="cohere" className="bg-zinc-900">Cohere</option>
                    <option value="deepseek" className="bg-zinc-900">DeepSeek</option>
                    <option value="groq" className="bg-zinc-900">Groq</option>
                    <option value="ollama" className="bg-zinc-900">Ollama (Local)</option>
                    <option value="minimax" className="bg-zinc-900">MiniMax</option>
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
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50"
                    list={`${llmProvider}-models`}
                  />
                  {PROVIDER_MODELS[llmProvider] && (
                    <datalist id={`${llmProvider}-models`}>
                      {PROVIDER_MODELS[llmProvider].map((m) => (
                        <option key={m} value={m} className="bg-zinc-900" />
                      ))}
                    </datalist>
                  )}
                </div>

                {llmProvider !== "ollama" && llmProvider !== "" && (
                  <div>
                    <label className="block text-xs text-white/40 mb-2">API Key</label>
                    <input
                      type="password"
                      value={llmApiKey}
                      onChange={(e) => setLlmApiKey(e.target.value)}
                      placeholder="sk-..."
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                )}

                {(llmProvider === "openai" || llmProvider === "ollama" || llmProvider === "custom") && (
                  <div>
                    <label className="block text-xs text-white/40 mb-2">
                      Base URL {llmProvider === "ollama" ? "(default: localhost:11434)" : "(optional)"}
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
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Verify Step */}
          {step === "verify" && (
            <div>
              <h2 className="text-lg font-light text-white mb-4">Review Configuration</h2>

              <div className="bg-white/5 rounded-xl p-4 space-y-3 mb-6">
                <div className="flex justify-between">
                  <span className="text-xs text-white/40">Security PIN</span>
                  <span className="text-xs text-white">{"*".repeat(pin.length)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-white/40">Telegram</span>
                  <span className="text-xs text-white">{telegramToken ? "Configured" : "Skipped"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-white/40">LLM Provider</span>
                  <span className="text-xs text-white capitalize">{llmProvider}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-white/40">Model</span>
                  <span className="text-xs text-white">{llmModel}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-white/40">API Key</span>
                  <span className="text-xs text-white">{llmApiKey ? "Configured" : "Not set"}</span>
                </div>
              </div>

              <p className="text-xs text-white/40">
                Click "Complete Setup" to save your configuration and start using FastBot.
              </p>
            </div>
          )}

          {/* Complete Step */}
          {step === "complete" && (
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                <Check size={32} className="text-emerald-400" />
              </div>
              <h2 className="text-xl font-light text-white mb-2">Setup Complete!</h2>
              <p className="text-sm text-white/50 mb-6">
                Your FastBot is now configured and ready to use.
              </p>
              <button
                onClick={() => router.push("/chat")}
                className="flex items-center justify-center gap-2 w-full px-5 py-3 bg-emerald-500 hover:bg-emerald-400 text-black text-sm font-medium rounded-xl transition-colors"
              >
                Go to Chat
                <ArrowRight size={16} />
              </button>
            </div>
          )}

          {/* Navigation Buttons */}
          {step !== "complete" && (
            <div className="flex gap-3 mt-8">
              {step !== "welcome" && (
                <button
                  onClick={() => {
                    setError(null);
                    if (step === "telegram") setStep("pin");
                    else if (step === "llm") setStep("telegram");
                    else if (step === "verify") setStep("llm");
                    else setStep("welcome");
                  }}
                  className="flex-1 px-5 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-medium rounded-xl transition-colors"
                >
                  Back
                </button>
              )}
              <button
                onClick={handleNext}
                disabled={loading || !connected}
                className="flex-1 flex items-center justify-center gap-2 px-5 py-3 bg-emerald-500 hover:bg-emerald-400 disabled:bg-white/10 disabled:text-white/30 text-black text-sm font-medium rounded-xl transition-colors"
              >
                {loading ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    Setting up...
                  </>
                ) : step === "verify" ? (
                  "Complete Setup"
                ) : step === "llm" ? (
                  "Continue"
                ) : (
                  <>
                    Continue
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </div>
          )}

          {!connected && step !== "complete" && (
            <p className="text-xs text-amber-400 text-center mt-4">
              Waiting for gateway connection...
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
