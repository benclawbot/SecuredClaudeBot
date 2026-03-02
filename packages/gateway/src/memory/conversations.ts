/**
 * Persistent conversation history backed by SQLite.
 * Stores all messages for replay, search, and context loading.
 */
import { createChildLogger } from "../logger/index.js";
import type { SQLiteDB } from "./sqlite.js";

const log = createChildLogger("memory:conversations");

export interface StoredMessage {
  id: number;
  sessionId: string;
  actorId: string;
  role: "user" | "assistant" | "system";
  content: string;
  tokenEstimate: number;
  createdAt: number;
}

/**
 * Persistent conversation store.
 */
export class ConversationStore {
  constructor(private db: SQLiteDB) {
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        token_estimate INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_conv_session ON conversations(session_id)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_conv_actor ON conversations(actor_id)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_conv_created ON conversations(created_at)
    `);
    log.info("Conversation store initialized");
  }

  /**
   * Append a message to the store.
   */
  append(
    sessionId: string,
    actorId: string,
    role: "user" | "assistant" | "system",
    content: string
  ): number {
    // Rough token estimate: ~4 chars per token
    const tokenEstimate = Math.ceil(content.length / 4);

    const { changes } = this.db.run(
      `INSERT INTO conversations (session_id, actor_id, role, content, token_estimate, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [sessionId, actorId, role, content, tokenEstimate, Date.now()]
    );

    return changes;
  }

  /**
   * Get messages for a session, ordered chronologically.
   */
  getBySession(sessionId: string, limit = 100): StoredMessage[] {
    return this.db.all<StoredMessage>(
      `SELECT id, session_id AS sessionId, actor_id AS actorId, role, content,
              token_estimate AS tokenEstimate, created_at AS createdAt
       FROM conversations
       WHERE session_id = ?
       ORDER BY created_at ASC
       LIMIT ?`,
      [sessionId, limit]
    );
  }

  /**
   * Get recent messages for an actor across all sessions.
   */
  getByActor(actorId: string, limit = 50): StoredMessage[] {
    return this.db.all<StoredMessage>(
      `SELECT id, session_id AS sessionId, actor_id AS actorId, role, content,
              token_estimate AS tokenEstimate, created_at AS createdAt
       FROM conversations
       WHERE actor_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [actorId, limit]
    );
  }

  /**
   * Full-text keyword search across all conversations.
   */
  search(query: string, limit = 20): StoredMessage[] {
    // SQLite LIKE-based search (FTS can be added later)
    const pattern = `%${query.replace(/%/g, "\\%")}%`;
    return this.db.all<StoredMessage>(
      `SELECT id, session_id AS sessionId, actor_id AS actorId, role, content,
              token_estimate AS tokenEstimate, created_at AS createdAt
       FROM conversations
       WHERE content LIKE ? ESCAPE '\\'
       ORDER BY created_at DESC
       LIMIT ?`,
      [pattern, limit]
    );
  }

  /**
   * Get total token usage for an actor (rough estimate).
   */
  getTokenUsage(actorId: string): number {
    const row = this.db.get<{ total: number }>(
      `SELECT COALESCE(SUM(token_estimate), 0) AS total
       FROM conversations WHERE actor_id = ?`,
      [actorId]
    );
    return row?.total ?? 0;
  }

  /**
   * Count messages.
   */
  count(sessionId?: string): number {
    if (sessionId) {
      const row = this.db.get<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM conversations WHERE session_id = ?`,
        [sessionId]
      );
      return row?.cnt ?? 0;
    }
    const row = this.db.get<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM conversations`
    );
    return row?.cnt ?? 0;
  }

  /**
   * Delete old messages beyond a retention period.
   */
  prune(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;
    const { changes } = this.db.run(
      `DELETE FROM conversations WHERE created_at < ?`,
      [cutoff]
    );
    if (changes > 0) {
      log.info({ pruned: changes }, "Old conversations pruned");
    }
    return changes;
  }
}
