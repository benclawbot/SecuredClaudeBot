/**
 * Bot identity context loader
 * Loads identity, role, and memories for the main chatbot
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createChildLogger } from "../logger/index.js";

const log = createChildLogger("bot-context");

const BOT_DATA_DIR = join(process.cwd(), "data", "bot");

/**
 * Load bot identity context files and combine into a system prompt
 * Returns undefined if files cannot be loaded
 */
export function getBotSystemPrompt(): string | undefined {
  try {
    const identity = loadFile("identity.md");
    const role = loadFile("role.md");
    const memories = loadFile("memories.md");

    // Don't return a prompt if all files are empty
    if (!identity && !role && !memories) {
      return undefined;
    }

    return `# Identity

${identity}

# Role & Capabilities

${role}

# Memories & Context

${memories}

---

You are Claude, a helpful AI assistant. Follow the identity, role, and use the memories above to guide your interactions.`;
  } catch (err) {
    log.warn({ err }, "Failed to load bot context files, using default prompt");
    return undefined;
  }
}

/**
 * Load a single file from the bot data directory
 */
function loadFile(filename: string): string {
  try {
    const path = join(BOT_DATA_DIR, filename);
    return readFileSync(path, "utf-8");
  } catch {
    log.warn({ filename }, "Bot context file not found");
    return "";
  }
}

/**
 * Update a bot memory file
 */
export function updateBotMemory(filename: string, content: string): void {
  const path = join(BOT_DATA_DIR, filename);
  // Note: This would need fs.writeFileSync - keeping simple for now
  log.info({ filename }, "Memory update requested");
}
