"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSocket } from "./socket";
import type { ChatMessage, SystemStatus } from "./types";

/**
 * Generate a stable actor ID for this browser tab.
 * Persisted in sessionStorage so refreshes keep the same session.
 */
function getActorId(): string {
  if (typeof window === "undefined") return "ssr";
  let id = sessionStorage.getItem("scb-actor-id");
  if (!id) {
    id = `web-${crypto.randomUUID().slice(0, 8)}`;
    sessionStorage.setItem("scb-actor-id", id);
  }
  return id;
}

/**
 * Hook for the chat interface.
 * Manages session joining, sending messages, and receiving streaming responses.
 */
export function useChat() {
  const { socket, connected } = useSocket();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const actorId = useRef(getActorId());

  // Join session on connect
  useEffect(() => {
    if (!socket || !connected) return;

    socket.emit("session:join", { actorId: actorId.current });

    const onJoined = (data: {
      sessionId: string;
      messages: Array<{ role: "user" | "assistant"; content: string; ts: number }>;
    }) => {
      setSessionId(data.sessionId);
      setMessages(
        data.messages.map((m) => ({
          sessionId: data.sessionId,
          ...m,
        }))
      );
    };

    const onMessage = (msg: ChatMessage) => {
      setMessages((prev) => {
        // Avoid duplicates
        if (prev.some((m) => m.ts === msg.ts && m.content === msg.content)) {
          return prev;
        }
        return [...prev, msg];
      });
    };

    const onStreamStart = () => setStreaming(true);
    const onStreamChunk = (data: { chunk: string; sessionId: string }) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last.sessionId === data.sessionId) {
          return [
            ...prev.slice(0, -1),
            { ...last, content: last.content + data.chunk },
          ];
        }
        return [
          ...prev,
          {
            sessionId: data.sessionId,
            role: "assistant",
            content: data.chunk,
            ts: Date.now(),
          },
        ];
      });
    };
    const onStreamEnd = () => setStreaming(false);

    socket.on("session:joined", onJoined);
    socket.on("chat:message", onMessage);
    socket.on("chat:stream:start", onStreamStart);
    socket.on("chat:stream:chunk", onStreamChunk);
    socket.on("chat:stream:end", onStreamEnd);

    return () => {
      socket.off("session:joined", onJoined);
      socket.off("chat:message", onMessage);
      socket.off("chat:stream:start", onStreamStart);
      socket.off("chat:stream:chunk", onStreamChunk);
      socket.off("chat:stream:end", onStreamEnd);
    };
  }, [socket, connected]);

  const sendMessage = useCallback(
    (content: string) => {
      if (!socket || !connected || !content.trim()) return;
      socket.emit("chat:message", {
        actorId: actorId.current,
        content: content.trim(),
      });
    },
    [socket, connected]
  );

  return { messages, sessionId, streaming, connected, sendMessage };
}

/**
 * Hook for system status polling.
 */
export function useStatus(intervalMs = 5000) {
  const { socket, connected } = useSocket();
  const [status, setStatus] = useState<SystemStatus | null>(null);

  useEffect(() => {
    if (!socket || !connected) return;

    const request = () => socket.emit("status:request");

    socket.on("status:update", (data: SystemStatus) => setStatus(data));

    // Request immediately and then at interval
    request();
    const handle = setInterval(request, intervalMs);

    return () => {
      socket.off("status:update");
      clearInterval(handle);
    };
  }, [socket, connected, intervalMs]);

  return { status, connected };
}
