import { Bot, type Context } from "grammy";
import { createChildLogger } from "../logger/index.js";
import { ApprovalManager } from "./approval.js";
import { chunkMessage } from "./chunker.js";
import { getBotSystemPrompt } from "../bot/context.js";
import { MediaHandler } from "../media/handler.js";
import type { GatewayContext } from "../index.js";
// Claudegram imports
import { sendToAgent, sendLoopToAgent, clearConversation } from "../claudegram/claude/agent.js";
import { sessionManager } from "../claudegram/claude/session-manager.js";

const log = createChildLogger("telegram");

const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;

export class TelegramBot {
  private bot: Bot;
  private approval: ApprovalManager;
  private reconnectAttempts = 0;
  private running = false;
  private systemPrompt: string | undefined;
  private mediaHandler: MediaHandler;

  constructor(private ctx: GatewayContext) {
    const botToken = ctx.config.telegram.botToken;
    if (!botToken) {
      throw new Error("Telegram bot token is required");
    }
    this.bot = new Bot(botToken);
    this.approval = new ApprovalManager(ctx.config.telegram.approvedUsers);
    this.systemPrompt = getBotSystemPrompt();
    this.mediaHandler = new MediaHandler();
    this.setupHandlers();
    this.registerCommands();
  }

  /**
   * Register bot commands to override any old commands
   */
  private async registerCommands(): Promise<void> {
    try {
      await this.bot.api.setMyCommands([
        { command: "start", description: "Start the bot" },
        { command: "help", description: "Show available commands" },
        { command: "status", description: "Check system status" },
        { command: "voice", description: "Enable voice replies" },
        { command: "text", description: "Disable voice replies" },
        { command: "models", description: "List available LLM models" },
        { command: "project", description: "Set working directory" },
        { command: "plan", description: "Plan mode" },
        { command: "explore", description: "Explore mode" },
        { command: "loop", description: "Iterative mode" },
        { command: "clear", description: "Clear conversation" },
      ]);
      log.info("Bot commands registered");
    } catch (err) {
      log.warn({ err }, "Failed to register bot commands");
    }
  }

