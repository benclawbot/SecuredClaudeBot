import { Bot, type Context } from "grammy";
import { createChildLogger } from "../logger/index.js";
import { ApprovalManager } from "./approval.js";
import { chunkMessage } from "./chunker.js";
import { getBotSystemPrompt } from "../bot/context.js";
import { MediaHandler } from "../media/handler.js";
import type { GatewayContext } from "../index.js";

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
    this.bot = new Bot(ctx.config.telegram.botToken);
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
          `/models - List available LLM models`,
        { parse_mode: "Markdown" }
      );
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
      const content = botCtx.message.text;
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

      try {
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
   * Also handles media attachments (photos, documents, stickers) embedded in the response.
   */
  async sendResponse(userId: number, text: string): Promise<void> {
    // Extract and send any media mentioned in the response
    await this.sendMediaFromResponse(userId, text);

    // Clean up media markers from text before sending
    const cleanText = this.cleanMediaMarkers(text);

    const voiceConfig = this.ctx.config.telegram;
    if (voiceConfig?.voiceReplies) {
      await this.sendVoiceReply(userId, cleanText);
    } else {
      await this.sendTextResponse(userId, cleanText);
    }
  }

  /**
   * Parse media markers from LLM response and send corresponding media.
   * Supported markers:
   * - [photo:filename] or [photo:search term] - send a photo
   * - [document:filename] or [document:search term] - send a document
   * - [sticker:emoji] - send a sticker (emoji)
   */
  private async sendMediaFromResponse(userId: number, text: string): Promise<void> {
    // Extract photo references: [photo:filename]
    const photoRegex = /\[photo:([^\]]+)\]/gi;
    const photos = [...text.matchAll(photoRegex)];
    for (const match of photos) {
      const searchTerm = match[1].trim();
      await this.sendPhotoFromLibrary(userId, searchTerm);
    }

    // Extract document references: [document:filename]
    const docRegex = /\[document:([^\]]+)\]/gi;
    const docs = [...text.matchAll(docRegex)];
    for (const match of docs) {
      const searchTerm = match[1].trim();
      await this.sendDocumentFromLibrary(userId, searchTerm);
    }

    // Extract sticker/emoji references: [sticker:emoji]
    const stickerRegex = /\[sticker:([^\]]+)\]/gi;
    const stickers = [...text.matchAll(stickerRegex)];
    for (const match of stickers) {
      const emoji = match[1].trim();
      await this.sendSticker(userId, emoji);
    }
  }

  /**
   * Remove media markers from text response
   */
  private cleanMediaMarkers(text: string): string {
    return text
      .replace(/\[photo:[^\]]+\]/gi, "")
      .replace(/\[document:[^\]]+\]/gi, "")
      .replace(/\[sticker:[^\]]+\]/gi, "")
      .replace(/\n{3,}/g, "\n\n")  // Clean up multiple newlines
      .trim();
  }

  /**
   * Search media library for a photo and send it
   */
  private async sendPhotoFromLibrary(userId: number, searchTerm: string): Promise<void> {
    try {
      // Search for image files
      const files = this.mediaHandler.search(searchTerm);
      const imageFile = files.find(f => f.mimeType.startsWith("image/"));

      if (imageFile) {
        const fileData = this.mediaHandler.get(imageFile.id);
        if (fileData) {
          const { InputFile } = await import("grammy");
          await this.bot.api.sendPhoto(userId, new InputFile(fileData.data, imageFile.originalName));
          log.info({ userId, fileId: imageFile.id }, "Sent photo from media library");
          return;
        }
      }

      // If no file found, try sending as URL (for external images)
      if (searchTerm.startsWith("http")) {
        await this.bot.api.sendPhoto(userId, searchTerm);
        log.info({ userId, url: searchTerm }, "Sent photo from URL");
      }
    } catch (err) {
      log.error({ userId, searchTerm, err }, "Failed to send photo");
    }
  }

  /**
   * Search media library for a document and send it
   */
  private async sendDocumentFromLibrary(userId: number, searchTerm: string): Promise<void> {
    try {
      const files = this.mediaHandler.search(searchTerm);
      // Find a non-image file (document)
      const docFile = files.find(f => !f.mimeType.startsWith("image/"));

      if (docFile) {
        const fileData = this.mediaHandler.get(docFile.id);
        if (fileData) {
          const { InputFile } = await import("grammy");
          await this.bot.api.sendDocument(userId, new InputFile(fileData.data, docFile.originalName));
          log.info({ userId, fileId: docFile.id }, "Sent document from media library");
          return;
        }
      }

      // If no file found, try sending as URL
      if (searchTerm.startsWith("http")) {
        await this.bot.api.sendDocument(userId, searchTerm);
        log.info({ userId, url: searchTerm }, "Sent document from URL");
      }
    } catch (err) {
      log.error({ userId, searchTerm, err }, "Failed to send document");
    }
  }

  /**
   * Send a sticker (emoji) to the user
   */
  private async sendSticker(userId: number, emoji: string): Promise<void> {
    try {
      // Convert emoji to sticker using Telegram's emoji_to_sticker API
      // This requires a valid emoji character
      await this.bot.api.sendSticker(userId, emoji);
      log.info({ userId, emoji }, "Sent sticker/emoji");
    } catch (err) {
      // Fallback: try sending as regular message with emoji
      try {
        await this.bot.api.sendMessage(userId, emoji);
      } catch (sendErr) {
        log.error({ userId, emoji, err: sendErr }, "Failed to send sticker");
      }
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
