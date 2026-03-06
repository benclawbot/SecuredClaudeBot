/**
 * Memory query agent for synthesizing answers from memories.
 */
import { createChildLogger } from "../../logger/index.js";
import { type RecallResult, type MemoryRecall } from "./recall.js";
import { type MemoryStore } from "./store.js";
import type { Insight } from "./schema.js";

const log = createChildLogger("memory:query");

/**
 * Response from a memory query.
 */
export interface QueryResponse {
  answer: string;
  memories: RecallResult[];
  insights: Insight[];
}

/**
 * Memory query agent that synthesizes answers from memories and insights.
 */
export class MemoryQuery {
  constructor(
    private recall: MemoryRecall,
    private store: MemoryStore
  ) {}

  /**
   * Query memories and synthesize an answer.
   * @param userId The user to query memories for
   * @param question The question to answer
   * @returns QueryResponse with answer, relevant memories, and insights
   */
  async query(userId: string, question: string): Promise<QueryResponse> {
    log.debug({ userId, question }, "Processing memory query");

    // Get relevant memories using recall
    const memories = await this.recall.recall(userId, question, 10);

    // Get recent insights from store
    const insights = this.store.getInsights(userId, 20);

    // Generate answer (stub for now - simple concatenation)
    const answer = this.synthesizeAnswer(question, memories, insights);

    log.debug(
      { userId, question, memoriesCount: memories.length, insightsCount: insights.length },
      "Memory query completed"
    );

    return {
      answer,
      memories,
      insights,
    };
  }

  /**
   * Synthesize an answer from memories and insights.
   * This is a stub implementation - returns a simple concatenation of memory content.
   */
  private synthesizeAnswer(
    question: string,
    memories: RecallResult[],
    insights: Insight[]
  ): string {
    const parts: string[] = [];

    if (memories.length > 0) {
      parts.push("Relevant memories:");
      for (const { memory } of memories) {
        parts.push(`- ${memory.content}`);
      }
    }

    if (insights.length > 0) {
      parts.push("\nInsights:");
      for (const insight of insights.slice(0, 5)) {
        parts.push(`- ${insight.content}`);
      }
    }

    if (parts.length === 0) {
      return "No relevant memories or insights found.";
    }

    return parts.join("\n");
  }
}
