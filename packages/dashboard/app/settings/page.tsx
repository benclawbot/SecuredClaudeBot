"use client";

import { useState, useEffect, type FormEvent } from "react";
import { useSocket } from "@/lib/socket";
import { Bot, Lock, Shield, Trash2, Check, AlertCircle, Link2, Github, Unlink, Zap, Globe } from "lucide-react";

interface LlmSettings {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
}

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

export default function SettingsPage() {
  const { socket, connected } = useSocket();

  // LLM Settings
  const [llm, setLlm] = useState<LlmSettings>({
    provider: "anthropic",
    model: "",
    apiKey: "",
    baseUrl: "",
  });

  // Telegram
  const [telegramToken, setTelegramToken] = useState("");
  const [approvedUsers, setApprovedUsers] = useState("");

  // OAuth Connections
  const [googleConnected, setGoogleConnected] = useState(false);
  const [microsoftConnected, setMicrosoftConnected] = useState(false);
  const [githubConnected, setGithubConnected] = useState(false);

  // Subsystems
  const [playwrightEnabled, setPlaywrightEnabled] = useState(false);
  const [tailscaleConnected, setTailscaleConnected] = useState(false);
  const [tailscaleIp, setTailscaleIp] = useState<string | null>(null);

  // Security
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  // Feedback
  const [savedSection, setSavedSection] = useState<string | null>(null);
  const [error, setError] = useState<{ error: string; hint: string } | null>(null);

  const showSaved = (section: string) => {
    setSavedSection(section);
    setTimeout(() => setSavedSection(null), 2000);
  };

  useEffect(() => {
    if (!socket) return;

    socket.on("settings:saved", (data: { section: string; success: boolean; error?: string; hint?: string }) => {
      if (data.section === "llm") {
        if (data.success) {
          setSavedSection("llm");
          setError(null);
          setTimeout(() => setSavedSection(null), 2000);
        } else {
          setError({ error: data.error || "Unknown error", hint: data.hint || "" });
        }
      }
    });

    // Tailscale status
    socket.on("tailscale:status", (data: { enabled: boolean; connected: boolean; ip?: string }) => {
      setTailscaleConnected(data.connected);
      setTailscaleIp(data.ip || null);
    });

    socket.on("tailscale:connected", () => {
      setTailscaleConnected(true);
      socket?.emit("tailscale:status");
    });

    socket.on("tailscale:disconnected", () => {
      setTailscaleConnected(false);
      setTailscaleIp(null);
    });

    // Request initial tailscale status
    socket.emit("tailscale:status");

    return () => {
      socket.off("settings:saved");
      socket.off("tailscale:status");
      socket.off("tailscale:connected");
      socket.off("tailscale:disconnected");
    };
  }, [socket]);

  const handleSaveLlm = (e: FormEvent) => {
    e.preventDefault();
    if (!socket || !connected) return;
    setError(null);
    socket.emit("settings:update", {
      section: "llm",
      data: {
        primary: {
          provider: llm.provider,
          model: llm.model,
          apiKey: llm.apiKey || undefined,
          baseUrl: llm.baseUrl || undefined,
        },
      },
    });
  };

  const handleSaveTelegram = (e: FormEvent) => {
    e.preventDefault();
    if (!socket || !connected) return;
    socket.emit("settings:update", {
      section: "telegram",
      data: {
        botToken: telegramToken,
        approvedUsers: approvedUsers
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n)),
      },
    });
    showSaved("telegram");
  };

  const handleChangePin = (e: FormEvent) => {
    e.preventDefault();
    if (newPin !== confirmPin) {
      alert("PINs do not match");
      return;
    }
    if (newPin.length < 4) {
      alert("PIN must be at least 4 characters");
      return;
    }
    if (!socket || !connected) return;
    socket.emit("settings:change-pin", {
      currentPin,
      newPin,
    });
    setCurrentPin("");
    setNewPin("");
    setConfirmPin("");
    showSaved("pin");
  };

  return (
    <div className="p-8 lg:p-12 max-w-3xl mx-auto">
      <header className="mb-12">
        <h1 className="text-3xl font-light tracking-tight mb-2">Settings</h1>
        <p className="text-white/40">Configure your SecureClaudebot</p>
      </header>

      <div className="space-y-6">
        {/* LLM Configuration */}
        <section className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6">
          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
              <div className="flex items-start gap-3">
                <AlertCircle size={18} className="text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-red-300 font-medium">{error.error}</p>
                  {error.hint && <p className="text-xs text-red-400/70 mt-1">{error.hint}</p>}
                </div>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <Bot size={20} className="text-emerald-400" />
              </div>
              <div>
                <h3 className="text-lg font-light">LLM Provider</h3>
                <p className="text-xs text-white/40">Configure AI model settings</p>
              </div>
            </div>
            {savedSection === "llm" && (
              <span className="flex items-center gap-1 text-xs text-emerald-400">
                <Check size={14} /> Saved
              </span>
            )}
          </div>
          <form onSubmit={handleSaveLlm} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-white/40 mb-2">Provider</label>
                <select
                  value={llm.provider}
                  onChange={(e) => setLlm({ ...llm, provider: e.target.value, model: "" })}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-colors appearance-none cursor-pointer"
                  style={{ backgroundImage: "none" }}
                >
                  <option value="" className="bg-zinc-900">Select a provider...</option>
                  <option value="anthropic" className="bg-zinc-900">Anthropic (Claude)</option>
                  <option value="openai" className="bg-zinc-900">OpenAI</option>
                  <option value="google" className="bg-zinc-900">Google (Gemini)</option>
                  <option value="mistral" className="bg-zinc-900">Mistral</option>
                  <option value="cohere" className="bg-zinc-900">Cohere</option>
                  <option value="deepseek" className="bg-zinc-900">DeepSeek</option>
                  <option value="groq" className="bg-zinc-900">Groq</option>
                  <option value="ollama" className="bg-zinc-900">Ollama (Local)</option>
                  <option value="minimax" className="bg-zinc-900">MiniMax</option>
                  <option value="custom" className="bg-zinc-900">Custom (Any OpenAI-compatible API)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-2">Model</label>
                <input
                  type="text"
                  value={llm.model}
                  onChange={(e) => setLlm({ ...llm, model: e.target.value })}
                  placeholder={PROVIDER_MODELS[llm.provider]?.[0] || "Enter model name"}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50 transition-colors"
                  list={`${llm.provider}-models`}
                />
                {PROVIDER_MODELS[llm.provider] && (
                  <datalist id={`${llm.provider}-models`}>
                    {PROVIDER_MODELS[llm.provider].map((m) => (
                      <option key={m} value={m} className="bg-zinc-900" />
                    ))}
                  </datalist>
                )}
              </div>
            </div>

            {llm.provider !== "ollama" && llm.provider !== "" && (
              <div>
                <label className="block text-xs text-white/40 mb-2">API Key</label>
                <input
                  type="password"
                  value={llm.apiKey}
                  onChange={(e) => setLlm({ ...llm, apiKey: e.target.value })}
                  placeholder="sk-..."
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50 transition-colors"
                />
                <p className="text-[10px] text-white/30 mt-2">Stored encrypted with AES-256-GCM</p>
              </div>
            )}

            {(llm.provider === "openai" || llm.provider === "ollama" || llm.provider === "custom" || llm.baseUrl) && (
              <div>
                <label className="block text-xs text-white/40 mb-2">
                  Base URL {llm.provider === "ollama" ? "(default: localhost:11434)" : "(optional)"}
                </label>
                <input
                  type="url"
                  value={llm.baseUrl}
                  onChange={(e) => setLlm({ ...llm, baseUrl: e.target.value })}
                  placeholder={
                    llm.provider === "ollama" ? "http://localhost:11434/api" :
                    llm.provider === "custom" ? "https://api.minimax.io/anthropic" :
                    llm.provider === "openai" ? "https://api.openai.com/v1" :
                    "https://api.provider.com/v1"
                  }
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50 transition-colors"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={!connected}
              className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 disabled:bg-white/10 disabled:text-white/30 text-black text-sm font-medium rounded-xl transition-colors"
            >
              Save LLM Settings
            </button>
          </form>
        </section>

        {/* Telegram Configuration */}
        <section className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <Shield size={20} className="text-blue-400" />
              </div>
              <div>
                <h3 className="text-lg font-light">Telegram Bot</h3>
                <p className="text-xs text-white/40">Bot configuration and access control</p>
              </div>
            </div>
            {savedSection === "telegram" && (
              <span className="flex items-center gap-1 text-xs text-emerald-400">
                <Check size={14} /> Saved
              </span>
            )}
          </div>
          <form onSubmit={handleSaveTelegram} className="space-y-4">
            <div>
              <label className="block text-xs text-white/40 mb-2">Bot Token</label>
              <input
                type="password"
                value={telegramToken}
                onChange={(e) => setTelegramToken(e.target.value)}
                placeholder="123456:ABC-DEF..."
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-500/50 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs text-white/40 mb-2">Pre-approved User IDs</label>
              <input
                type="text"
                value={approvedUsers}
                onChange={(e) => setApprovedUsers(e.target.value)}
                placeholder="123456789, 987654321"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-500/50 transition-colors"
              />
            </div>
            <button
              type="submit"
              disabled={!connected}
              className="px-5 py-2.5 bg-blue-500 hover:bg-blue-400 disabled:bg-white/10 disabled:text-white/30 text-black text-sm font-medium rounded-xl transition-colors"
            >
              Save Telegram Settings
            </button>
          </form>
        </section>

        {/* OAuth Integrations */}
        <section className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
                <Link2 size={20} className="text-violet-400" />
              </div>
              <div>
                <h3 className="text-lg font-light">OAuth Integrations</h3>
                <p className="text-xs text-white/40">Connect third-party services</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Google OAuth */}
            <div className="bg-white/5 rounded-xl p-4 flex flex-col items-center gap-3">
              <svg viewBox="0 0 24 24" className="w-10 h-10" fill="none">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              <span className="text-sm text-white/70">Google</span>
              <span className="text-xs text-white/40 text-center">Gmail, Calendar, Drive, Photos, YouTube</span>
              {googleConnected ? (
                <button
                  onClick={() => setGoogleConnected(false)}
                  className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-medium rounded-lg transition-colors flex items-center gap-2"
                >
                  <Unlink size={14} /> Disconnect
                </button>
              ) : (
                <button
                  onClick={() => {
                    // TODO: Implement Google OAuth flow
                    setGoogleConnected(true);
                  }}
                  disabled={!connected}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-400 disabled:bg-white/10 disabled:text-white/30 text-black text-xs font-medium rounded-lg transition-colors"
                >
                  Connect
                </button>
              )}
            </div>

            {/* Microsoft OAuth */}
            <div className="bg-white/5 rounded-xl p-4 flex flex-col items-center gap-3">
              <svg viewBox="0 0 24 24" className="w-10 h-10">
                <path fill="#F25022" d="M1 1h10v10H1z"/>
                <path fill="#00A4EF" d="M1 13h10v10H1z"/>
                <path fill="#7FBA00" d="M13 1h10v10H13z"/>
                <path fill="#FFB900" d="M13 13h10v10H13z"/>
              </svg>
              <span className="text-sm text-white/70">Microsoft</span>
              <span className="text-xs text-white/40 text-center">Outlook, OneDrive, Teams, Azure</span>
              {microsoftConnected ? (
                <button
                  onClick={() => setMicrosoftConnected(false)}
                  className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-medium rounded-lg transition-colors flex items-center gap-2"
                >
                  <Unlink size={14} /> Disconnect
                </button>
              ) : (
                <button
                  onClick={() => {
                    // TODO: Implement Microsoft OAuth flow
                    setMicrosoftConnected(true);
                  }}
                  disabled={!connected}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-400 disabled:bg-white/10 disabled:text-white/30 text-black text-xs font-medium rounded-lg transition-colors"
                >
                  Connect
                </button>
              )}
            </div>

            {/* GitHub OAuth */}
            <div className="bg-white/5 rounded-xl p-4 flex flex-col items-center gap-3">
              <Github size={40} className="text-white" />
              <span className="text-sm text-white/70">GitHub</span>
              <span className="text-xs text-white/40 text-center">Repositories, Actions, Gists</span>
              {githubConnected ? (
                <button
                  onClick={() => setGithubConnected(false)}
                  className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-medium rounded-lg transition-colors flex items-center gap-2"
                >
                  <Unlink size={14} /> Disconnect
                </button>
              ) : (
                <button
                  onClick={() => {
                    // Use existing GitHub config from settings
                    if (connected) {
                      socket?.emit("settings:request", { section: "github" });
                    }
                    setGithubConnected(true);
                  }}
                  disabled={!connected}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-400 disabled:bg-white/10 disabled:text-white/30 text-black text-xs font-medium rounded-lg transition-colors"
                >
                  Connect
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Playwright */}
        <section className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center">
                <Zap size={20} className="text-cyan-400" />
              </div>
              <div>
                <h3 className="text-lg font-light">Playwright</h3>
                <p className="text-xs text-white/40">Web automation and scraping</p>
              </div>
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full ${playwrightEnabled ? "bg-emerald-500/10 text-emerald-400" : "bg-white/5 text-white/40"}`}>
              {playwrightEnabled ? "Active" : "Inactive"}
            </span>
          </div>
          <p className="text-xs text-white/30 mb-4">
            Enable web automation for scraping, screenshots, and browser automation tasks.
          </p>
          <button
            onClick={() => {
              if (!connected) return;
              const newValue = !playwrightEnabled;
              setPlaywrightEnabled(newValue);
              socket?.emit("settings:update", {
                section: "playwright",
                data: { enabled: newValue },
              });
              showSaved("playwright");
            }}
            disabled={!connected}
            className={`px-5 py-2.5 text-sm font-medium rounded-xl transition-colors ${
              playwrightEnabled
                ? "bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400"
                : "bg-cyan-500 hover:bg-cyan-400 text-black"
            } disabled:bg-white/10 disabled:text-white/30`}
          >
            {playwrightEnabled ? "Disable" : "Enable"}
          </button>
        </section>

        {/* Tailscale */}
        <section className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <Globe size={20} className="text-blue-400" />
              </div>
              <div>
                <h3 className="text-lg font-light">Tailscale</h3>
                <p className="text-xs text-white/40">Secure remote access</p>
              </div>
            </div>
            <span className={`px-3 py-1.5 text-xs font-medium rounded-lg ${
              tailscaleConnected
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-white/5 text-white/40"
            }`}>
              {tailscaleConnected ? "Active" : "Inactive"}
            </span>
          </div>
          <p className="text-xs text-white/30 mb-4">
            Tailscale provides secure remote access to your gateway from anywhere.
          </p>
          {tailscaleIp && (
            <div className="bg-white/5 rounded-lg p-3 flex items-center justify-between">
              <span className="text-xs text-white/50">Tailscale IP:</span>
              <span className="text-sm font-mono text-emerald-400">{tailscaleIp}</span>
            </div>
          )}
        </section>

        {/* PIN Change */}
        <section className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                <Lock size={20} className="text-amber-400" />
              </div>
              <div>
                <h3 className="text-lg font-light">Encryption PIN</h3>
                <p className="text-xs text-white/40">Secure your stored secrets</p>
              </div>
            </div>
            {savedSection === "pin" && (
              <span className="flex items-center gap-1 text-xs text-emerald-400">
                <Check size={14} /> PIN changed
              </span>
            )}
          </div>
          <p className="text-xs text-white/30 mb-6">
            The PIN is used to derive the encryption key (PBKDF2 + AES-256-GCM) for all stored secrets.
          </p>
          <form onSubmit={handleChangePin} className="space-y-4">
            <div>
              <label className="block text-xs text-white/40 mb-2">Current PIN</label>
              <input
                type="password"
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-amber-500/50 transition-colors"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-white/40 mb-2">New PIN</label>
                <input
                  type="password"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value)}
                  minLength={4}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-amber-500/50 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs text-white/40 mb-2">Confirm PIN</label>
                <input
                  type="password"
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value)}
                  minLength={4}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-amber-500/50 transition-colors"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={!connected || !currentPin || !newPin || !confirmPin}
              className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-white/10 disabled:text-white/30 text-black text-sm font-medium rounded-xl transition-colors"
            >
              Change PIN
            </button>
          </form>
        </section>

        {/* Danger Zone */}
        <section className="bg-white/[0.02] border border-red-500/10 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
              <Trash2 size={20} className="text-red-400" />
            </div>
            <div>
              <h3 className="text-lg font-light">Danger Zone</h3>
              <p className="text-xs text-white/40">Irreversible actions</p>
            </div>
          </div>

          <div className="flex items-center justify-between mb-6 pb-6 border-b border-white/5">
            <div>
              <p className="text-sm text-white/60">Gateway Control</p>
              <p className="text-xs text-white/30">Restart to apply Telegram settings</p>
            </div>
            {connected ? (
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    if (confirm("Restart the gateway? It will automatically restart via PM2.")) {
                      socket?.emit("gateway:restart");
                    }
                  }}
                  disabled={!connected}
                  className="px-5 py-2.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-400 text-sm font-medium rounded-xl transition-colors"
                >
                  Restart Gateway
                </button>
                <button
                  onClick={() => {
                    if (confirm("Stop the gateway? PM2 will NOT restart it automatically.")) {
                      socket?.emit("gateway:stop");
                    }
                  }}
                  disabled={!connected}
                  className="px-5 py-2.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-sm font-medium rounded-xl transition-colors"
                >
                  Stop Gateway
                </button>
              </div>
            ) : (
              <span className="text-xs text-amber-400">Gateway stopped - run "pnpm dev" to restart</span>
            )}
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white/60">Clear all sessions</p>
              <p className="text-xs text-white/30">Disconnect all active sessions and clear conversation history</p>
            </div>
            <button
              onClick={() => {
                if (confirm("Are you sure? This will clear all active sessions.")) {
                  socket?.emit("sessions:clear-all");
                }
              }}
              disabled={!connected}
              className="px-5 py-2.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-sm font-medium rounded-xl transition-colors"
            >
              Clear Sessions
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
