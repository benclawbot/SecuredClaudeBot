import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConversationStore } from "./conversations.js";
import { SQLiteDB } from "./sqlite.js";
import { unlinkSync, existsSync } from "node:fs";

const TEST_DB = "data/test-conv.db";

describe("ConversationStore", () => {
  let db: SQLiteDB;
  let store: ConversationStore;

  beforeEach(async () => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    db = new SQLiteDB(TEST_DB);
    await db.init();
    store = new ConversationStore(db);
  });

  afterEach(() => {
    db.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  it("appends and retrieves messages by session", () => {
    store.append("s1", "user1", "user", "Hello");
    store.append("s1", "user1", "assistant", "Hi there!");
    store.append("s2", "user2", "user", "Other session");

    const msgs = store.getBySession("s1");
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("Hello");
    expect(msgs[1].role).toBe("assistant");
  });

  it("retrieves messages by actor across sessions", () => {
    store.append("s1", "actor-A", "user", "First");
    store.append("s2", "actor-A", "user", "Second");
    store.append("s3", "actor-B", "user", "Other actor");

    const msgs = store.getByActor("actor-A");
    expect(msgs).toHaveLength(2);
  });

  it("searches messages by keyword", () => {
    store.append("s1", "u1", "user", "I love TypeScript");
    store.append("s1", "u1", "assistant", "TypeScript is great!");
    store.append("s1", "u1", "user", "What about Python?");

    const results = store.search("TypeScript");
    expect(results).toHaveLength(2);

    const pythonResults = store.search("Python");
    expect(pythonResults).toHaveLength(1);
  });

  it("counts messages", () => {
    store.append("s1", "u1", "user", "One");
    store.append("s1", "u1", "assistant", "Two");
    store.append("s2", "u2", "user", "Three");

    expect(store.count()).toBe(3);
    expect(store.count("s1")).toBe(2);
    expect(store.count("s2")).toBe(1);
  });

  it("estimates token usage per actor", () => {
    store.append("s1", "u1", "user", "Hello world"); // ~3 tokens
    store.append("s1", "u1", "assistant", "Hi there, how are you?"); // ~6 tokens

    const usage = store.getTokenUsage("u1");
    expect(usage).toBeGreaterThan(0);
  });

  it("prunes old messages", () => {
    store.append("s1", "u1", "user", "Old message");

    // Prune anything older than 0ms (everything)
    const pruned = store.prune(0);
    expect(pruned).toBe(1);
    expect(store.count()).toBe(0);
  });
});
