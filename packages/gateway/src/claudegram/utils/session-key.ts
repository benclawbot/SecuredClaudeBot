/**
 * Session key utilities for forum topic support.
 *
 * In regular chats, the session key is just the chatId as a string: "12345"
 * In forum topics, it combines chatId and threadId: "12345:42"
 * This allows each forum topic to have an independent session.
 */

export type SessionKey = string;

export function buildSessionKey(chatId: number, threadId?: number): SessionKey {
  return threadId !== undefined ? `${chatId}:${threadId}` : String(chatId);
}

export function parseSessionKey(key: SessionKey): { chatId: number; threadId?: number } {
  const colonIdx = key.indexOf(':');
  if (colonIdx === -1) {
    return { chatId: Number(key) };
  }
  return {
    chatId: Number(key.slice(0, colonIdx)),
    threadId: Number(key.slice(colonIdx + 1)),
  };
}

interface SessionKeyInfo {
  chatId: number;
  threadId?: number;
  sessionKey: SessionKey;
}

/**
 * Extract session key info from a Grammy context.
 * Uses message_thread_id only when is_topic_message is true (forum topics).
 */
export function getSessionKeyFromCtx(ctx: { chat?: { id: number }; message?: { is_topic_message?: boolean; message_thread_id?: number } | undefined; callbackQuery?: { message?: { is_topic_message?: boolean; message_thread_id?: number } | undefined } | undefined }): SessionKeyInfo | null {
  const chatId = ctx.chat?.id;
  if (!chatId) return null;

  const msg = ctx.message ?? ctx.callbackQuery?.message;

  const threadId = msg?.is_topic_message ? msg.message_thread_id : undefined;
  return { chatId, threadId, sessionKey: buildSessionKey(chatId, threadId) };
}
