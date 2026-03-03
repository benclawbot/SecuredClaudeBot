"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";
import { useChat } from "@/lib/hooks";

export default function ChatPage() {
  const { messages, sessionId, streaming, connected, sendMessage } = useChat();
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || streaming) return;
    sendMessage(input);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0a]">
      {/* Header */}
      <div className="border-b border-white/5 px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-light">Chat</h2>
          {sessionId && (
            <span className="text-xs text-white/30 font-mono">
              {sessionId.slice(0, 8)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              connected ? "bg-emerald-400 shadow-lg shadow-emerald-400/50" : "bg-red-500"
            }`}
          />
          <span className="text-xs text-white/40">
            {connected ? "Connected" : "Reconnecting..."}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto space-y-5">
          {messages.length === 0 && (
            <div className="text-center py-20">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center mx-auto mb-5 shadow-lg shadow-emerald-500/20">
                <span className="text-black text-2xl font-bold">SC</span>
              </div>
              <h3 className="text-xl font-light text-white/80 mb-3">
                SecureClaudebot
              </h3>
              <p className="text-sm text-white/40 max-w-md mx-auto leading-relaxed">
                Your ultra-secure AI assistant. Configure your LLM provider in Settings to get started.
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <MessageBubble
              key={`${msg.ts}-${i}`}
              role={msg.role}
              content={msg.content}
              ts={msg.ts}
            />
          ))}

          {streaming && (
            <div className="flex items-center gap-3 text-white/40 text-sm py-3">
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" style={{ animationDelay: "200ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" style={{ animationDelay: "400ms" }} />
              </div>
              <span className="text-xs">Thinking...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-white/5 px-6 py-4 shrink-0 bg-[#0a0a0a]">
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto">
          <div className="relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                connected
                  ? "Type a message... (Enter to send, Shift+Enter for newline)"
                  : "Connecting to gateway..."
              }
              disabled={!connected}
              rows={1}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 pr-24 text-sm text-white placeholder-white/30 resize-none focus:outline-none focus:border-emerald-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ minHeight: "52px", maxHeight: "200px" }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = "auto";
                target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
              }}
            />
            <button
              type="submit"
              disabled={!connected || !input.trim() || streaming}
              className="absolute right-2 bottom-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-white/10 disabled:text-white/30 text-black text-sm font-medium rounded-lg transition-colors"
            >
              Send
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MessageBubble({
  role,
  content,
  ts,
}: {
  role: "user" | "assistant";
  content: string;
  ts: number;
}) {
  const time = new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      className={`flex gap-3 ${role === "user" ? "justify-end" : "justify-start"}`}
    >
      {role === "assistant" && (
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shrink-0 mt-1 shadow-lg shadow-emerald-500/20">
          <span className="text-black text-xs font-bold">SC</span>
        </div>
      )}

      <div
        className={`max-w-[75%] rounded-2xl px-5 py-4 ${
          role === "user"
            ? "bg-white/10 border border-white/10 text-white"
            : "bg-white/[0.03] border border-white/[0.06] text-white/90"
        }`}
      >
        <div className="text-sm whitespace-pre-wrap break-words leading-relaxed">
          {content}
        </div>
        <div
          className={`text-[10px] mt-2 ${
            role === "user" ? "text-white/40" : "text-white/30"
          }`}
        >
          {time}
        </div>
      </div>

      {role === "user" && (
        <div className="w-7 h-7 rounded-lg bg-blue-500/20 flex items-center justify-center shrink-0 mt-1">
          <span className="text-blue-400 text-xs font-bold">U</span>
        </div>
      )}
    </div>
  );
}