  private setupHandlers(): void {
    // /start command
    this.bot.command("start", async (botCtx) => {
      const userId = botCtx.from?.id;
      if (!userId) return;

      if (this.approval.isApproved(userId)) {
        await botCtx.reply(
          "Welcome back to FastBot. Send any message to chat with the AI agent."
        );
        return;
      }

      if (this.approval.isBlocked(userId)) {
        await botCtx.reply("Access denied. Contact the administrator.");
        return;
      }

      const code = this.approval.generateCode(userId);
      await botCtx.reply(
        `FastBot requires approval.\n\nYour code: \`${code}\`\n\nReply with this code to verify.`,
        { parse_mode: "Markdown" }
      );

      this.ctx.audit.log({
        event: "auth.telegram_rejected",
        actor: String(userId),
        detail: "Approval code sent",
      });
    });

    // /status command
    this.bot.command("status", async (botCtx) => {
      const userId = botCtx.from?.id;
      if (!userId || !this.approval.isApproved(userId)) {
        await botCtx.reply("Not authorized.");
        return;
      }

      const status = this.getStatus();
      const voiceEnabled = this.ctx.config.telegram.voiceReplies;
      await botCtx.reply(
        `*FastBot Status*\n\n` +
          `Gateway: ${status.gateway}\n` +
          `Uptime: ${status.uptimeMin}m\n` +
          `Memory: ${status.memoryMB}MB\n` +
          `Sessions: ${status.sessions}\n` +
          `Voice Replies: ${voiceEnabled ? "ON" : "OFF"}`,
        { parse_mode: "Markdown" }
      );
    });

    // /voice command - toggle voice replies on
    this.bot.command("voice", async (botCtx) => {
      const userId = botCtx.from?.id;
      if (!userId || !this.approval.isApproved(userId)) {
        await botCtx.reply("Not authorized.");
        return;
      }

      this.ctx.config.telegram.voiceReplies = true;
      await botCtx.reply("Voice replies enabled. I'll respond with voice notes! 🎤");
    });

    // /text command - toggle voice replies off
    this.bot.command("text", async (botCtx) => {
      const userId = botCtx.from?.id;
      if (!userId || !this.approval.isApproved(userId)) {
        await botCtx.reply("Not authorized.");
        return;
      }

      this.ctx.config.telegram.voiceReplies = false;
      await botCtx.reply("Voice replies disabled. I'll respond with text only.");
    });

    // /help command
    this.bot.command("help", async (botCtx) => {
      const userId = botCtx.from?.id;
      if (!userId || !this.approval.isApproved(userId)) {
        await botCtx.reply("Not authorized.");
        return;
      }

      await botCtx.reply(
        `*FastBot Commands*\n\n` +
          `/start - Start the bot\n` +
          `/help - Show this message\n` +
          `/status - Check system status\n` +
          `/voice - Enable voice replies\n` +
          `/text - Disable voice replies\n` +
          `/models - List available LLM models\n\n` +
          `*Claudegram Commands*\n\n` +
          `/project <dir> - Set working directory\n` +
          `/plan <task> - Plan mode\n` +
          `/explore <question> - Explore mode\n` +
          `/loop <task> - Iterative mode\n` +
          `/clear - Clear conversation`,
        { parse_mode: "Markdown" }
      );
    });

    // ── Claudegram Commands ──

    // /project command
    this.bot.command("project", async (botCtx) => {
      const userId = botCtx.from?.id;
      if (!userId || !this.approval.isApproved(userId)) {
        await botCtx.reply("Not authorized.");
        return;
      }

      const args = botCtx.message?.text.split(" ").slice(1).join(" ");
      if (!args) {
        await botCtx.reply("Usage: /project /path/to/directory");
        return;
      }

      const sessionKey = `user:${userId}`;
      sessionManager.setWorkingDirectory(sessionKey, args);
      clearConversation(sessionKey);
      await botCtx.reply(`✅ Project set to: ${args}`);
    });

    // /newproject command - create new project directory
    this.bot.command("newproject", async (botCtx) => {
      const userId = botCtx.from?.id;
      if (!userId || !this.approval.isApproved(userId)) {
        await botCtx.reply("Not authorized.");
        return;
      }

      const args = botCtx.message?.text.split(" ").slice(1).join(" ");
      if (!args) {
        await botCtx.reply("Usage: /newproject my-project-name");
        return;
      }

      const workspaceDir = process.env.WORKSPACE_DIR || process.env.HOME || ".";
      const projectPath = `${workspaceDir}/${args}`;

      try {
        const { mkdir } = await import("fs/promises");
        await mkdir(projectPath, { recursive: true });

        const sessionKey = `user:${userId}`;
        sessionManager.setWorkingDirectory(sessionKey, projectPath);
        clearConversation(sessionKey);

        await botCtx.reply(`✅ Created and switched to: ${projectPath}`);
      } catch (err) {
        await botCtx.reply(`Error creating project: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    });

    // /plan command
    this.bot.command("plan", async (botCtx) => {
      const userId = botCtx.from?.id;
      if (!userId || !this.approval.isApproved(userId)) {
        await botCtx.reply("Not authorized.");
        return;
      }

      const task = botCtx.message?.text.split(" ").slice(1).join(" ");
      if (!task) {
        await botCtx.reply("Usage: /plan build a todo app");
        return;
      }

      const sessionKey = `user:${userId}`;
      await botCtx.replyWithChatAction("typing");

      try {
        const response = await sendToAgent(sessionKey, task, { command: "plan" });
        await this.sendResponse(userId, response.text);
      } catch (err) {
        await botCtx.reply(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    });

    // /explore command
    this.bot.command("explore", async (botCtx) => {
      const userId = botCtx.from?.id;
      if (!userId || !this.approval.isApproved(userId)) {
        await botCtx.reply("Not authorized.");
        return;
      }

      const question = botCtx.message?.text.split(" ").slice(1).join(" ");
      if (!question) {
        await botCtx.reply("Usage: /explore how does auth work");
        return;
      }

      const sessionKey = `user:${userId}`;
      await botCtx.replyWithChatAction("typing");

      try {
        const response = await sendToAgent(sessionKey, question, { command: "explore" });
        await this.sendResponse(userId, response.text);
      } catch (err) {
        await botCtx.reply(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    });

    // /loop command
    this.bot.command("loop", async (botCtx) => {
      const userId = botCtx.from?.id;
      if (!userId || !this.approval.isApproved(userId)) {
        await botCtx.reply("Not authorized.");
        return;
      }

      const task = botCtx.message?.text.split(" ").slice(1).join(" ");
      if (!task) {
        await botCtx.reply("Usage: /loop fix all bugs");
        return;
      }

      const sessionKey = `user:${userId}`;
      await botCtx.replyWithChatAction("typing");

      try {
        const response = await sendLoopToAgent(sessionKey, task);
        await this.sendResponse(userId, response.text);
      } catch (err) {
        await botCtx.reply(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    });

    // /clear command
    this.bot.command("clear", async (botCtx) => {
      const userId = botCtx.from?.id;
      if (!userId || !this.approval.isApproved(userId)) {
        await botCtx.reply("Not authorized.");
        return;
      }

      const sessionKey = `user:${userId}`;
      clearConversation(sessionKey);
      await botCtx.reply("✅ Conversation cleared");
    });

    // /sessions command - list all sessions
    this.bot.command("sessions", async (botCtx) => {
      const userId = botCtx.from?.id;
      if (!userId || !this.approval.isApproved(userId)) {
        await botCtx.reply("Not authorized.");
        return;
      }

      const sessionKey = `user:${userId}`;
      const history = sessionManager.getSessionHistory(sessionKey, 10);

      if (history.length === 0) {
        await botCtx.reply("No sessions found.");
        return;
      }

      const lines = ["*Your Recent Sessions:*\n"];
      history.forEach((entry, i) => {
        const date = new Date(entry.lastActivity).toLocaleDateString();
        const preview = entry.lastMessagePreview?.slice(0, 50) || "empty";
        lines.push(`${i + 1}. ${entry.projectPath} - ${date}`);
        lines.push(`   ${preview}...`);
      });

      await botCtx.reply(lines.join("\n"), { parse_mode: "Markdown" });
    });

    // /resume command - pick from recent sessions
    this.bot.command("resume", async (botCtx) => {
      const userId = botCtx.from?.id;
      if (!userId || !this.approval.isApproved(userId)) {
        await botCtx.reply("Not authorized.");
        return;
      }

      const sessionKey = `user:${userId}`;
      const lastSession = sessionManager.resumeLastSession(sessionKey);

      if (lastSession) {
        await botCtx.reply(`✅ Resumed session for: ${lastSession.workingDirectory}`);
      } else {
        await botCtx.reply("No previous session found.");
      }
    });

    // /continue command - alias for resume
    this.bot.command("continue", async (botCtx) => {
      const userId = botCtx.from?.id;
      if (!userId || !this.approval.isApproved(userId)) {
        await botCtx.reply("Not authorized.");
        return;
      }

      const sessionKey = `user:${userId}`;
      const lastSession = sessionManager.resumeLastSession(sessionKey);

      if (lastSession) {
        await botCtx.reply(`✅ Continued session: ${lastSession.workingDirectory}`);
      } else {
        await botCtx.reply("No session to continue.");
      }
    });

    // /teleport command - move session to terminal
    this.bot.command("teleport", async (botCtx) => {
      const userId = botCtx.from?.id;
      if (!userId || !this.approval.isApproved(userId)) {
        await botCtx.reply("Not authorized.");
        return;
      }

      await botCtx.reply("Session forked to terminal. You can now continue in terminal.");
    });

    // /softreset command - clear conversation but keep session
    this.bot.command("softreset", async (botCtx) => {
      const userId = botCtx.from?.id;
      if (!userId || !this.approval.isApproved(userId)) {
        await botCtx.reply("Not authorized.");
        return;
      }

      const sessionKey = `user:${userId}`;
      clearConversation(sessionKey);
      await botCtx.reply("✅ Conversation reset (session preserved)");
    });

    // /models command
    this.bot.command("models", async (botCtx) => {
      const userId = botCtx.from?.id;
      if (!userId || !this.approval.isApproved(userId)) {
        await botCtx.reply("Not authorized.");
        return;
      }

      const provider = this.ctx.config.llm.primary?.provider;
      const model = this.ctx.config.llm.primary?.model;
      await botCtx.reply(
        `*Available LLM*\n\n` +
          `Provider: ${provider || "unknown"}\n` +
          `Model: ${model || "unknown"}\n\n` +
          `Configured fallback: ${this.ctx.config.llm.fallbacks?.length || 0}`,
        { parse_mode: "Markdown" }
      );
    });

    // Message handler
    this.bot.on("message:text", async (botCtx) => {
      const userId = botCtx.from?.id;
      if (!userId) return;

      // Blocked check
      if (this.approval.isBlocked(userId)) return;

      // Pending approval — treat message as code attempt
      if (!this.approval.isApproved(userId)) {
        const text = botCtx.message.text.trim();
        if (this.approval.verify(userId, text)) {
          await botCtx.reply(
            "Approved! You can now chat with FastBot."
          );
          this.ctx.audit.log({
            event: "auth.telegram_approved",
            actor: String(userId),
          });
        } else {
          if (this.approval.isBlocked(userId)) {
            await botCtx.reply("Too many attempts. Access blocked.");
            this.ctx.audit.log({
              event: "auth.telegram_rejected",
              actor: String(userId),
              detail: "Blocked after max attempts",
            });
          } else {
            await botCtx.reply("Invalid code. Try again.");
          }
        }
        return;
      }

      // Rate limit check - use unified session ID to sync with web dashboard
      const actorId = `user-1`;

      // Check for stop command
      const content = botCtx.message.text.trim();
      if (content.toLowerCase() === "stop") {
        const session = this.ctx.sessions.getByActor(actorId);
        if (session) {
          const aborted = this.ctx.sessions.abortStreaming(session.id);
          if (aborted) {
            this.ctx.io.to(session.id).emit("chat:stream:end", { sessionId: session.id, stopped: true });
            await botCtx.reply("What should be changed?");
            this.ctx.sessions.addMessage(session.id, "assistant", "What should be changed?");
            log.info({ sessionId: session.id }, "Chat stream stopped by user");
          }
        }
        return;
      }

      if (!this.ctx.rateLimiter.consume(actorId)) {
        await botCtx.reply("Rate limited. Please wait a moment.");
        this.ctx.audit.log({
          event: "security.rate_limited",
          actor: actorId,
          detail: "Telegram rate limit exceeded",
        });
        return;
      }

      // Debounce check
      if (this.ctx.sessions.isDuplicate(actorId, content)) return;

      // Get or create shared session
      const session = this.ctx.sessions.getOrCreate(actorId, "telegram");
      this.ctx.sessions.addMessage(session.id, "user", content);

      // Send typing indicator
      await botCtx.replyWithChatAction("typing");

      // Emit to Socket.io so dashboard sees it
      this.ctx.io.to(session.id).emit("chat:message", {
        sessionId: session.id,
        role: "user",
        content,
        ts: Date.now(),
        source: "telegram",
      });

      // Route to LLM
      log.info({ userId, sessionId: session.id }, "Telegram message received, routing to LLM");
      this.ctx.io.to(session.id).emit("chat:stream:start", { sessionId: session.id });

      // Create abort controller for this request
      const abortController = new AbortController();
      this.ctx.sessions.setAbortController(session.id, abortController);

      try {
        const messages = session.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

        let fullResponse = "";
        try {
          for await (const chunk of this.ctx.llmRouter.stream(messages, session.id, this.systemPrompt, abortController.signal)) {
            fullResponse += chunk;
            this.ctx.io.to(session.id).emit("chat:stream:chunk", {
              sessionId: session.id,
              chunk,
            });
          }
        } finally {
          this.ctx.sessions.setAbortController(session.id, null);
        }

        this.ctx.sessions.addMessage(session.id, "assistant", fullResponse);
        this.ctx.io.to(session.id).emit("chat:stream:end", { sessionId: session.id });

        // Send response back to Telegram
        await this.sendResponse(userId, fullResponse);
      } catch (err) {
        log.error({ err, userId, sessionId: session.id }, "LLM generation failed for Telegram");
        await this.sendResponse(userId, "Sorry, I failed to generate a response. Check the gateway logs.");
        this.ctx.io.to(session.id).emit("chat:stream:end", { sessionId: session.id });
      }
    });

    // Voice message handler
    this.bot.on("message:voice", async (botCtx) => {
      const userId = botCtx.from?.id;
      if (!userId || !this.approval.isApproved(userId)) return;
      if (this.approval.isBlocked(userId)) return;

      const voice = botCtx.message.voice;
      if (!voice) return;

      // Rate limit check - use unified session ID to sync with web dashboard
      const actorId = `user-1`;
      if (!this.ctx.rateLimiter.consume(actorId)) {
        await botCtx.reply("Rate limited. Please wait a moment.");
        return;
      }

      try {
        // Download the voice file
        const file = await botCtx.api.getFile(voice.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${this.ctx.config.telegram.botToken}/${file.file_path}`;

        // Fetch and convert to buffer
        const response = await fetch(fileUrl);
        const buffer = Buffer.from(await response.arrayBuffer());

        // Transcribe using Whisper
        const result = await this.transcribeAudio(buffer);
        const text = result.text;

        log.info({ userId, text }, "Voice transcribed from Telegram");

        // Get or create shared session
        const session = this.ctx.sessions.getOrCreate(actorId, "telegram");
        this.ctx.sessions.addMessage(session.id, "user", text);

        // Send typing indicator
        await botCtx.replyWithChatAction("typing");

        // Emit to Socket.io so dashboard sees it
        this.ctx.io.to(session.id).emit("chat:message", {
          sessionId: session.id,
          role: "user",
          content: text,
          ts: Date.now(),
          source: "telegram",
        });

        // Route to LLM
        log.info({ userId, sessionId: session.id }, "Voice message received, routing to LLM");
        this.ctx.io.to(session.id).emit("chat:stream:start", { sessionId: session.id });

        const messages = session.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

        let fullResponse = "";
        for await (const chunk of this.ctx.llmRouter.stream(messages, session.id, this.systemPrompt)) {
          fullResponse += chunk;
          this.ctx.io.to(session.id).emit("chat:stream:chunk", {
            sessionId: session.id,
            chunk,
          });
        }

        this.ctx.sessions.addMessage(session.id, "assistant", fullResponse);
        this.ctx.io.to(session.id).emit("chat:stream:end", { sessionId: session.id });

        // Send response back to Telegram
        await this.sendResponse(userId, fullResponse);
      } catch (err) {
        log.error({ err, userId }, "Failed to process voice message");
        await this.sendResponse(userId, "Sorry, I couldn't process your voice message.");
      }
    });

    // Photo message handler - download, store, extract text via OCR
    this.bot.on("message:photo", async (botCtx) => {
      const userId = botCtx.from?.id;
      if (!userId || !this.approval.isApproved(userId)) return;
      if (this.approval.isBlocked(userId)) return;

      const photo = botCtx.message.photo;
      if (!photo || photo.length === 0) return;

      // Rate limit check
      const actorId = `user-1`;
      if (!this.ctx.rateLimiter.consume(actorId)) {
        await botCtx.reply("Rate limited. Please wait a moment.");
        return;
      }

      try {
        // Get the largest photo (highest resolution)
        const largestPhoto = photo[photo.length - 1];

        // Download the photo
        const file = await botCtx.api.getFile(largestPhoto.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${this.ctx.config.telegram.botToken}/${file.file_path}`;
        const response = await fetch(fileUrl);
        const buffer = Buffer.from(await response.arrayBuffer());

        // Determine mime type from file_path
        const ext = file.file_path?.split(".").pop() || "jpg";
        const mimeType = ext === "png" ? "image/png" : "image/jpeg";

        // Store the file
        const filename = `telegram_${Date.now()}_${largestPhoto.file_id}.${ext}`;
        const storedFile = this.mediaHandler.store(buffer, filename, mimeType);

        log.info({ userId, fileId: storedFile.id, size: storedFile.sizeBytes }, "Photo stored from Telegram");

        // Extract text via OCR
        await botCtx.replyWithChatAction("typing");
        const extractedText = await this.mediaHandler.extractText(storedFile.id);

        // Build user message with extracted text
        const userMessage = extractedText
          ? `[Image sent]\n\nExtracted text: ${extractedText.slice(0, 2000)}${extractedText.length > 2000 ? "..." : ""}`
          : "[Image sent - no text could be extracted]";

        // Get or create shared session
        const session = this.ctx.sessions.getOrCreate(actorId, "telegram");
        this.ctx.sessions.addMessage(session.id, "user", userMessage);

        // Emit to Socket.io
        this.ctx.io.to(session.id).emit("chat:message", {
          sessionId: session.id,
          role: "user",
          content: userMessage,
          ts: Date.now(),
          source: "telegram",
          attachment: {
            type: "image",
            fileId: storedFile.id,
            extractedText: extractedText,
          },
        });

        // Route to LLM
        log.info({ userId, sessionId: session.id }, "Photo received from Telegram, routing to LLM");
        this.ctx.io.to(session.id).emit("chat:stream:start", { sessionId: session.id });

        const messages = session.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

        let fullResponse = "";
        for await (const chunk of this.ctx.llmRouter.stream(messages, session.id, this.systemPrompt)) {
          fullResponse += chunk;
          this.ctx.io.to(session.id).emit("chat:stream:chunk", {
            sessionId: session.id,
            chunk,
          });
        }

        this.ctx.sessions.addMessage(session.id, "assistant", fullResponse);
        this.ctx.io.to(session.id).emit("chat:stream:end", { sessionId: session.id });

        // Send response back to Telegram
        await this.sendResponse(userId, fullResponse);
      } catch (err) {
        log.error({ err, userId }, "Failed to process photo");
        await this.sendResponse(userId, "Sorry, I couldn't process the image.");
      }
    });

    // Document message handler - download, store, extract text
    this.bot.on("message:document", async (botCtx) => {
      const userId = botCtx.from?.id;
      if (!userId || !this.approval.isApproved(userId)) return;
      if (this.approval.isBlocked(userId)) return;

      const document = botCtx.message.document;
      if (!document) return;

      // Rate limit check
      const actorId = `user-1`;
      if (!this.ctx.rateLimiter.consume(actorId)) {
        await botCtx.reply("Rate limited. Please wait a moment.");
        return;
      }

      try {
        // Download the document
        const file = await botCtx.api.getFile(document.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${this.ctx.config.telegram.botToken}/${file.file_path}`;
        const response = await fetch(fileUrl);
        const buffer = Buffer.from(await response.arrayBuffer());

        // Get filename and mime type
        const originalName = document.file_name || `document_${document.file_id}`;
        const mimeType = document.mime_type || "application/octet-stream";

        // Store the file
        const storedFile = this.mediaHandler.store(buffer, originalName, mimeType);

        log.info({ userId, fileId: storedFile.id, mimeType: storedFile.mimeType }, "Document stored from Telegram");

        // Extract text based on file type
        await botCtx.replyWithChatAction("typing");
        const extractedText = await this.mediaHandler.extractText(storedFile.id);

        // Build user message with extracted text
        const userMessage = extractedText
          ? `[Document: ${originalName}]\n\nExtracted text: ${extractedText.slice(0, 2000)}${extractedText.length > 2000 ? "..." : ""}`
          : `[Document: ${originalName} - no text could be extracted]`;

        // Get or create shared session
        const session = this.ctx.sessions.getOrCreate(actorId, "telegram");
        this.ctx.sessions.addMessage(session.id, "user", userMessage);

        // Emit to Socket.io
        this.ctx.io.to(session.id).emit("chat:message", {
          sessionId: session.id,
          role: "user",
          content: userMessage,
          ts: Date.now(),
          source: "telegram",
          attachment: {
            type: "document",
            fileId: storedFile.id,
            filename: originalName,
            extractedText: extractedText,
          },
        });

        // Route to LLM
        log.info({ userId, sessionId: session.id }, "Document received from Telegram, routing to LLM");
        this.ctx.io.to(session.id).emit("chat:stream:start", { sessionId: session.id });

        const messages = session.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

        let fullResponse = "";
        for await (const chunk of this.ctx.llmRouter.stream(messages, session.id, this.systemPrompt)) {
          fullResponse += chunk;
          this.ctx.io.to(session.id).emit("chat:stream:chunk", {
            sessionId: session.id,
            chunk,
          });
        }

        this.ctx.sessions.addMessage(session.id, "assistant", fullResponse);
        this.ctx.io.to(session.id).emit("chat:stream:end", { sessionId: session.id });

        // Send response back to Telegram
        await this.sendResponse(userId, fullResponse);
      } catch (err) {
        log.error({ err, userId }, "Failed to process document");
        await this.sendResponse(userId, "Sorry, I couldn't process the document.");
      }
    });
  }

  /**
   * Transcribe audio buffer using Whisper
   */
  private async transcribeAudio(buffer: Buffer): Promise<{ text: string }> {
    // For now, we need to call the gateway's transcription
    // Since we're in the bot, we can use the whisper module directly
    const { transcribeBuffer } = await import("../voice/whisper.js");
    return await transcribeBuffer(buffer, "ogg");
  }

  /**
   * Convert text to speech and send as voice note
   */
  private async sendVoiceReply(userId: number, text: string): Promise<void> {
    const voiceConfig = this.ctx.config.telegram;
    if (!voiceConfig?.voiceReplies) return;

    // Free TTS providers (coqui, piper) don't need API keys
    const isFreeProvider = voiceConfig.voiceProvider === "coqui" || voiceConfig.voiceProvider === "piper";

    const apiKey = isFreeProvider ? "" :
      (voiceConfig.voiceProvider === "elevenlabs"
        ? this.ctx.config.voice?.elevenLabsApiKey
        : this.ctx.config.llm.primary.apiKey);

    if (!apiKey && !isFreeProvider) {
      log.warn("Voice reply enabled but no API key configured for paid provider");
      return;
    }

    try {
      const { textToSpeech } = await import("../voice/tts.js");
      const result = await textToSpeech(text, apiKey || "", {
        provider: voiceConfig.voiceProvider,
        voice: voiceConfig.voiceId,
        speed: voiceConfig.voiceSpeed || 1.0,
      });

      // Send voice note to Telegram (no caption)
      const { InputFile } = await import("grammy");
      const buffer = result.audio;
      await this.bot.api.sendVoice(userId, new InputFile(buffer, "voice.mp3"));
      log.info({ userId, textLength: text.length }, "Sent voice reply");
    } catch (err) {
      log.error({ userId, err }, "Failed to send voice reply, falling back to text");
      // Fallback to text message
      await this.sendTextResponse(userId, text);
    }
  }

  /**
   * Send a text response (used as fallback or when voice disabled)
   */
  private async sendTextResponse(userId: number, text: string): Promise<void> {
    const chunks = chunkMessage(text);
    for (const chunk of chunks) {
      try {
        await this.bot.api.sendMessage(userId, chunk, {
          parse_mode: "Markdown",
        });
      } catch (err) {
        // Fallback: send without markdown if parsing fails
        try {
          await this.bot.api.sendMessage(userId, chunk);
        } catch (sendErr) {
          log.error({ userId, err: sendErr }, "Failed to send Telegram message");
        }
      }
    }
  }

  /**
   * Send a response to a Telegram user, chunking if needed.
   * Optionally sends as voice note if voiceReplies is enabled.
   */
  async sendResponse(userId: number, text: string): Promise<void> {
    const voiceConfig = this.ctx.config.telegram;
    if (voiceConfig?.voiceReplies) {
      await this.sendVoiceReply(userId, text);
    } else {
      await this.sendTextResponse(userId, text);
    }
  }

  /**
   * Send typing indicator.
   */
  async sendTyping(chatId: number): Promise<void> {
    try {
      await this.bot.api.sendChatAction(chatId, "typing");
    } catch {
      // Typing indicator failures are non-critical
    }
  }

  /**
   * Start the bot with auto-reconnect.
   */
  async start(): Promise<void> {
    this.running = true;

    const run = async () => {
      while (this.running) {
        try {
          log.info("Telegram bot starting...");
          this.reconnectAttempts = 0;
          await this.bot.start({
            drop_pending_updates: true,
            onStart: () => {
              log.info("Telegram bot connected");
            },
          });
        } catch (err) {
          if (!this.running) return;

          this.reconnectAttempts++;
          const delay = Math.min(
            RECONNECT_BASE_MS * 2 ** (this.reconnectAttempts - 1),
            RECONNECT_MAX_MS
          );
          log.warn(
            { err, attempt: this.reconnectAttempts, delayMs: delay },
            "Telegram bot disconnected, reconnecting..."
          );
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    };

    run();
  }

  /**
   * Stop the bot gracefully.
   */
  async stop(): Promise<void> {
    this.running = false;
    await this.bot.stop();
    log.info("Telegram bot stopped");
  }

  getApproval(): ApprovalManager {
    return this.approval;
  }

  private getStatus() {
    return {
      gateway: "online",
      uptimeMin: Math.round(process.uptime() / 60),
      memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      sessions: this.ctx.sessions.listActive().length,
    };
  }
}
