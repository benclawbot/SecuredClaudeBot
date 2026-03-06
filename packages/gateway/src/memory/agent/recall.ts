/**
 * Memory recall agent for searching memories by text similarity.
 * Uses simple text-based scoring (no embedding vectors yet).
 */
import { createChildLogger } from "../../logger/index.js";
import type { Memory } from "./schema.js";
import { type MemoryStore } from "./store.js";

const log = createChildLogger("memory:recall");

/**
 * Result of a memory recall search.
 */
export interface RecallResult {
  memory: Memory;
  score: number;
}

/**
 * Memory recall agent that searches memories by text query.
 * Uses simple text-based scoring:
 * - Exact substring match: +10 points
 * - Word overlap: count of query words found in content
 */
export class MemoryRecall {
  constructor(private store: MemoryStore) {}

  /**
   * Search memories by text query.
   * @param userId The user to search memories for
   * @param query Search query string
   * @param limit Maximum number of results to return (default: 10)
   * @returns Array of recall results sorted by relevance score
   */
  async recall(userId: string, query: string, limit = 10): Promise<RecallResult[]> {
    const memories = this.store.getAllForUser(userId);
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 0);

    const results: RecallResult[] = [];

    for (const memory of memories) {
      const contentLower = memory.content.toLowerCase();
      let score = 0;

      // Exact substring match: +10 points
      if (contentLower.includes(queryLower)) {
        score += 10;
      }

      // Word overlap: +1 point per occurrence of each query word in content
      for (const word of queryWords) {
        if (word.length > 1) {
          // Count occurrences of word in content
          const regex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
          const matches = contentLower.match(regex);
          if (matches) {
            score += matches.length;
          }
        }
      }

      // Only include memories with a positive score
      if (score > 0) {
        results.push({ memory, score });
      }
    }

    // Sort by score descending, then by timestamp (newest first)
    results.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return b.memory.timestamp - a.memory.timestamp;
    });

    log.debug({ userId, query, resultsCount: results.length }, "Recall search completed");

    return results.slice(0, limit);
  }
}
