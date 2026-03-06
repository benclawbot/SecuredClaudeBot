import type { SQLiteDB } from "../sqlite.js";

/**
 * Memory entry stored in the vector database.
 */
export interface Memory {
  id: string;
  userId: string;
  content: string;
  embedding: Uint8Array | null;
  timestamp: number;
  tags: string[];
  consolidated: boolean;
}

/**
 * Insight derived from consolidated memories.
 */
export interface Insight {
  id: string;
  userId: string;
  content: string;
  sourceMemoryIds: string[];
  createdAt: number;
}

/**
 * Metadata for memory operations (e.g., last consolidation time).
 */
export interface MemoryMetadata {
  userId: string;
  lastConsolidated: number | null;
}

/**
 * Initialize the memory agent database schema.
 * Creates tables for memories, insights, and metadata.
 */
export function initMemorySchema(db: SQLiteDB): void {
  // Memories table - stores vector embeddings and content
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding BLOB,
      timestamp INTEGER NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      consolidated INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Index for efficient querying by user and time
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memories_user_timestamp
    ON memories(user_id, timestamp)
  `);

  // Insights table - stores AI-generated insights from consolidated memories
  db.exec(`
    CREATE TABLE IF NOT EXISTS insights (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      source_memory_ids TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    )
  `);

  // Index for efficient querying insights by user and creation time
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_insights_user_created
    ON insights(user_id, created_at)
  `);

  // Memory metadata table - tracks consolidation state
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_metadata (
      user_id TEXT PRIMARY KEY,
      last_consolidated INTEGER
    )
  `);
}
