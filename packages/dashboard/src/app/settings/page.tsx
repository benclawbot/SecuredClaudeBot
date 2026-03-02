"use client";

import { useState, type FormEvent } from "react";
import { useSocket } from "@/lib/socket";

type LlmProvider = "anthropic" | "openai" | "google" | "ollama";

interface LlmSettings {
  provider: LlmProvider;
  model: string;
  apiKey: string;
  baseUrl: string;
}

const DEFAULT_MODELS: Record<LlmProvider, string[]> = {
  anthropic: ["claude-sonnet-4-20250514", "claude-3-5-haiku-20241022"],
  openai: ["gpt-4o", "gpt-4o-mini"],
  google: ["gemini-2.0-flash"],
  ollama: ["llama3.2", "mistral", "codellama"],
};

export default function SettingsPage() {
  const { socket, connected } = useSocket();

  // LLM Settings
  const [llm, setLlm] = useState<LlmSettings>({
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    apiKey: "",
    baseUrl: "",
  });

  // Telegram
  const [telegramToken, setTelegramToken] = useState("");
  const [approvedUsers, setApprovedUsers] = useState("");

  // Security
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  // Feedback
  const [savedSection, setSavedSection] = useState<string | null>(null);

  const showSaved = (section: string) => {
    setSavedSection(section);
    setTimeout(() => setSavedSection(null), 2000);
  };

  const handleSaveLlm = (e: FormEvent) => {
    e.preventDefault();
    if (!socket || !connected) return;
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
    showSaved("llm");
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
    <div className="p-6">
      <div className="max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold mb-6">Settings</h2>

        {/* LLM Configuration */}
        <section className="bg-zinc-900 rounded-lg border border-zinc-800 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">LLM Provider</h3>
            {savedSection === "llm" && (
              <span className="text-xs text-emerald-400">Saved!</span>
            )}
          </div>
          <form onSubmit={handleSaveLlm} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">
                  Provider
                </label>
                <select
                  value={llm.provider}
                  onChange={(e) => {
                    const p = e.target.value as LlmProvider;
                    setLlm({
                      ...llm,
                      provider: p,
                      model: DEFAULT_MODELS[p][0] ?? "",
                    });
                  }}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500/50"
                >
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="openai">OpenAI</option>
                  <option value="google">Google (Gemini)</option>
                  <option value="ollama">Ollama (Local)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">
                  Model
                </label>
                <select
                  value={llm.model}
                  onChange={(e) => setLlm({ ...llm, model: e.target.value })}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500/50"
                >
                  {DEFAULT_MODELS[llm.provider].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {llm.provider !== "ollama" && (
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">
                  API Key
                </label>
                <input
                  type="password"
                  value={llm.apiKey}
                  onChange={(e) => setLlm({ ...llm, apiKey: e.target.value })}
                  placeholder="sk-..."
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50"
                />
                <p className="text-[10px] text-zinc-600 mt-1">
                  Stored encrypted with AES-256-GCM. Never logged or exposed.
                </p>
              </div>
            )}

            {(llm.provider === "openai" || llm.provider === "ollama") && (
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">
                  Base URL{" "}
                  {llm.provider === "ollama" && "(default: localhost:11434)"}
                </label>
                <input
                  type="url"
                  value={llm.baseUrl}
                  onChange={(e) => setLlm({ ...llm, baseUrl: e.target.value })}
                  placeholder={
                    llm.provider === "ollama"
                      ? "http://localhost:11434/api"
                      : "https://api.openai.com/v1"
                  }
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={!connected}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm rounded-md transition-colors font-medium"
            >
              Save LLM Settings
            </button>
          </form>
        </section>

        {/* Telegram Configuration */}
        <section className="bg-zinc-900 rounded-lg border border-zinc-800 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Telegram Bot</h3>
            {savedSection === "telegram" && (
              <span className="text-xs text-emerald-400">Saved!</span>
            )}
          </div>
          <form onSubmit={handleSaveTelegram} className="space-y-4">
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">
                Bot Token
              </label>
              <input
                type="password"
                value={telegramToken}
                onChange={(e) => setTelegramToken(e.target.value)}
                placeholder="123456:ABC-DEF..."
                className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">
                Pre-approved User IDs (comma-separated)
              </label>
              <input
                type="text"
                value={approvedUsers}
                onChange={(e) => setApprovedUsers(e.target.value)}
                placeholder="123456789, 987654321"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <button
              type="submit"
              disabled={!connected}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm rounded-md transition-colors font-medium"
            >
              Save Telegram Settings
            </button>
          </form>
        </section>

        {/* PIN Change */}
        <section className="bg-zinc-900 rounded-lg border border-zinc-800 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Encryption PIN</h3>
            {savedSection === "pin" && (
              <span className="text-xs text-emerald-400">PIN changed!</span>
            )}
          </div>
          <p className="text-xs text-zinc-500 mb-4">
            The PIN is used to derive the encryption key (PBKDF2 + AES-256-GCM)
            for all stored secrets.
          </p>
          <form onSubmit={handleChangePin} className="space-y-4">
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">
                Current PIN
              </label>
              <input
                type="password"
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">
                  New PIN
                </label>
                <input
                  type="password"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value)}
                  minLength={4}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500/50"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">
                  Confirm New PIN
                </label>
                <input
                  type="password"
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value)}
                  minLength={4}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500/50"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={!connected || !currentPin || !newPin || !confirmPin}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm rounded-md transition-colors font-medium"
            >
              Change PIN
            </button>
          </form>
        </section>

        {/* Danger Zone */}
        <section className="bg-zinc-900 rounded-lg border border-red-500/20 p-6">
          <h3 className="text-lg font-semibold text-red-400 mb-4">
            Danger Zone
          </h3>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-300">Clear all sessions</p>
              <p className="text-xs text-zinc-500">
                Disconnect all active sessions and clear conversation history
              </p>
            </div>
            <button
              onClick={() => {
                if (
                  confirm("Are you sure? This will clear all active sessions.")
                ) {
                  socket?.emit("sessions:clear-all");
                }
              }}
              disabled={!connected}
              className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-500/20 text-red-400 text-sm rounded-md transition-colors font-medium disabled:opacity-50"
            >
              Clear Sessions
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
