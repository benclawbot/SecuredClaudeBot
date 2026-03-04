/**
 * Bot identity context loader
 * Loads identity, role, and memories for the main chatbot
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createChildLogger } from "../logger/index.js";
import { MediaHandler } from "../media/handler.js";
import { getSkillsForSystemPrompt } from "../skills/manager.js";

const log = createChildLogger("bot-context");

const BOT_DATA_DIR = join(process.cwd(), "data", "bot");
let mediaHandler: MediaHandler | null = null;

/**
 * Get or create media handler for media search
 */
function getMediaHandler(): MediaHandler {
  if (!mediaHandler) {
    mediaHandler = new MediaHandler();
  }
  return mediaHandler;
}

/**
 * Get summary of available media files for the bot
 */
function getMediaSummary(): string {
  try {
    const files = getMediaHandler().list();
    if (files.length === 0) {
      return "No files in media library.";
    }

    const summary = files.slice(0, 20).map(f =>
      `- ${f.originalName} (${f.mimeType}, ${formatSize(f.sizeBytes)})`
    ).join("\n");

    const more = files.length > 20 ? `\n... and ${files.length - 20} more files` : "";
    return `## Available Files in Media Library\n\n${summary}${more}\n\nYou can search for specific files by asking the user or use the media search.`;
  } catch {
    return "";
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Load bot identity context files and combine into a system prompt
 * Returns undefined if files cannot be loaded
 */
export function getBotSystemPrompt(): string | undefined {
  try {
    const identity = loadFile("identity.md");
    const role = loadFile("role.md");
    const memories = loadFile("memories.md");
    const mediaSummary = getMediaSummary();
    const skillsSummary = getSkillsForSystemPrompt();

    // Don't return a prompt if all files are empty
    if (!identity && !role && !memories && !skillsSummary) {
      return undefined;
    }

    return `# Identity

${identity}

# Role & Capabilities

${role}

# Memories & Context

${memories}

${mediaSummary}

${skillsSummary}

# Media Sharing (Telegram)

When sending responses to Telegram users, you can include media attachments using special markers:

- **[photo:search term]** - Send an image from the media library. Example: [photo:cat photo] will search for and send an image matching "cat photo"
- **[document:search term]** - Send a document from the media library. Example: [document:report pdf]
- **[sticker:emoji]** - Send a sticker/emoji. Example: [sticker:👍] or [sticker:🎉]

The bot will automatically send the matching media file and strip the marker from the text response. Use this when users ask to see images, want to receive files, or you want to add emoji reactions to your messages.

---

You are a helpful AI assistant. Follow the identity, role, and use the memories above to guide your interactions. When users ask about files or media, reference the available files in the media library.`;
  } catch (err) {
    log.warn({ err }, "Failed to load bot context files, using default prompt");
  }
  return undefined;
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
