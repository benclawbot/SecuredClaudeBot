import { Bot, type Context } from "grammy";
import { sendToAgent } from "../claude/agent.js";
import { cancelSession, isCancelled, uncancelSession } from "../claude/request-queue.js";
import { getSession, clearSession } from "../claude/session-manager.js";
import { createChildLogger } from "../logger/index.js";

const log = createChildLogger("claudegram");

export class ClaudegramBot {
  private bot: Bot;
  private running = false;

  constructor(private botToken: string) {
    this.bot = new Bot(botToken);
    this.setupHandlers();
    this.registerCommands();
  }

  private async registerCommands(): Promise<void> {
    try {
      await this.bot.api.setMyCommands([
        { command: "start", description: "Welcome message" },
        { command: "project", description: "Set working directory" },
        { command: "newproject", description: "Create new project" },
        { command: "clear", description: "Clear conversation" },
        { command: "status", description: "Current session info" },
        { command: "sessions", description: "List saved sessions" },
        { command: "resume", description: "Resume session" },
        { command: "continue", description: "Continue last session" },
        { command: "teleport", description: "Move to terminal" },
        { command: "plan", description: "Plan mode" },
        { command: "explore", description: "Explore codebase" },
        { command: "loop", description: "Run iteratively" },
        { command: "model", description: "Switch model" },
        { command: "mode", description: "Toggle mode" },
        { command: "cancel", description: "Cancel request" },
        { command: "commands", description: "Show commands" },
      ]);
      log.info("Claudegram commands registered");
    } catch (err) {
      log.warn({ err }, "Failed to register commands");
    }
  }

  private setupHandlers(): void {
    // Start command
    this.bot.command("start", async (ctx) => {
      await ctx.reply(
        "Welcome to FastBot! 🤖\n\n" +
        "I'm powered by Claude Code and can help you with:\n" +
        "- Building apps and writing code\n" +
        "- Exploring your codebase\n" +
        "- Running commands\n" +
        "- And much more!\n\n" +
        "Type /help for all commands."
      );
    });

    // Project command
    this.bot.command("project", async (ctx) => {
      const userId = String(ctx.from?.id);
      const session = getSession(userId);
      await ctx.reply(`Current project: ${session.workingDirectory}`);
    });

    // Clear command
    this.bot.command("clear", async (ctx) => {
      const userId = String(ctx.from?.id);
      clearSession(userId);
      await ctx.reply("Conversation cleared.");
    });

    // Cancel command
    this.bot.command("cancel", async (ctx) => {
      const userId = String(ctx.from?.id);
      cancelSession(userId);
      await ctx.reply("Request cancelled.");
    });

    // Model command
    this.bot.command("model", async (ctx) => {
      const args = ctx.message?.text.split(" ");
      if (args && args[1]) {
        const model = args[1].toLowerCase();
        if (["opus", "sonnet", "haiku"].includes(model)) {
          const userId = String(ctx.from?.id);
          const session = getSession(userId);
          (session as any).model = model;
          await ctx.reply(`Model set to: ${model}`);
        } else {
          await ctx.reply("Usage: /model opus|sonnet|haiku");
        }
      } else {
        await ctx.reply("Available models: opus, sonnet, haiku\nUsage: /model <model>");
      }
    });

    // Status command
    this.bot.command("status", async (ctx) => {
      const userId = String(ctx.from?.id);
      const session = getSession(userId);
      await ctx.reply(
        `Session: ${userId}\n` +
        `Project: ${session.workingDirectory}\n` +
        `Messages: ${session.messages.length}\n` +
        `Model: ${(session as any).model || "opus"}`
      );
    });

    // Handle text messages
    this.bot.on("message:text", async (ctx) => {
      const userId = String(ctx.from?.id);
      const text = ctx.message.text;

      // Skip commands
      if (text.startsWith("/")) return;

      // Check if cancelled
      if (isCancelled(userId)) {
        uncancelSession(userId);
        await ctx.reply("Previous request cancelled. Processing...");
      }

      try {
        await ctx.replyWithChatAction("typing");

        const session = getSession(userId);
        const model = (session as any).model || "opus";

        const response = await sendToAgent(userId, text, { model });

        // Send response (chunk if needed)
        if (response.text.length > 4000) {
          const chunks = response.text.match(/.{1,4000}/g) || [];
          for (const chunk of chunks) {
            await ctx.reply(chunk);
          }
        } else {
          await ctx.reply(response.text);
        }
      } catch (error) {
        log.error({ err: error }, "Error processing message");
        await ctx.reply(
          `Error: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    });
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.bot.start();
    log.info("Claudegram bot started");
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.bot.stop();
    log.info("Claudegram bot stopped");
  }
}

export function createClaudegramBot(botToken: string): ClaudegramBot {
  return new ClaudegramBot(botToken);
}
