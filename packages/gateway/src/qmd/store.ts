/**
 * Query Memory Data (QMD) - Vector search for chatbot memory
 * Allows the chatbot to search across agent files, chat history, and memories
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createChildLogger } from "../logger/index.js";
import type { SQLiteDB } from "../memory/sqlite.js";
import type { VectorStore } from "../memory/vectors.js";

const log = createChildLogger("qmd");

export interface QmdSearchResult {
  source: "agent_file" | "chat_history" | "memory";
  id: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

/**
 * QMD - Query Memory Data
 * Provides semantic search across all stored data
 */
export class QmdStore {
  private vectorStore: VectorStore | null = null;
  private agentsDir: string;
  private db: SQLiteDB;

  constructor(db: SQLiteDB, vectorStore: VectorStore | null, agentsDir: string) {
    this.db = db;
    this.vectorStore = vectorStore;
    this.agentsDir = agentsDir;
  }

  /**
   * Search across all sources
   */
  async search(query: string, sources: ("agent_files" | "chat_history" | "memory")[] = ["agent_files", "chat_history", "memory"]): Promise<QmdSearchResult[]> {
    const results: QmdSearchResult[] = [];

    if (sources.includes("agent_files")) {
      results.push(...await this.searchAgentFiles(query));
    }

    if (sources.includes("chat_history") && this.vectorStore) {
      results.push(...await this.searchChatHistory(query));
    }

    if (sources.includes("memory") && this.vectorStore) {
      results.push(...await this.searchMemory(query));
    }

    // Sort by score
    return results.sort((a, b) => b.score - a.score).slice(0, 10);
  }

  /**
   * Search agent MD files
   */
  private async searchAgentFiles(query: string): Promise<QmdSearchResult[]> {
    const results: QmdSearchResult[] = [];
    const queryLower = query.toLowerCase();

    if (!existsSync(this.agentsDir)) {
      return results;
    }

    try {
      const agentDirs = readdirSync(this.agentsDir, { withFileTypes: true })
        .filter(dir => dir.isDirectory());

      for (const agentDir of agentDirs) {
        const agentPath = join(this.agentsDir, agentDir.name);
        const files = readdirSync(agentPath).filter(f => f.endsWith(".md"));

        for (const file of files) {
          const filePath = join(agentPath, file);
          const content = readFileSync(filePath, "utf-8");

          // Simple keyword + title matching
          const titleMatch = file.replace(".md", "").toLowerCase().includes(queryLower);
          const contentMatch = content.toLowerCase().includes(queryLower);

          if (titleMatch || contentMatch) {
            // Calculate simple score based on matches
            let score = 0;
            const title = file.replace(".md", "");
            if (title.toLowerCase().includes(queryLower)) score += 0.5;
            const matches = (content.toLowerCase().match(new RegExp(queryLower, "g")) || []).length;
            score += Math.min(matches * 0.1, 0.5);

            results.push({
              source: "agent_file",
              id: `${agentDir.name}/${file}`,
              content: content.slice(0, 500) + (content.length > 500 ? "..." : ""),
              score: Math.min(score, 1),
              metadata: {
                agent: agentDir.name,
                file,
              },
            });
          }
        }
      }
    } catch (err) {
      log.error({ err }, "Error searching agent files");
    }

    return results;
  }

  /**
   * Search chat history via vector store
   */
  private async searchChatHistory(query: string): Promise<QmdSearchResult[]> {
    if (!this.vectorStore) return [];

    try {
      const results = await this.vectorStore.search(query, 5, 0.3);
      return results.map(r => ({
        source: "chat_history" as const,
        id: String(r.id),
        content: r.content,
        score: r.score,
        metadata: r.metadata,
      }));
    } catch (err) {
      log.error({ err }, "Error searching chat history");
      return [];
    }
  }

  /**
   * Search stored memories via vector store
   */
  private async searchMemory(query: string): Promise<QmdSearchResult[]> {
    if (!this.vectorStore) return [];

    try {
      const results = await this.vectorStore.search(query, 5, 0.3);
      return results.map(r => ({
        source: "memory" as const,
        id: String(r.id),
        content: r.content,
        score: r.score,
        metadata: r.metadata,
      }));
    } catch (err) {
      log.error({ err }, "Error searching memory");
      return [];
    }
  }

  /**
   * Index chat message into vector store
   */
  async indexChatMessage(content: string, metadata: Record<string, unknown> = {}): Promise<number | null> {
    if (!this.vectorStore) return null;

    try {
      const id = await this.vectorStore.add(content, {
        ...metadata,
        type: "chat_message",
      });
      log.info({ id, contentLength: content.length }, "Indexed chat message");
      return id;
    } catch (err) {
      log.error({ err }, "Error indexing chat message");
      return null;
    }
  }

  /**
   * Index agent file content
   */
  async indexAgentFile(agentId: string, fileName: string, content: string): Promise<number | null> {
    if (!this.vectorStore) return null;

    try {
      const id = await this.vectorStore.add(content, {
        type: "agent_file",
        agentId,
        fileName,
      });
      log.info({ id, agentId, fileName }, "Indexed agent file");
      return id;
    } catch (err) {
      log.error({ err }, "Error indexing agent file");
      return null;
    }
  }
}
