/**
 * Vector memory store for semantic search.
 * Uses a simple cosine-similarity approach stored in SQLite.
 * Embeddings are generated via OpenAI or Ollama API.
 */
import { createChildLogger } from "../logger/index.js";
import type { SQLiteDB } from "./sqlite.js";
import type { MemoryConfig } from "../config/schema.js";

const log = createChildLogger("memory:vectors");

export interface VectorEntry {
  id: number;
  content: string;
  metadata: string;
  embedding: number[];
  createdAt: number;
}

export interface SearchResult {
  id: number;
  content: string;
  metadata: Record<string, unknown>;
  score: number;
}

/**
 * Cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Generate embeddings via OpenAI-compatible API.
 */
async function generateEmbedding(
  text: string,
  config: MemoryConfig
): Promise<number[]> {
  const baseUrl =
    config.embeddingProvider === "ollama"
      ? config.ollamaBaseUrl ?? "http://localhost:11434/api"
      : "https://api.openai.com/v1";

  if (config.embeddingProvider === "ollama") {
    const resp = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.embeddingModel, prompt: text }),
    });
    const data = (await resp.json()) as { embedding: number[] };
    return data.embedding;
  }

  // OpenAI
  const resp = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // API key should be passed via keystore; placeholder for now
      Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}`,
    },
    body: JSON.stringify({
      model: config.embeddingModel,
      input: text,
    }),
  });
  const data = (await resp.json()) as {
    data: Array<{ embedding: number[] }>;
  };
  return data.data[0]?.embedding ?? [];
}

/**
 * Vector memory store with SQLite-backed persistence.
 */
export class VectorStore {
  private memoryConfig: MemoryConfig;

  constructor(
    private db: SQLiteDB,
    config: MemoryConfig
  ) {
    this.memoryConfig = config;
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        embedding TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
      )
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_vec_created ON vectors(created_at)
    `);
    log.info("Vector store initialized");
  }

  /**
   * Store a text chunk with its embedding.
   */
  async add(
    content: string,
    metadata: Record<string, unknown> = {}
  ): Promise<number> {
    const embedding = await generateEmbedding(content, this.memoryConfig);
    this.db.run(
      `INSERT INTO vectors (content, metadata, embedding, created_at)
       VALUES (?, ?, ?, ?)`,
      [
        content,
        JSON.stringify(metadata),
        JSON.stringify(embedding),
        Date.now(),
      ]
    );

    const row = this.db.get<{ id: number }>(
      `SELECT last_insert_rowid() AS id`
    );
    return row?.id ?? 0;
  }

  /**
   * Store with a pre-computed embedding (useful for batch operations).
   */
  addWithEmbedding(
    content: string,
    embedding: number[],
    metadata: Record<string, unknown> = {}
  ): void {
    this.db.run(
      `INSERT INTO vectors (content, metadata, embedding, created_at)
       VALUES (?, ?, ?, ?)`,
      [content, JSON.stringify(metadata), JSON.stringify(embedding), Date.now()]
    );
  }

  /**
   * Semantic search: find most similar entries to a query.
   */
  async search(query: string, topK = 5, minScore = 0.3): Promise<SearchResult[]> {
    const queryEmb = await generateEmbedding(query, this.memoryConfig);
    return this.searchByEmbedding(queryEmb, topK, minScore);
  }

  /**
   * Search with a pre-computed embedding.
   */
  searchByEmbedding(
    queryEmb: number[],
    topK = 5,
    minScore = 0.3
  ): SearchResult[] {
    // Load all vectors (for small-medium stores; switch to approx NN for large)
    const rows = this.db.all<{
      id: number;
      content: string;
      metadata: string;
      embedding: string;
    }>(`SELECT id, content, metadata, embedding FROM vectors`);

    const scored = rows
      .map((row) => {
        const emb = JSON.parse(row.embedding) as number[];
        const score = cosineSimilarity(queryEmb, emb);
        return {
          id: row.id,
          content: row.content,
          metadata: JSON.parse(row.metadata) as Record<string, unknown>,
          score,
        };
      })
      .filter((r) => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored;
  }

  /**
   * Hybrid search: combine keyword + semantic results.
   */
  async hybridSearch(
    query: string,
    topK = 10,
    keywordWeight = 0.3,
    semanticWeight = 0.7
  ): Promise<SearchResult[]> {
    // Keyword search with LIKE
    const pattern = `%${query.replace(/%/g, "\\%")}%`;
    const keywordRows = this.db.all<{
      id: number;
      content: string;
      metadata: string;
    }>(
      `SELECT id, content, metadata FROM vectors WHERE content LIKE ? ESCAPE '\\' LIMIT 50`,
      [pattern]
    );

    // Semantic search
    const semanticResults = await this.search(query, topK * 2, 0.2);

    // Merge scores
    const merged = new Map<number, SearchResult>();

    for (const sr of semanticResults) {
      merged.set(sr.id, {
        ...sr,
        score: sr.score * semanticWeight,
      });
    }

    for (const kr of keywordRows) {
      const existing = merged.get(kr.id);
      if (existing) {
        existing.score += keywordWeight;
      } else {
        merged.set(kr.id, {
          id: kr.id,
          content: kr.content,
          metadata: JSON.parse(kr.metadata) as Record<string, unknown>,
          score: keywordWeight,
        });
      }
    }

    return Array.from(merged.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /**
   * Count total stored vectors.
   */
  count(): number {
    const row = this.db.get<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM vectors`
    );
    return row?.cnt ?? 0;
  }

  /**
   * Delete vectors older than a given age.
   */
  prune(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;
    const { changes } = this.db.run(
      `DELETE FROM vectors WHERE created_at < ?`,
      [cutoff]
    );
    return changes;
  }
}
