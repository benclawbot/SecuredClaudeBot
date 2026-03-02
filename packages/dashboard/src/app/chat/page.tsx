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
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="border-b border-zinc-800 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Chat</h2>
          {sessionId && (
            <span className="text-xs text-zinc-600 font-mono">
              {sessionId.slice(0, 8)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              connected ? "bg-emerald-400" : "bg-red-400"
            }`}
          />
          <span className="text-xs text-zinc-500">
            {connected ? "Connected" : "Reconnecting..."}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-16">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
                <span className="text-emerald-400 text-2xl font-bold">SC</span>
              </div>
              <h3 className="text-lg font-semibold text-zinc-300 mb-2">
                SecureClaudebot
              </h3>
              <p className="text-sm text-zinc-500 max-w-md mx-auto">
                Your ultra-secure AI assistant. Messages are shared in real-time
                with Telegram. Type below to start a conversation.
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
            <div className="flex items-center gap-2 text-zinc-500 text-sm py-2">
              <span className="inline-flex gap-1">
                <span className="animate-bounce" style={{ animationDelay: "0ms" }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: "150ms" }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: "300ms" }}>.</span>
              </span>
              <span>Thinking</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-zinc-800 px-6 py-4 shrink-0">
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
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 pr-24 text-sm text-zinc-100 placeholder-zinc-600 resize-none focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ minHeight: "48px", maxHeight: "200px" }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = "auto";
                target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
              }}
            />
            <button
              type="submit"
              disabled={!connected || !input.trim() || streaming}
              className="absolute right-2 bottom-2 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm rounded-md transition-colors font-medium"
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
        <div className="w-7 h-7 rounded-lg bg-emerald-500/20 flex items-center justify-center shrink-0 mt-1">
          <span className="text-emerald-400 text-xs font-bold">SC</span>
        </div>
      )}

      <div
        className={`max-w-[80%] rounded-lg px-4 py-3 ${
          role === "user"
            ? "bg-blue-600/20 border border-blue-600/20 text-zinc-100"
            : "bg-zinc-800/50 border border-zinc-800 text-zinc-200"
        }`}
      >
        <div className="text-sm whitespace-pre-wrap break-words leading-relaxed">
          {content}
        </div>
        <div
          className={`text-[10px] mt-2 ${
            role === "user" ? "text-blue-400/50" : "text-zinc-600"
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
