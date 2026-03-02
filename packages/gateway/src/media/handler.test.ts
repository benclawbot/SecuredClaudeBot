import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MediaHandler } from "./handler.js";
import { existsSync, mkdirSync, rmSync } from "node:fs";

const TEST_DIR = "data/test-media";

describe("MediaHandler", () => {
  let handler: MediaHandler;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    handler = new MediaHandler(TEST_DIR);
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  describe("validate", () => {
    it("accepts valid file types", () => {
      const buf = Buffer.from("test content");
      expect(handler.validate(buf, "text/plain").valid).toBe(true);
      expect(handler.validate(buf, "application/json").valid).toBe(true);
      expect(handler.validate(buf, "image/png").valid).toBe(true);
    });

    it("rejects unsupported MIME types", () => {
      const buf = Buffer.from("test");
      const result = handler.validate(buf, "application/x-executable");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Unsupported");
    });

    it("rejects oversized files", () => {
      const buf = Buffer.alloc(26 * 1024 * 1024); // 26 MB
      const result = handler.validate(buf, "image/png");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("too large");
    });

    it("rejects empty files", () => {
      const result = handler.validate(Buffer.alloc(0), "text/plain");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Empty");
    });
  });

  describe("store + read", () => {
    it("stores and reads a file", () => {
      const data = Buffer.from("Hello, world!");
      const file = handler.store(data, "test.txt", "text/plain");

      expect(file.id).toBeTruthy();
      expect(file.originalName).toBe("test.txt");
      expect(file.mimeType).toBe("text/plain");
      expect(file.sizeBytes).toBe(data.length);

      const readBack = handler.read(file.filename);
      expect(readBack).not.toBeNull();
      expect(readBack!.toString()).toBe("Hello, world!");
    });

    it("throws for unsupported MIME type", () => {
      expect(() =>
        handler.store(Buffer.from("x"), "bad.exe", "application/x-executable")
      ).toThrow("Unsupported");
    });
  });

  describe("delete", () => {
    it("deletes a stored file", () => {
      const file = handler.store(
        Buffer.from("temp"),
        "temp.txt",
        "text/plain"
      );
      expect(handler.delete(file.filename)).toBe(true);
      expect(handler.read(file.filename)).toBeNull();
    });

    it("returns false for non-existent file", () => {
      expect(handler.delete("nonexistent.txt")).toBe(false);
    });
  });

  describe("list + stats", () => {
    it("lists stored files", () => {
      handler.store(Buffer.from("a"), "a.txt", "text/plain");
      handler.store(Buffer.from("bb"), "b.txt", "text/plain");

      const files = handler.list();
      expect(files).toHaveLength(2);
    });

    it("returns storage stats", () => {
      handler.store(Buffer.from("hello"), "h.txt", "text/plain");
      const s = handler.stats();
      expect(s.fileCount).toBe(1);
      expect(s.totalBytes).toBe(5);
    });
  });
});
