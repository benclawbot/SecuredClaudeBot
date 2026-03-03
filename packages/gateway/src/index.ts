import { createServer } from "node:http";
import { mkdirSync, existsSync } from "node:fs";
import { Server as SocketServer } from "socket.io";
import { loadConfig, saveConfig } from "./config/loader.js";
import { DATA_DIR } from "./config/defaults.js";
import { createChildLogger } from "./logger/index.js";
import { SQLiteDB } from "./memory/sqlite.js";
import { SessionManager } from "./session/manager.js";
import { KeyStore } from "./crypto/keystore.js";
import { AuditLog } from "./logger/audit.js";
import { RateLimiter } from "./security/rate-limiter.js";
import { LlmRouter } from "./llm/router.js";
import { TelegramBot } from "./telegram/bot.js";
import type { AppConfig } from "./config/schema.js";

const log = createChildLogger("gateway");

export interface GatewayContext {
  config: AppConfig;
  io: SocketServer;
  sessions: SessionManager;
  keyStore: KeyStore;
  audit: AuditLog;
  rateLimiter: RateLimiter;
  dashboardRateLimiter: RateLimiter;
  llmRouter: LlmRouter;
  db: SQLiteDB;
  telegram: TelegramBot | null;
}

async function main() {
  log.info("SecureClaudebot gateway starting...");

  // Ensure data directory exists
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  // Load config
  const config = loadConfig();

  // Initialize SQLite (pure JS/WASM, no native deps)
  const db = new SQLiteDB(config.memory.dbPath);
  await db.init();

  // Initialize core services
  const sessions = new SessionManager();
  const keyStore = new KeyStore(db, config.security.pin ?? "default-pin");
  const audit = new AuditLog(db);
  const rateLimiter = new RateLimiter(config.telegram.rateLimit);
  const dashboardRateLimiter = new RateLimiter(
    config.security.dashboardRateLimit
  );
  const llmRouter = new LlmRouter(config.llm);

  // Create HTTP + Socket.io server
  const httpServer = createServer();
  const io = new SocketServer(httpServer, {
    cors: {
      origin: [
        `http://${config.server.host}:${config.server.dashboardPort}`,
        `http://localhost:${config.server.dashboardPort}`,
        `http://127.0.0.1:${config.server.dashboardPort}`,
      ],
      methods: ["GET", "POST"],
    },
    pingInterval: 25_000,
    pingTimeout: 10_000,
  });

  const ctx: GatewayContext = {
    config,
    io,
    sessions,
    keyStore,
    audit,
    rateLimiter,
    dashboardRateLimiter,
    llmRouter,
    db,
    telegram: null,
  };

  // Initialize Telegram bot if token is configured
  let telegramBot: TelegramBot | null = null;
  if (config.telegram.botToken) {
    telegramBot = new TelegramBot(ctx);
    ctx.telegram = telegramBot;
    telegramBot.start().catch((err) => {
      log.error({ err }, "Failed to start Telegram bot");
    });
  } else {
    log.info("Telegram bot token not configured, skipping Telegram bot initialization");
  }

  // Socket.io connection handler
  io.on("connection", (socket) => {
    log.info({ socketId: socket.id }, "Client connected");

    // ── Chat ──
    socket.on("chat:message", async (data: { actorId: string; content: string }) => {
      // Rate limit check
      if (!dashboardRateLimiter.consume(data.actorId)) {
        socket.emit("chat:error", { error: "Rate limited. Try again shortly." });
        audit.log({
          event: "security.rate_limited",
          actor: data.actorId,
          detail: "Dashboard rate limit exceeded",
        });
        return;
      }

      // Debounce check
      if (sessions.isDuplicate(data.actorId, data.content)) {
        return;
      }

      const session = sessions.getOrCreate(data.actorId, "web");
      sessions.addMessage(session.id, "user", data.content);

      // Emit user message to all clients watching this session
      io.to(session.id).emit("chat:message", {
        sessionId: session.id,
        role: "user",
        content: data.content,
        ts: Date.now(),
      });

      // Route to LLM for response generation (streaming)
      try {
        const messages = session.messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));

        io.to(session.id).emit("chat:stream:start", { sessionId: session.id });

        let fullResponse = "";
        for await (const chunk of llmRouter.stream(messages, session.id)) {
          fullResponse += chunk;
          io.to(session.id).emit("chat:stream:chunk", {
            sessionId: session.id,
            chunk,
          });
        }

        sessions.addMessage(session.id, "assistant", fullResponse);
        io.to(session.id).emit("chat:stream:end", { sessionId: session.id });

        log.info(
          { sessionId: session.id, responseLen: fullResponse.length },
          "LLM response streamed"
        );
      } catch (err) {
        log.error({ err, sessionId: session.id }, "LLM generation failed");
        socket.emit("chat:error", {
          error: "Failed to generate response. Check LLM configuration.",
        });
        io.to(session.id).emit("chat:stream:end", { sessionId: session.id });
      }
    });

    // ── Session ──
    socket.on("session:join", (data: { actorId: string }) => {
      const session = sessions.getOrCreate(data.actorId, "web");
      socket.join(session.id);
      socket.emit("session:joined", {
        sessionId: session.id,
        messages: session.messages,
      });
    });

    // ── Status ──
    socket.on("status:request", () => {
      socket.emit("status:update", getSystemStatus(ctx));
    });

    // ── Audit Log ──
    socket.on("audit:request", (data: { limit?: number }) => {
      const entries = audit.query({
        limit: data?.limit ?? 50,
      });
      socket.emit("audit:entries", entries);
    });

    // ── Usage ──
    socket.on("usage:request", () => {
      const tracker = llmRouter.getUsage();
      socket.emit("usage:data", {
        totals: tracker.totals(),
        byProvider: tracker.byProvider(),
        records: tracker.allRecords(),
      });
    });

    // ── Settings ──
    socket.on(
      "settings:update",
      async (data: { section: string; data: Record<string, unknown> }) => {
        log.info({ section: data.section }, "Settings update requested");

        if (data.section === "llm" && data.data.primary) {
          const primary = data.data.primary as Record<string, unknown>;
          const llmConfig = {
            provider: primary.provider as "anthropic" | "openai" | "google" | "mistral" | "cohere" | "deepseek" | "groq" | "ollama" | "minimax" | "custom",
            model: primary.model as string,
            apiKey: primary.apiKey as string | undefined,
            baseUrl: primary.baseUrl as string | undefined,
          };

          // Validate config before applying
          const validation = await llmRouter.validateConfig(llmConfig);

          if (!validation.valid) {
            log.warn({ error: validation.error, hint: validation.hint }, "LLM config validation failed");
            socket.emit("settings:saved", {
              section: data.section,
              success: false,
              error: validation.error,
              hint: validation.hint,
            });
            return;
          }

          // Apply config
          llmRouter.updatePrimary(llmConfig);

          // Persist to config file
          ctx.config.llm.primary = llmConfig;
          saveConfig(ctx.config);

          log.info({ provider: llmConfig.provider, model: llmConfig.model }, "LLM config validated and applied");
        }

        if (data.section === "telegram" && data.data) {
          const telegramData = data.data as Record<string, unknown>;

          // Update config
          if (telegramData.botToken) {
            ctx.config.telegram.botToken = telegramData.botToken as string;
          }
          if (telegramData.approvedUsers) {
            ctx.config.telegram.approvedUsers = telegramData.approvedUsers as number[];
          }

          // Persist to config file
          saveConfig(ctx.config);

          log.info("Telegram config updated - restart gateway to apply");
        }

        audit.log({
          event: "config.changed",
          actor: socket.id,
          detail: `Settings section "${data.section}" updated via dashboard`,
        });
        socket.emit("settings:saved", { section: data.section, success: true });
      }
    );

    socket.on(
      "settings:change-pin",
      (data: { currentPin: string; newPin: string }) => {
        log.info("PIN change requested via dashboard");
        audit.log({
          event: "auth.login",
          actor: socket.id,
          detail: "PIN change attempted via dashboard",
        });
        socket.emit("settings:pin-changed", { success: true });
      }
    );

    // ── Session Management ──
    socket.on("sessions:clear-all", () => {
      log.warn({ socketId: socket.id }, "Clearing all sessions");
      audit.log({
        event: "session.reaped",
        actor: socket.id,
        detail: "All sessions cleared via dashboard",
      });
      // Clear active sessions
      for (const s of sessions.listActive()) {
        sessions.destroy(s.id);
      }
      socket.emit("sessions:cleared");
    });

    // ── Gateway Control ──
    socket.on("gateway:restart", () => {
      log.warn({ socketId: socket.id }, "Gateway restart requested via dashboard");
      audit.log({
        event: "config.changed",
        actor: socket.id,
        detail: "Gateway restart requested via dashboard",
      });
      socket.emit("gateway:restart-acknowledged");

      // Gracefully shutdown after a short delay (PM2 will auto-restart)
      setTimeout(() => {
        log.warn("Gateway restarting...");
        process.exit(0);
      }, 1000);
    });

    socket.on("gateway:stop", () => {
      log.warn({ socketId: socket.id }, "Gateway stop requested via dashboard");
      audit.log({
        event: "config.changed",
        actor: socket.id,
        detail: "Gateway stop requested via dashboard (no restart)",
      });
      socket.emit("gateway:stop-acknowledged");

      // Gracefully shutdown and tell PM2 not to restart
      setTimeout(async () => {
        log.warn("Gateway stopping (no auto-restart)...");
        const { execSync } = await import("node:child_process");
        try {
          execSync("npx pm2 delete gateway", { stdio: "ignore" });
        } catch {
          // Ignore errors
        }
        process.exit(0);
      }, 1000);
    });

    socket.on("disconnect", () => {
      log.debug({ socketId: socket.id }, "Client disconnected");
    });
  });

  // Start listening
  const { port, host } = config.server;

  // Simple HTTP endpoint for dashboard to discover gateway port
  httpServer.on("request", (req, res) => {
    if (req.url === "/.gateway-port" || req.url === "/api/port") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ port, host }));
    }
  });

  httpServer.listen(port, host, () => {
    log.info({ host, port }, "Gateway listening");
    audit.log({
      event: "session.created",
      actor: "system",
      detail: `Gateway started on ${host}:${port}`,
    });
  });

  // Graceful shutdown
  const shutdown = async () => {
    log.info("Shutting down...");
    sessions.shutdown();
    rateLimiter.shutdown();
    dashboardRateLimiter.shutdown();
    if (telegramBot) {
      await telegramBot.stop();
    }
    io.close();
    httpServer.close();
    db.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function getSystemStatus(ctx: GatewayContext) {
  return {
    gateway: "online",
    sessions: ctx.sessions.listActive().length,
    uptime: process.uptime(),
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    // Will be extended with Telegram, LLM, Playwright statuses
    subsystems: {
      telegram: "pending",
      llm: "pending",
      playwright: "pending",
      tailscale: "unknown",
    },
  };
}

main().catch((err) => {
  log.fatal({ err }, "Gateway failed to start");
  process.exit(1);
});
