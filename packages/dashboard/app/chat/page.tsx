"use client";

import { useState, useRef, useEffect, useCallback, type FormEvent } from "react";
import { useSocket } from "@/lib/socket";

// Available commands
const COMMANDS = [
  { name: "delegate", description: "Delegate a task to agents", example: "/delegate create a todo app" },
  { name: "orchestrate", description: "Start orchestration workflow", example: "/orchestrate build a website" },
  { name: "status", description: "Check system status", example: "/status" },
  { name: "help", description: "Show available commands", example: "/help" },
  { name: "clear", description: "Clear chat history", example: "/clear" },
  { name: "search", description: "Search memories (QMD)", example: "/search what I learned about X" },
];

interface Attachment {
  id: string;
  type: "image" | "file";
  name: string;
  preview?: string;
  data?: string; // base64
}

export default function ChatPage() {
  const { socket, connected } = useSocket();
  const [messages, setMessages] = useState<Array<{ role: string; content: string; ts: number; attachments?: Attachment[] }>>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [input, setInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredCommands, setFilteredCommands] = useState(COMMANDS);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Setup socket listeners
  useEffect(() => {
    if (!socket || !connected) return;

    socket.on("session:joined", (data: { sessionId: string; messages: Array<{ role: string; content: string; ts: number }> }) => {
      setSessionId(data.sessionId);
      setMessages(data.messages);
    });

    socket.on("chat:message", (data: { role: string; content: string; ts: number; attachments?: Attachment[] }) => {
      setMessages(prev => [...prev, { role: data.role, content: data.content, ts: data.ts, attachments: data.attachments }]);
    });

    socket.on("chat:stream:start", () => {
      setStreaming(true);
      setMessages(prev => [...prev, { role: "assistant", content: "", ts: Date.now() }]);
    });

    socket.on("chat:stream:chunk", (data: { chunk: string }) => {
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last && last.role === "assistant") {
          last.content += data.chunk;
        }
        return updated;
      });
    });

    socket.on("chat:stream:end", () => {
      setStreaming(false);
    });

    socket.on("voice:transcription", (data: { text?: string; error?: string }) => {
      setTranscribing(false);
      if (data.text) {
        setInput(prev => prev + (prev ? " " : "") + data.text);
      }
    });

    socket.on("file:uploaded", (data: { filename: string; isImage: boolean; error?: string }) => {
      if (data.error) {
        console.error("File upload error:", data.error);
        return;
      }
    });

    // Join session - use shared user ID to sync with Telegram
    // The same actorId allows both interfaces to share conversation history
    socket.emit("session:join", { actorId: "user-1" });

    return () => {
      socket.off("session:joined");
      socket.off("chat:message");
      socket.off("chat:stream:start");
      socket.off("chat:stream:chunk");
      socket.off("chat:stream:end");
      socket.off("voice:transcription");
      socket.off("file:uploaded");
    };
  }, [socket, connected]);

  // Filter commands based on input
  useEffect(() => {
    if (input.startsWith("/")) {
      const query = input.slice(1).toLowerCase();
      const filtered = COMMANDS.filter(
        (cmd) =>
          cmd.name.toLowerCase().includes(query) ||
          cmd.description.toLowerCase().includes(query)
      );
      setFilteredCommands(filtered);
      setShowSuggestions(filtered.length > 0 && query.length >= 0);
      setSelectedIndex(0);
    } else {
      setShowSuggestions(false);
    }
  }, [input]);

  const sendMessage = useCallback((content: string, attachmentList?: Attachment[]) => {
    if (!socket || !connected) return;

    socket.emit("chat:message", {
      actorId: "user-1",
      content,
      attachments: attachmentList,
    });

    setAttachments([]);
  }, [socket, connected]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();

    // Handle special commands
    if (input.startsWith("/")) {
      const cmd = input.split(" ")[0].slice(1).toLowerCase();
      if (cmd === "clear") {
        setInput("");
        return;
      }
    }

    if (!input.trim() && attachments.length === 0) return;
    sendMessage(input, attachments.length > 0 ? attachments : undefined);
    setInput("");
    setShowSuggestions(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSuggestions) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
      } else if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        selectCommand(filteredCommands[selectedIndex]);
      } else if (e.key === "Escape") {
        setShowSuggestions(false);
      }
    }

    if (e.key === "Enter" && !e.shiftKey && !showSuggestions) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const selectCommand = (cmd: typeof COMMANDS[0]) => {
    setInput(`/${cmd.name} `);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  // Voice recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(",")[1];
          setTranscribing(true);
          socket?.emit("voice:transcribe", { audio: base64 });
        };
        reader.readAsDataURL(audioBlob);

        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setRecording(true);
    } catch (err) {
      console.error("Failed to start recording:", err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
    }
  };

  // File handling
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        const isImage = file.type.startsWith("image/");

        const attachment: Attachment = {
          id: `${Date.now()}-${Math.random()}`,
          type: isImage ? "image" : "file",
          name: file.name,
          data: base64,
        };

        if (isImage) {
          attachment.preview = reader.result as string;
        }

        setAttachments(prev => [...prev, attachment]);

        // Send to server
        socket?.emit("file:upload", {
          filename: file.name,
          content: base64,
          type: file.type,
        });
      };
      reader.readAsDataURL(file);
    });

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Paste image handling
  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    Array.from(items).forEach(item => {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(",")[1];
          const attachment: Attachment = {
            id: `${Date.now()}-${Math.random()}`,
            type: "image",
            name: `pasted-image-${Date.now()}.png`,
            preview: reader.result as string,
            data: base64,
          };

          setAttachments(prev => [...prev, attachment]);

          socket?.emit("file:upload", {
            filename: attachment.name,
            content: base64,
            type: "image/png",
          });
        };
        reader.readAsDataURL(file);
      }
    });
  }, [socket]);

  // Attach paste handler to input
  useEffect(() => {
    const inputEl = inputRef.current;
    if (inputEl) {
      inputEl.addEventListener("paste", handlePaste);
      return () => inputEl.removeEventListener("paste", handlePaste);
    }
  }, [handlePaste]);

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
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
                FastBot
              </h3>
              <p className="text-sm text-white/40 max-w-md mx-auto leading-relaxed">
                Your ultra-secure AI assistant. Configure your LLM provider in Settings to get started.
              </p>
              <div className="mt-6 text-xs text-white/30 space-y-1">
                <p>Type <span className="text-white/50">/</span> for commands</p>
                <p>Paste images directly or attach files</p>
                <p>Click microphone to record voice</p>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <MessageBubble
              key={`${msg.ts}-${i}`}
              role={msg.role as "user" | "assistant"}
              content={msg.content}
              ts={msg.ts}
              attachments={msg.attachments}
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
        <form onSubmit={handleSubmit} className="max-w-3xl mx-auto relative">
          {/* Command suggestions dropdown */}
          {showSuggestions && filteredCommands.length > 0 && (
            <div
              ref={suggestionsRef}
              className="absolute bottom-full left-0 right-0 mb-2 bg-[#1a1a1a] border border-white/10 rounded-xl overflow-hidden shadow-xl z-50"
            >
              {filteredCommands.map((cmd, index) => (
                <button
                  key={cmd.name}
                  type="button"
                  onClick={() => selectCommand(cmd)}
                  className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors ${
                    index === selectedIndex
                      ? "bg-emerald-500/10 border-l-2 border-emerald-400"
                      : "hover:bg-white/5"
                  }`}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">/{cmd.name}</span>
                    </div>
                    <p className="text-xs text-white/40 mt-0.5">{cmd.description}</p>
                    <p className="text-xs text-white/20 mt-1 font-mono">{cmd.example}</p>
                  </div>
                  {index === selectedIndex && (
                    <span className="text-[10px] text-white/30">Tab</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Attachments preview */}
          {attachments.length > 0 && (
            <div className="flex gap-2 mb-2 flex-wrap">
              {attachments.map((att) => (
                <div key={att.id} className="relative group">
                  {att.type === "image" && att.preview ? (
                    <img src={att.preview} alt={att.name} className="w-16 h-16 object-cover rounded-lg" />
                  ) : (
                    <div className="w-16 h-16 bg-white/10 rounded-lg flex items-center justify-center">
                      <span className="text-xs text-white/50 truncate px-1">{att.name.slice(0, 8)}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeAttachment(att.id)}
                    className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="relative flex items-end gap-2">
            {/* File attach button */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              className="hidden"
              multiple
              accept="image/*,.pdf,.txt,.md,.json"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!connected}
              className="p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-colors disabled:opacity-50"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
              </svg>
            </button>

            {/* Voice record button */}
            <button
              type="button"
              onClick={recording ? stopRecording : startRecording}
              disabled={!connected || transcribing}
              className={`p-3 rounded-xl transition-colors disabled:opacity-50 ${
                recording
                  ? "bg-red-500/20 border border-red-500/50 animate-pulse"
                  : "bg-white/5 hover:bg-white/10 border border-white/10"
              }`}
            >
              {transcribing ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                  <path d="M12 2a10 10 0 0110 10" />
                </svg>
              ) : recording ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-red-400">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                  <path d="M19 10v2a7 7 0 01-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              )}
            </button>

            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                connected
                  ? recording ? "Recording..." : transcribing ? "Transcribing..." : "Type a message... (Enter to send, / for commands)"
                  : "Connecting to gateway..."
              }
              disabled={!connected || recording}
              rows={1}
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 pr-24 text-sm text-white placeholder-white/30 resize-none focus:outline-none focus:border-emerald-500/50 disabled:opacity-50"
              style={{ minHeight: "52px", maxHeight: "200px" }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = "auto";
                target.style.height = `${Math.min(target.scrollHeight, 200)}px`;
              }}
            />
            <button
              type="submit"
              disabled={!connected || (!input.trim() && attachments.length === 0) || streaming}
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
  attachments,
}: {
  role: "user" | "assistant";
  content: string;
  ts: number;
  attachments?: Attachment[];
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
        {/* Attachments */}
        {attachments && attachments.length > 0 && (
          <div className="flex gap-2 mb-2 flex-wrap">
            {attachments.map((att) => (
              <div key={att.id}>
                {att.type === "image" && att.preview ? (
                  <img src={att.preview} alt={att.name} className="max-w-[200px] rounded-lg" />
                ) : (
                  <div className="bg-white/5 px-3 py-2 rounded text-xs">{att.name}</div>
                )}
              </div>
            ))}
          </div>
        )}

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
