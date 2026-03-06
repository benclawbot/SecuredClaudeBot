/**
 * Memory store for persistent memory entries.
 * Uses SQLite for storage with the memory schema.
 */
import { createChildLogger } from "../../logger/index.js";
import { type SQLiteDB } from "../sqlite.js";
import { initMemorySchema, type Insight, type Memory } from "./schema.js";

const log = createChildLogger("memory:store");

/**
 * Memory store for CRUD operations on Memory entries.
 */
export class MemoryStore {
  private db: SQLiteDB;

  constructor(db: SQLiteDB) {
    this.db = db;
    this.init();
  }

  private init(): void {
    initMemorySchema(this.db);
    log.info("Memory store initialized");
  }

  /**
   * Add a new memory entry.
   */
  add(memory: Omit<Memory, "consolidated">): void {
    this.db.run(
      `INSERT INTO memories (id, user_id, content, embedding, timestamp, tags, consolidated)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        memory.id,
        memory.userId,
        memory.content,
        memory.embedding,
        memory.timestamp,
        JSON.stringify(memory.tags),
        0,
      ]
    );
  }

  /**
   * Get all memories for a user.
   */
  getByUser(userId: string, limit = 100): Memory[] {
    const rows = this.db.all<{
      id: string;
      user_id: string;
      content: string;
      embedding: Uint8Array | null;
      timestamp: number;
      tags: string;
      consolidated: number;
    }>(
      `SELECT id, user_id, content, embedding, timestamp, tags, consolidated
       FROM memories
       WHERE user_id = ?
       ORDER BY timestamp DESC
       LIMIT ?`,
      [userId, limit]
    );

    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      content: row.content,
      embedding: row.embedding,
      timestamp: row.timestamp,
      tags: JSON.parse(row.tags),
      consolidated: row.consolidated === 1,
    }));
  }

  /**
   * Get a single memory by ID.
   */
  getById(id: string): Memory | undefined {
    const row = this.db.get<{
      id: string;
      user_id: string;
      content: string;
      embedding: Uint8Array | null;
      timestamp: number;
      tags: string;
      consolidated: number;
    }>(
      `SELECT id, user_id, content, embedding, timestamp, tags, consolidated
       FROM memories
       WHERE id = ?`,
      [id]
    );

    if (!row) return undefined;

    return {
      id: row.id,
      userId: row.user_id,
      content: row.content,
      embedding: row.embedding,
      timestamp: row.timestamp,
      tags: JSON.parse(row.tags),
      consolidated: row.consolidated === 1,
    };
  }

  /**
   * Update memory consolidated status.
   */
  markConsolidated(id: string): void {
    this.db.run(`UPDATE memories SET consolidated = 1 WHERE id = ?`, [id]);
  }

  /**
   * Get unconsolidated memories for a user since a given timestamp.
   */
  getUnconsolidated(userId: string, since: number): Memory[] {
    const rows = this.db.all<{
      id: string;
      user_id: string;
      content: string;
      embedding: Uint8Array | null;
      timestamp: number;
      tags: string;
      consolidated: number;
    }>(
      `SELECT id, user_id, content, embedding, timestamp, tags, consolidated
       FROM memories
       WHERE user_id = ? AND consolidated = 0 AND timestamp >= ?
       ORDER BY timestamp ASC`,
      [userId, since]
    );

    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      content: row.content,
      embedding: row.embedding,
      timestamp: row.timestamp,
      tags: JSON.parse(row.tags),
      consolidated: row.consolidated === 1,
    }));
  }

  /**
   * Store an insight derived from consolidated memories.
   */
  storeInsight(insight: Omit<Insight, "id" | "createdAt">): Insight {
    const id = crypto.randomUUID();
    const createdAt = Date.now();

    this.db.run(
      `INSERT INTO insights (id, user_id, content, source_memory_ids, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        id,
        insight.userId,
        insight.content,
        JSON.stringify(insight.sourceMemoryIds),
        createdAt,
      ]
    );

    return {
      id,
      userId: insight.userId,
      content: insight.content,
      sourceMemoryIds: insight.sourceMemoryIds,
      createdAt,
    };
  }

  /**
   * Delete a memory by ID.
   */
  delete(id: string): void {
    this.db.run(`DELETE FROM memories WHERE id = ?`, [id]);
  }

  /**
   * Get all memories for a user (for recall search).
   */
  getAllForUser(userId: string): Memory[] {
    return this.getByUser(userId, 1000);
  }

  /**
   * Get all insights for a user.
   */
  getInsights(userId: string, limit = 50): Insight[] {
    const rows = this.db.all<{
      id: string;
      user_id: string;
      content: string;
      source_memory_ids: string;
      created_at: number;
    }>(
      `SELECT id, user_id, content, source_memory_ids, created_at
       FROM insights
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [userId, limit]
    );

    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      content: row.content,
      sourceMemoryIds: JSON.parse(row.source_memory_ids),
      createdAt: row.created_at,
    }));
  }
}
