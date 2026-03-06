/**
 * Tests for MemoryRecall agent.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { MemoryRecall, type RecallResult } from "./recall.js";
import { MemoryStore } from "./store.js";
import { SQLiteDB } from "../sqlite.js";
import { type Memory } from "./schema.js";

describe("MemoryRecall", () => {
  let db: SQLiteDB;
  let store: MemoryStore;
  let recall: MemoryRecall;

  beforeEach(async () => {
    db = new SQLiteDB(":memory:");
    await db.init();
    store = new MemoryStore(db);
    recall = new MemoryRecall(store);
  });

  it("should recall memories by query", async () => {
    // Add test memories
    const memories: Omit<Memory, "consolidated">[] = [
      {
        id: "1",
        userId: "user1",
        content: "I love cooking Italian food",
        embedding: null,
        timestamp: 1000,
        tags: ["cooking", "italian"],
      },
      {
        id: "2",
        userId: "user1",
        content: "My favorite color is blue",
        embedding: null,
        timestamp: 2000,
        tags: ["preferences", "color"],
      },
      {
        id: "3",
        userId: "user1",
        content: "I went hiking in the mountains",
        embedding: null,
        timestamp: 3000,
        tags: ["hiking", "outdoors"],
      },
    ];

    for (const m of memories) {
      store.add(m);
    }

    // Search for "cooking"
    const results = await recall.recall("user1", "cooking");

    expect(results).toHaveLength(1);
    expect(results[0]?.memory.content).toBe("I love cooking Italian food");
    expect(results[0]?.score).toBeGreaterThan(0);
  });

  it("should sort results by score descending", async () => {
    // Add test memories with different relevance
    const memories: Omit<Memory, "consolidated">[] = [
      {
        id: "1",
        userId: "user2",
        content: "I play games and more games", // "games" appears twice = +12 (10 exact + 2 word)
        embedding: null,
        timestamp: 1000,
        tags: ["gaming"],
      },
      {
        id: "2",
        userId: "user2",
        content: "I play games every weekend with my friends", // "games" appears once = +11 (10 exact + 1 word)
        embedding: null,
        timestamp: 2000,
        tags: ["gaming", "social"],
      },
      {
        id: "3",
        userId: "user2",
        content: "The weather is nice today",
        embedding: null,
        timestamp: 3000,
        tags: ["weather"],
      },
    ];

    for (const m of memories) {
      store.add(m);
    }

    // Search for "games" - should match both gaming memories
    const results = await recall.recall("user2", "games");

    expect(results).toHaveLength(2);
    // First memory has "games" twice, should rank higher
    expect(results[0]?.memory.content).toContain("more games");
    expect(results[0]?.score).toBeGreaterThan(results[1]!.score);
  });

  it("should return empty array when no matches", async () => {
    const memories: Omit<Memory, "consolidated">[] = [
      {
        id: "1",
        userId: "user3",
        content: "I love reading books",
        embedding: null,
        timestamp: 1000,
        tags: ["reading"],
      },
    ];

    store.add(memories[0]!);

    const results = await recall.recall("user3", "pizza");

    expect(results).toHaveLength(0);
  });

  it("should respect limit parameter", async () => {
    const memories: Omit<Memory, "consolidated">[] = [
      { id: "1", userId: "user4", content: "apple fruit", embedding: null, timestamp: 1000, tags: [] },
      { id: "2", userId: "user4", content: "apple laptop", embedding: null, timestamp: 2000, tags: [] },
      { id: "3", userId: "user4", content: "apple pie", embedding: null, timestamp: 3000, tags: [] },
      { id: "4", userId: "user4", content: "red apple", embedding: null, timestamp: 4000, tags: [] },
      { id: "5", userId: "user4", content: "green apple", embedding: null, timestamp: 5000, tags: [] },
    ];

    for (const m of memories) {
      store.add(m);
    }

    const results = await recall.recall("user4", "apple", 3);

    expect(results).toHaveLength(3);
  });

  it("should only return results for the specified user", async () => {
    store.add({
      id: "1",
      userId: "user5",
      content: "User 5 secret memory",
      embedding: null,
      timestamp: 1000,
      tags: [],
    });
    store.add({
      id: "2",
      userId: "user6",
      content: "User 6 secret memory",
      embedding: null,
      timestamp: 2000,
      tags: [],
    });

    const results = await recall.recall("user5", "secret");

    expect(results).toHaveLength(1);
    expect(results[0]?.memory.userId).toBe("user5");
  });
});
