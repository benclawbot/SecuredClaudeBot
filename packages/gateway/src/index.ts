import dotenv from "dotenv";
// Load .env file from parent directory (gateway is in packages/gateway)
dotenv.config({ path: join("..", "..", ".env") });

import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
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
import { PlaywrightBridge } from "./playwright/bridge.js";
import { TailscaleManager } from "./tailscale/manager.js";
import { AgentsManager } from "./agents/manager.js";
import { RcaScheduler } from "./agents/rca-scheduler.js";
import { SelfImprovementScheduler } from "./agents/self-improvement.js";
import {
  shouldTriggerOrchestration,
  extractOrchestrationRequest,
  triggerOrchestration,
} from "./orchestration/chat-integration.js";
import { QmdStore } from "./qmd/store.js";
import { MediaHandler } from "./media/handler.js";
import { transcribeBuffer } from "./voice/whisper.js";
import { textToSpeech } from "./voice/tts.js";
import { getBotSystemPrompt } from "./bot/context.js";
import { verifyToken, generateJwtSecret, issueToken } from "./security/jwt.js";
import * as SkillsManager from "./skills/manager.js";
import { GoogleClient, GoogleSheetsClient, GoogleDriveClient } from "./integrations/google/index.js";
import { MicrosoftClient } from "./integrations/microsoft.js";
import { GitHubClient } from "./integrations/github.js";
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
  playwright: PlaywrightBridge | null;
  tailscale: TailscaleManager | null;
  agents: AgentsManager | null;
  qmd: QmdStore | null;
  media: MediaHandler | null;
}

async function main() {
  log.info("FastBot gateway starting...");

  // Ensure data directory exists
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  // Load config
  const config = loadConfig();

  // Helper to get public host for OAuth URLs
  const getOAuthHost = (): string => {
    return config.server.publicHost || config.server.host;
  };

  // Check if first-time setup is needed
  const needsOnboarding = !config.llm?.primary?.apiKey || config.llm.primary.apiKey.startsWith("YOUR_");
  if (needsOnboarding) {
    log.warn("API key not configured - running in limited mode");
    console.log("\n⚠️  FastBot needs configuration!\n");
    console.log("Please configure your settings in config.json or run the setup wizard.\n");
    console.log("Required: LLM provider API key (set in config.json)\n");
  }

  // Initialize SQLite (pure JS/WASM, no native deps)
  const db = new SQLiteDB(config.memory.dbPath);
  await db.init();

  // Initialize core services
  const sessions = new SessionManager();
  const keyStore = new KeyStore(db, config.security.jwtSecret ?? "default-key");
  const audit = new AuditLog(db);
  const rateLimiter = new RateLimiter(config.telegram.rateLimit);
  const dashboardRateLimiter = new RateLimiter(
    config.security.dashboardRateLimit
  );
  const llmRouter = new LlmRouter(config.llm);

  // Create HTTP + Socket.io server
  const httpServer = createServer();
  const dashboardPort = config.server.dashboardPort;
  const io = new SocketServer(httpServer, {
    cors: {
      origin: [
        `http://localhost:${dashboardPort}`,
        `http://127.0.0.1:${dashboardPort}`,
        `http://0.0.0.0:${dashboardPort}`,
        `http://${config.server.publicHost}:${dashboardPort}`,
        // Allow any localhost variant
        /^http:\/\/localhost:\d+$/,
        /^http:\/\/127\.0\.0\.1:\d+$/,
        // Allow Tailscale IPs
        /^http:\/\/100\.\d+\.\d+\.\d+:\d+$/,
      ],
      methods: ["GET", "POST"],
      credentials: true,
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
    playwright: null,
    tailscale: null,
    agents: null,
    qmd: null,
    media: null,
  };

  // Load bot identity, role, and memories for system prompt
  const botSystemPrompt = getBotSystemPrompt();

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

  // Initialize Playwright if enabled
  let playwrightBridge: PlaywrightBridge | null = null;
  if (config.playwright?.enabled) {
    playwrightBridge = new PlaywrightBridge(audit, config.playwright.timeoutMs);
    ctx.playwright = playwrightBridge;
    playwrightBridge.start().catch((err) => {
      log.error({ err }, "Failed to start Playwright bridge");
    });
    log.info("Playwright bridge started");
  } else {
    log.info("Playwright not enabled in config");
  }

  // Initialize Tailscale if enabled
  let tailscaleManager: TailscaleManager | null = null;
  if (config.tailscale?.enabled) {
    tailscaleManager = new TailscaleManager(config.tailscale);
    ctx.tailscale = tailscaleManager;
    tailscaleManager.startStatusChecker();
    tailscaleManager.start().then((success) => {
      if (success) {
        log.info("Tailscale connected");
      } else {
        log.warn("Tailscale failed to connect");
      }
    }).catch((err) => {
      log.error({ err }, "Failed to start Tailscale");
    });
  } else {
    log.info("Tailscale not enabled in config");
  }

  // Initialize Agents Manager
  let agentsManager: AgentsManager | null = null;
  let rcaScheduler: RcaScheduler | null = null;
  let selfImprovementScheduler: SelfImprovementScheduler | null = null;
  const projectRoot = process.cwd();

  if (config.agents) {
    agentsManager = new AgentsManager(config.agents);
    await agentsManager.initializeAgents();
    ctx.agents = agentsManager;

    // Initialize QMD (Query Memory Data) store
    ctx.qmd = new QmdStore(db, null, config.agents.directory, join(projectRoot, "data", "codebase-index.json"));
    log.info("QMD store initialized");

    // Auto-index codebase if enabled
    if (config.agents.autoIndexCodebase) {
      await ctx.qmd.indexCodebase(projectRoot);
    }

    // Start RCA scheduler if enabled
    if (config.agents.enableRcaCron) {
      rcaScheduler = new RcaScheduler(agentsManager, config.agents);
      rcaScheduler.start();
    }

    // Start self-improvement scheduler if enabled
    if (config.agents.enableSelfImprovement) {
      selfImprovementScheduler = new SelfImprovementScheduler(agentsManager, ctx.qmd, config.agents, projectRoot);

      // Configure GitHub if auto-push enabled
      if (config.agents.autoPushGithub && config.agents.githubRepo) {
        const githubToken = keyStore.get("oauth_github_token");
        if (githubToken) {
          const [owner, repo] = config.agents.githubRepo.split("/");
          selfImprovementScheduler.configureGithub(owner, repo, githubToken);
          log.info({ repo: config.agents.githubRepo }, "GitHub auto-push configured");
        }
      }

      selfImprovementScheduler.start();
      log.info("Self-improvement scheduler started");
    }
    log.info("Agents manager initialized");
  } else {
    log.info("Agents not configured");
  }

  // Initialize Media Handler
  const mediaHandler = new MediaHandler();
  ctx.media = mediaHandler;

  // JWT secret for authentication
  let jwtSecret = config.security.jwtSecret;
  if (!jwtSecret) {
    jwtSecret = generateJwtSecret();
    config.security.jwtSecret = jwtSecret;
    saveConfig(config);
    log.info("Generated new JWT secret and saved to config");
  }

  // Events that don't require authentication
  const publicEvents = new Set(["auth:login", "setup:check", "setup:complete"]);

  // Socket.io connection handler with JWT authentication
  io.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.query.token as string;

    // Allow unauthenticated connections (for login)
    // But mark them as unauthenticated
    if (!token) {
      (socket as any).authenticated = false;
      (socket as any).user = null;
      return next();
    }

    // Try to verify token - if invalid, still allow connection (will try auto-login)
    try {
      const payload = verifyToken(token, jwtSecret);
      if (payload) {
        // Mark as authenticated and store user info
        (socket as any).authenticated = true;
        (socket as any).user = payload;
        log.info({ socketId: socket.id, actor: payload.sub }, "Socket authenticated");
      } else {
        // Token invalid - allow connection, will retry auth
        (socket as any).authenticated = false;
        (socket as any).user = null;
        log.warn({ socketId: socket.id }, "Socket connected with invalid token, will retry auth");
      }
    } catch {
      // Token verification failed - allow connection, will retry auth
      (socket as any).authenticated = false;
      (socket as any).user = null;
      log.warn({ socketId: socket.id }, "Socket connected with invalid token, will retry auth");
    }
    next();
  });

  // Helper to check if socket is authenticated
  const isAuthenticated = (socket: any): boolean => {
    return socket.authenticated === true;
  };

  io.on("connection", (socket) => {
    const user = (socket as any).user;
    log.info({ socketId: socket.id, actor: user?.sub }, "Client connected");

    // ── Authentication ──
    // JWT-based auth - no PIN required
    socket.on("auth:login", async (_data: unknown, callback?: (response: { token?: string; error?: string }) => void) => {
      // Check if JWT secret is configured
      if (!config.security.jwtSecret) {
        const error = "No JWT secret configured. Complete setup first.";
        if (callback) callback({ error });
        else socket.emit("auth:error", { error });
        return;
      }

      // Issue JWT token
      const token = issueToken("dashboard_user", config.security.jwtSecret, "web");
      (socket as any).authenticated = true;
      (socket as any).user = { sub: "dashboard_user", origin: "web" };

      log.info({ socketId: socket.id }, "User authenticated via JWT");
      audit.log({
        event: "auth.login",
        actor: "dashboard_user",
        detail: "Dashboard login successful",
      });

      // Use callback if provided (Socket.io pattern), otherwise emit event
      if (callback) {
        callback({ token });
      } else {
        socket.emit("auth:success", { token });
      }
    });

    // ── Chat ──
    socket.on("chat:message", async (data: { actorId: string; content: string }) => {
      // Authentication check
      if (!isAuthenticated(socket)) {
        socket.emit("chat:error", { error: "Authentication required" });
        audit.log({
          event: "security.unauthenticated_access",
          actor: data.actorId,
          detail: "Unauthenticated user attempted to send chat message",
        });
        return;
      }

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

      // Check for orchestration trigger
      if (shouldTriggerOrchestration(data.content)) {
        const request = extractOrchestrationRequest(data.content);

        // Acknowledge the orchestration request
        const session = sessions.getOrCreate(data.actorId, "web");
        sessions.addMessage(session.id, "user", data.content);

        io.to(session.id).emit("chat:message", {
          sessionId: session.id,
          role: "user",
          content: data.content,
          ts: Date.now(),
        });

        io.to(session.id).emit("chat:stream:start", { sessionId: session.id });

        const ackMessage = `I'll set up an orchestration workflow for this request. Let me start the process...\n\nYou can track progress at the Kanban board.`;
        io.to(session.id).emit("chat:stream:chunk", { sessionId: session.id, chunk: ackMessage });
        io.to(session.id).emit("chat:stream:end", { sessionId: session.id });

        sessions.addMessage(session.id, "assistant", ackMessage);

        // Trigger orchestration
        const result = await triggerOrchestration(ctx, request, session.id);
        if (result) {
          // Send follow-up message with orchestration status
          const followUp = `\n\n✅ Orchestration started! Request ID: ${result.requestId}\n\nThe agents will work on this. Check the Kanban board to track progress.`;
          io.to(session.id).emit("chat:message", {
            sessionId: session.id,
            role: "assistant",
            content: followUp,
            ts: Date.now(),
          });
          sessions.addMessage(session.id, "assistant", followUp);
        } else {
          const errorMsg = "\n\n⚠️ Orchestration server is not available. Please ensure it's running.";
          io.to(session.id).emit("chat:message", {
            sessionId: session.id,
            role: "assistant",
            content: errorMsg,
            ts: Date.now(),
          });
          sessions.addMessage(session.id, "assistant", errorMsg);
        }

        log.info({ request, sessionId: session.id }, "Orchestration triggered from chat");
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

        // Create abort controller for this request
        const abortController = new AbortController();
        sessions.setAbortController(session.id, abortController);

        let fullResponse = "";
        try {
          for await (const chunk of llmRouter.stream(messages, session.id, botSystemPrompt, abortController.signal)) {
            fullResponse += chunk;
            io.to(session.id).emit("chat:stream:chunk", {
              sessionId: session.id,
              chunk,
            });
          }
        } finally {
          sessions.setAbortController(session.id, null);
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

    // ── Stop / Cancel ──
    socket.on("chat:stop", async (data: { actorId: string }) => {
      // Find session by actorId
      const session = sessions.getByActor(data.actorId);
      if (!session) {
        socket.emit("chat:error", { error: "No active session" });
        return;
      }

      // Abort the current streaming if any
      const aborted = sessions.abortStreaming(session.id);
      if (aborted) {
        io.to(session.id).emit("chat:stream:end", { sessionId: session.id, stopped: true });

        // Ask what should be changed
        const stopMessage = "What should be changed?";
        io.to(session.id).emit("chat:message", {
          sessionId: session.id,
          role: "assistant",
          content: stopMessage,
          ts: Date.now(),
        });
        sessions.addMessage(session.id, "assistant", stopMessage);

        log.info({ sessionId: session.id, actorId: data.actorId }, "Chat stream stopped by user");
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
    socket.on("status:request", async () => {
      socket.emit("status:update", await getSystemStatus(ctx));
    });

    // ── Setup / Onboarding ──
    socket.on("setup:check", async () => {
      // Check if LLM is configured (has model set)
      const isConfigured = !!(config.llm.primary?.model);
      socket.emit("setup:status", { needsSetup: !isConfigured, isConfigured });
    });

    socket.on("setup:complete", async (data: {
      telegramToken?: string;
      llmProvider?: string;
      llmModel?: string;
      llmApiKey?: string;
      baseUrl?: string;
    }) => {
      try {
        // Always generate new JWT secret for fresh setup
        const jwtSecret = generateJwtSecret();
        config.security.jwtSecret = jwtSecret;

        // Handle LLM (optional - can be configured later)
        if (data.llmProvider || data.llmModel || data.llmApiKey) {
          if (!config.llm.primary) {
            (config.llm as any).primary = { provider: "anthropic", model: "" };
          }
          if (data.llmProvider) config.llm.primary.provider = data.llmProvider as any;
          if (data.llmModel) config.llm.primary.model = data.llmModel;
          if (data.llmApiKey) config.llm.primary.apiKey = data.llmApiKey;
          if (data.baseUrl) config.llm.primary.baseUrl = data.baseUrl;
        }

        if (data.telegramToken) config.telegram.botToken = data.telegramToken;

        // Save config
        const { saveConfig } = await import("./config/loader.js");
        saveConfig(config);

        // Issue JWT token to return to dashboard
        const token = issueToken("dashboard_user", jwtSecret, "web");

        log.info({ provider: data.llmProvider, model: data.llmModel }, "Setup completed");
        socket.emit("setup:done", { success: true, token: token, jwtSecret: jwtSecret });
      } catch (err) {
        log.error({ err }, "Setup failed");
        socket.emit("setup:done", { success: false, error: String(err) });
      }
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
    // Request current settings - values from .env are marked as "configured"
    socket.on("settings:request", (data: { section: string }) => {
      if (data.section === "llm") {
        // Check if values exist (from .env or config)
        const hasApiKey = !!(config.llm.primary?.apiKey && !config.llm.primary.apiKey.startsWith("YOUR_"));
        socket.emit("settings:data", {
          section: "llm",
          data: {
            primary: {
              provider: config.llm.primary?.provider || "",
              model: config.llm.primary?.model || "",
              baseUrl: config.llm.primary?.baseUrl || "",
              // Show "configured" if API key exists in .env, empty if not
              apiKey: hasApiKey ? "configured" : "",
            },
          },
        });
      } else if (data.section === "telegram") {
        const hasToken = !!(config.telegram.botToken && !config.telegram.botToken.startsWith("YOUR_"));
        socket.emit("settings:data", {
          section: "telegram",
          data: {
            botToken: hasToken ? "configured" : "",
            approvedUsers: config.telegram.approvedUsers?.join(", ") || "",
          },
        });
      } else if (data.section === "voice") {
        socket.emit("settings:data", {
          section: "voice",
          data: {
            voiceReplies: config.telegram.voiceReplies ?? true,
            voiceProvider: config.telegram.voiceProvider ?? "gtts",
            voiceId: config.telegram.voiceId ?? "en",
            voiceSpeed: config.telegram.voiceSpeed ?? 1.0,
          },
        });
      } else if (data.section === "playwright") {
        socket.emit("settings:data", {
          section: "playwright",
          data: {
            enabled: config.playwright?.enabled ?? false,
            browser: config.playwright?.browser ?? "chromium",
            headless: config.playwright?.headless ?? true,
            timeoutMs: config.playwright?.timeoutMs ?? 30000,
          },
        });
      }
    });

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

          socket.emit("settings:saved", {
            section: "llm",
            success: true,
          });
        }

        if (data.section === "telegram" && data.data) {
          const telegramData = data.data as Record<string, unknown>;
          const botToken = telegramData.botToken as string | undefined;

          // Validate bot token if provided and not empty
          if (botToken && botToken !== "") {
            // Check format (should be like 123456789:ABCdefGHIjklMNOpqrsTUVwxyz)
            // Only validate if it's not the existing placeholder in config
            const existingToken = ctx.config.telegram.botToken || "";
            if (botToken !== existingToken && !botToken.startsWith("YOUR_")) {
              if (!/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) {
                socket.emit("settings:saved", {
                  section: "telegram",
                  success: false,
                  error: "Invalid Telegram bot token format",
                });
                return;
              }
            }
            // Don't save if it's still a placeholder
            if (botToken.startsWith("YOUR_")) {
              socket.emit("settings:saved", {
                section: "telegram",
                success: false,
                error: "Please enter a real Telegram bot token",
              });
              return;
            }
            ctx.config.telegram.botToken = botToken;
          } else {
            // Empty token - clear it
            ctx.config.telegram.botToken = "";
          }

          if (telegramData.approvedUsers) {
            ctx.config.telegram.approvedUsers = telegramData.approvedUsers as number[];
          }

          // Persist to config file
          saveConfig(ctx.config);

          log.info("Telegram config updated - restarting bot");

          // Restart the Telegram bot with new config
          if (telegramBot) {
            telegramBot.stop();
          }
          if (ctx.config.telegram.botToken && ctx.config.telegram.botToken !== "") {
            telegramBot = new TelegramBot(ctx);
            ctx.telegram = telegramBot;
            telegramBot.start().catch((err) => {
              log.error({ err }, "Failed to start Telegram bot");
            });
          } else {
            telegramBot = null;
            ctx.telegram = null;
          }

          socket.emit("settings:saved", {
            section: "telegram",
            success: true,
          });
        }

        if (data.section === "authToken" && data.data) {
          const authData = data.data as Record<string, unknown>;
          const newSecret = authData.jwtSecret as string;

          if (newSecret && newSecret.length >= 16) {
            ctx.config.security.jwtSecret = newSecret;
            saveConfig(ctx.config);
            log.info("Auth token updated");
            socket.emit("settings:saved", {
              section: "authToken",
              success: true,
            });
          } else {
            socket.emit("settings:saved", {
              section: "authToken",
              success: false,
              error: "Auth token must be at least 16 characters",
            });
          }
          return;
        }

        if (data.section === "playwright" && data.data) {
          const playwrightData = data.data as Record<string, unknown>;

          if (typeof playwrightData.enabled === "boolean") {
            if (!ctx.config.playwright) {
              ctx.config.playwright = { enabled: false, browser: "chromium", headless: true, timeoutMs: 30000 };
            }
            ctx.config.playwright.enabled = playwrightData.enabled;
            saveConfig(ctx.config);
            log.info({ enabled: playwrightData.enabled }, "Playwright config updated");
          }
        }

        if (data.section === "tailscale" && data.data) {
          const tailscaleData = data.data as Record<string, unknown>;

          if (tailscaleData.authKey) {
            if (!ctx.config.tailscale) {
              ctx.config.tailscale = { enabled: false, args: [], advertiseExitNode: false };
            }
            ctx.config.tailscale.authKey = tailscaleData.authKey as string;
            saveConfig(ctx.config);
            log.info("Tailscale auth key updated");
          }
        }

        audit.log({
          event: "config.changed",
          actor: socket.id,
          detail: `Settings section "${data.section}" updated via dashboard`,
        });
        socket.emit("settings:saved", { section: data.section, success: true });
      }
    );

    // ── OAuth Integrations ──
    // Request OAuth connection status
    socket.on("oauth:status", () => {
      const status = {
        google: keyStore.has("oauth_google_refresh_token"),
        microsoft: keyStore.has("oauth_microsoft_refresh_token"),
        github: keyStore.has("oauth_github_token"),
      };
      socket.emit("oauth:status", status);
    });

    // Start Google OAuth flow
    socket.on("oauth:google:start", async (data?: { origin?: string }) => {
      const googleConfig = config.google;
      if (!googleConfig?.clientId || !googleConfig?.clientSecret) {
        socket.emit("oauth:error", { provider: "google", error: "Google OAuth not configured" });
        return;
      }

      try {
        // Use client-provided origin if available, otherwise fall back to publicHost
        const baseUrl = data?.origin || `http://${getOAuthHost()}:${config.server.dashboardPort}`;
        const redirectUri = `${baseUrl}/oauth/google/callback`;
        const client = new GoogleClient(googleConfig.clientId, googleConfig.clientSecret, redirectUri);
        const authUrl = client.getAuthUrl(redirectUri);
        socket.emit("oauth:google:url", { url: authUrl, redirectUri });
        log.info({ redirectUri }, "Google OAuth flow initiated");
      } catch (err) {
        log.error({ err }, "Failed to generate Google auth URL");
        socket.emit("oauth:error", { provider: "google", error: "Failed to initiate OAuth flow" });
      }
    });

    // Handle Google OAuth callback
    socket.on("oauth:google:callback", async (data: { code: string; redirectUri?: string }) => {
      const googleConfig = config.google;
      if (!googleConfig?.clientId || !googleConfig?.clientSecret) {
        socket.emit("oauth:error", { provider: "google", error: "Google OAuth not configured" });
        return;
      }

      try {
        const redirectUri = data.redirectUri || `http://${getOAuthHost()}:${config.server.dashboardPort}/oauth/google/callback`;
        const client = new GoogleClient(googleConfig.clientId, googleConfig.clientSecret, redirectUri);
        const refreshToken = await client.exchangeCode(data.code);

        if (refreshToken) {
          // Store refresh token encrypted
          keyStore.set("oauth_google_refresh_token", refreshToken);
          audit.log({
            event: "oauth.connected",
            actor: "google",
            detail: "Google OAuth connected via dashboard",
          });

          // Auto-authenticate the socket after OAuth success
          let token: string | undefined;
          if (config.security.jwtSecret) {
            token = issueToken("dashboard_user", config.security.jwtSecret, "web");
            (socket as any).authenticated = true;
            (socket as any).user = { sub: "dashboard_user", origin: "web" };
          }

          socket.emit("oauth:connected", { provider: "google", success: true, token });
          log.info("Google OAuth connected successfully");
        }
      } catch (err) {
        log.error({ err }, "Google OAuth callback failed");
        socket.emit("oauth:error", { provider: "google", error: "Failed to complete OAuth flow" });
      }
    });

    // Disconnect Google
    socket.on("oauth:google:disconnect", () => {
      keyStore.delete("oauth_google_refresh_token");
      audit.log({
        event: "oauth.disconnected",
        actor: "google",
        detail: "Google OAuth disconnected via dashboard",
      });
      socket.emit("oauth:disconnected", { provider: "google" });
      log.info("Google OAuth disconnected");
    });

    // Google Sheets handlers
    socket.on("sheets:list", async (data, callback) => {
      try {
        const refreshToken = keyStore.get("oauth_google_refresh_token");
        if (!refreshToken) {
          callback({ error: "Google not connected" });
          return;
        }
        const googleConfig = config.google;
        if (!googleConfig?.clientId || !googleConfig?.clientSecret) {
          callback({ error: "Google not configured" });
          return;
        }
        const client = new GoogleClient(googleConfig.clientId, googleConfig.clientSecret, undefined, refreshToken);
        const sheetsClient = new GoogleSheetsClient(client.getAuth());
        const spreadsheets = await sheetsClient.listSpreadsheets();
        callback({ data: spreadsheets });
      } catch (err) {
        log.error({ err }, "Failed to list spreadsheets");
        callback({ error: "Failed to list spreadsheets" });
      }
    });

    socket.on("sheets:read", async (data, callback) => {
      try {
        const refreshToken = keyStore.get("oauth_google_refresh_token");
        if (!refreshToken) {
          callback({ error: "Google not connected" });
          return;
        }
        const googleConfig = config.google;
        if (!googleConfig?.clientId || !googleConfig?.clientSecret) {
          callback({ error: "Google not configured" });
          return;
        }
        const client = new GoogleClient(googleConfig.clientId, googleConfig.clientSecret, undefined, refreshToken);
        const sheetsClient = new GoogleSheetsClient(client.getAuth());
        const result = await sheetsClient.readRange(data.spreadsheetId, data.range);
        callback({ data: result });
      } catch (err) {
        log.error({ err }, "Failed to read sheet");
        callback({ error: "Failed to read sheet" });
      }
    });

    socket.on("sheets:write", async (data, callback) => {
      try {
        const refreshToken = keyStore.get("oauth_google_refresh_token");
        if (!refreshToken) {
          callback({ error: "Google not connected" });
          return;
        }
        const googleConfig = config.google;
        if (!googleConfig?.clientId || !googleConfig?.clientSecret) {
          callback({ error: "Google not configured" });
          return;
        }
        const client = new GoogleClient(googleConfig.clientId, googleConfig.clientSecret, undefined, refreshToken);
        const sheetsClient = new GoogleSheetsClient(client.getAuth());
        await sheetsClient.writeRange(data.spreadsheetId, data.range, data.values);
        callback({ success: true });
      } catch (err) {
        log.error({ err }, "Failed to write to sheet");
        callback({ error: "Failed to write to sheet" });
      }
    });

    socket.on("sheets:create", async (data, callback) => {
      try {
        const refreshToken = keyStore.get("oauth_google_refresh_token");
        if (!refreshToken) {
          callback({ error: "Google not connected" });
          return;
        }
        const googleConfig = config.google;
        if (!googleConfig?.clientId || !googleConfig?.clientSecret) {
          callback({ error: "Google not configured" });
          return;
        }
        const client = new GoogleClient(googleConfig.clientId, googleConfig.clientSecret, undefined, refreshToken);
        const sheetsClient = new GoogleSheetsClient(client.getAuth());
        const result = await sheetsClient.createSpreadsheet(data.title);
        callback({ data: result });
      } catch (err) {
        log.error({ err }, "Failed to create sheet");
        callback({ error: "Failed to create sheet" });
      }
    });

    // Google Drive handlers
    socket.on("drive:list", async (data, callback) => {
      try {
        const refreshToken = keyStore.get("oauth_google_refresh_token");
        if (!refreshToken) {
          callback({ error: "Google not connected" });
          return;
        }
        const googleConfig = config.google;
        if (!googleConfig?.clientId || !googleConfig?.clientSecret) {
          callback({ error: "Google not configured" });
          return;
        }
        const client = new GoogleClient(googleConfig.clientId, googleConfig.clientSecret, undefined, refreshToken);
        const driveClient = new GoogleDriveClient(client.getAuth());
        const files = await driveClient.listFiles(data?.query, data?.maxResults);
        callback({ data: files });
      } catch (err) {
        log.error({ err }, "Failed to list Drive files");
        callback({ error: "Failed to list Drive files" });
      }
    });

    socket.on("drive:download", async (data, callback) => {
      try {
        const refreshToken = keyStore.get("oauth_google_refresh_token");
        if (!refreshToken) {
          callback({ error: "Google not connected" });
          return;
        }
        const googleConfig = config.google;
        if (!googleConfig?.clientId || !googleConfig?.clientSecret) {
          callback({ error: "Google not configured" });
          return;
        }
        const client = new GoogleClient(googleConfig.clientId, googleConfig.clientSecret, undefined, refreshToken);
        const driveClient = new GoogleDriveClient(client.getAuth());
        const buffer = await driveClient.downloadFile(data.fileId);
        callback({ data: buffer.toString("base64") });
      } catch (err) {
        log.error({ err }, "Failed to download file");
        callback({ error: "Failed to download file" });
      }
    });

    socket.on("drive:upload", async (data, callback) => {
      try {
        const refreshToken = keyStore.get("oauth_google_refresh_token");
        if (!refreshToken) {
          callback({ error: "Google not connected" });
          return;
        }
        const googleConfig = config.google;
        if (!googleConfig?.clientId || !googleConfig?.clientSecret) {
          callback({ error: "Google not configured" });
          return;
        }
        const client = new GoogleClient(googleConfig.clientId, googleConfig.clientSecret, undefined, refreshToken);
        const driveClient = new GoogleDriveClient(client.getAuth());
        const content = Buffer.from(data.content, "base64");
        const result = await driveClient.uploadFile(data.name, data.mimeType, content, data.parentId);
        callback({ data: result });
      } catch (err) {
        log.error({ err }, "Failed to upload file");
        callback({ error: "Failed to upload file" });
      }
    });

    socket.on("drive:createFolder", async (data, callback) => {
      try {
        const refreshToken = keyStore.get("oauth_google_refresh_token");
        if (!refreshToken) {
          callback({ error: "Google not connected" });
          return;
        }
        const googleConfig = config.google;
        if (!googleConfig?.clientId || !googleConfig?.clientSecret) {
          callback({ error: "Google not configured" });
          return;
        }
        const client = new GoogleClient(googleConfig.clientId, googleConfig.clientSecret, undefined, refreshToken);
        const driveClient = new GoogleDriveClient(client.getAuth());
        const result = await driveClient.createFolder(data.name, data.parentId);
        callback({ data: result });
      } catch (err) {
        log.error({ err }, "Failed to create folder");
        callback({ error: "Failed to create folder" });
      }
    });

    socket.on("drive:delete", async (data, callback) => {
      try {
        const refreshToken = keyStore.get("oauth_google_refresh_token");
        if (!refreshToken) {
          callback({ error: "Google not connected" });
          return;
        }
        const googleConfig = config.google;
        if (!googleConfig?.clientId || !googleConfig?.clientSecret) {
          callback({ error: "Google not configured" });
          return;
        }
        const client = new GoogleClient(googleConfig.clientId, googleConfig.clientSecret, undefined, refreshToken);
        const driveClient = new GoogleDriveClient(client.getAuth());
        await driveClient.deleteFile(data.fileId);
        callback({ success: true });
      } catch (err) {
        log.error({ err }, "Failed to delete file");
        callback({ error: "Failed to delete file" });
      }
    });

    // Start Microsoft OAuth flow
    socket.on("oauth:microsoft:start", async (data?: { origin?: string }) => {
      const msConfig = config.microsoft;
      if (!msConfig?.clientId || !msConfig?.clientSecret) {
        socket.emit("oauth:error", { provider: "microsoft", error: "Microsoft OAuth not configured" });
        return;
      }

      try {
        // Use client-provided origin if available, otherwise fall back to publicHost
        const baseUrl = data?.origin || `http://${getOAuthHost()}:${config.server.dashboardPort}`;
        const redirectUri = `${baseUrl}/oauth/microsoft/callback`;
        const client = new MicrosoftClient(
          msConfig.clientId,
          msConfig.clientSecret,
          msConfig.tenantId || "common",
          redirectUri
        );
        const state = crypto.randomUUID();
        const authUrl = client.getAuthUrl(state);
        socket.emit("oauth:microsoft:url", { url: authUrl, state, redirectUri });
        log.info({ redirectUri }, "Microsoft OAuth flow initiated");
      } catch (err) {
        log.error({ err }, "Failed to generate Microsoft auth URL");
        socket.emit("oauth:error", { provider: "microsoft", error: "Failed to initiate OAuth flow" });
      }
    });

    // Handle Microsoft OAuth callback
    socket.on("oauth:microsoft:callback", async (data: { code: string; redirectUri?: string }) => {
      const msConfig = config.microsoft;
      if (!msConfig?.clientId || !msConfig?.clientSecret) {
        socket.emit("oauth:error", { provider: "microsoft", error: "Microsoft OAuth not configured" });
        return;
      }

      try {
        const redirectUri = data.redirectUri || `http://${getOAuthHost()}:${config.server.dashboardPort}/oauth/microsoft/callback`;
        const client = new MicrosoftClient(
          msConfig.clientId,
          msConfig.clientSecret,
          msConfig.tenantId || "common",
          redirectUri
        );
        const tokens = await client.exchangeCode(data.code);

        if (tokens.refreshToken) {
          // Store refresh token encrypted
          keyStore.set("oauth_microsoft_refresh_token", tokens.refreshToken);
          audit.log({
            event: "oauth.connected",
            actor: "microsoft",
            detail: "Microsoft OAuth connected via dashboard",
          });

          // Auto-authenticate the socket after OAuth success
          let token: string | undefined;
          if (config.security.jwtSecret) {
            token = issueToken("dashboard_user", config.security.jwtSecret, "web");
            (socket as any).authenticated = true;
            (socket as any).user = { sub: "dashboard_user", origin: "web" };
          }

          socket.emit("oauth:connected", { provider: "microsoft", success: true, token });
          log.info("Microsoft OAuth connected successfully");
        }
      } catch (err) {
        log.error({ err }, "Microsoft OAuth callback failed");
        socket.emit("oauth:error", { provider: "microsoft", error: "Failed to complete OAuth flow" });
      }
    });

    // Disconnect Microsoft
    socket.on("oauth:microsoft:disconnect", () => {
      keyStore.delete("oauth_microsoft_refresh_token");
      audit.log({
        event: "oauth.disconnected",
        actor: "microsoft",
        detail: "Microsoft OAuth disconnected via dashboard",
      });
      socket.emit("oauth:disconnected", { provider: "microsoft" });
      log.info("Microsoft OAuth disconnected");
    });

    // Start GitHub OAuth flow
    socket.on("oauth:github:start", async (data?: { origin?: string }) => {
      const githubConfig = config.github;
      if (!githubConfig?.clientId || !githubConfig?.clientSecret) {
        socket.emit("oauth:error", { provider: "github", error: "GitHub OAuth not configured" });
        return;
      }

      try {
        // Use client-provided origin if available, otherwise fall back to publicHost
        const baseUrl = data?.origin || `http://${getOAuthHost()}:${config.server.dashboardPort}`;
        const redirectUri = `${baseUrl}/oauth/github/callback`;
        const scopes = githubConfig.scopes?.join(" ") || "read:user repo gist";
        const authUrl = `https://github.com/login/oauth/authorize?client_id=${githubConfig.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}`;
        socket.emit("oauth:github:url", { url: authUrl, redirectUri });
        log.info({ redirectUri }, "GitHub OAuth flow initiated");
      } catch (err) {
        log.error({ err }, "Failed to generate GitHub auth URL");
        socket.emit("oauth:error", { provider: "github", error: "Failed to initiate OAuth flow" });
      }
    });

    // Handle GitHub OAuth callback
    socket.on("oauth:github:callback", async (data: { code: string; redirectUri?: string }) => {
      const githubConfig = config.github;
      if (!githubConfig?.clientId || !githubConfig?.clientSecret) {
        socket.emit("oauth:error", { provider: "github", error: "GitHub OAuth not configured" });
        return;
      }

      try {
        // Exchange code for access token via GitHub API
        const params = new URLSearchParams({
          client_id: githubConfig.clientId,
          client_secret: githubConfig.clientSecret,
          code: data.code,
        });

        const response = await fetch(
          `https://github.com/login/oauth/access_token?${params}`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
            },
          }
        );

        if (!response.ok) {
          throw new Error(`GitHub token exchange failed: ${response.status}`);
        }

        const tokenData = (await response.json()) as { access_token?: string };

        if (tokenData.access_token) {
          // Store token encrypted
          keyStore.set("oauth_github_token", tokenData.access_token);
          audit.log({
            event: "oauth.connected",
            actor: "github",
            detail: "GitHub OAuth connected via dashboard",
          });

          // Auto-authenticate the socket after OAuth success
          let token: string | undefined;
          if (config.security.jwtSecret) {
            token = issueToken("dashboard_user", config.security.jwtSecret, "web");
            (socket as any).authenticated = true;
            (socket as any).user = { sub: "dashboard_user", origin: "web" };
          }

          socket.emit("oauth:connected", { provider: "github", success: true, token });
          log.info("GitHub OAuth connected successfully");
        }
      } catch (err) {
        log.error({ err }, "GitHub OAuth callback failed");
        socket.emit("oauth:error", { provider: "github", error: "Failed to complete OAuth flow" });
      }
    });

    // Disconnect GitHub
    socket.on("oauth:github:disconnect", () => {
      keyStore.delete("oauth_github_token");
      audit.log({
        event: "oauth.disconnected",
        actor: "github",
        detail: "GitHub OAuth disconnected via dashboard",
      });
      socket.emit("oauth:disconnected", { provider: "github" });
      log.info("GitHub OAuth disconnected");
    });

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
      if (!isAuthenticated(socket)) {
        socket.emit("error:unauthenticated", { error: "Authentication required" });
        return;
      }
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
      if (!isAuthenticated(socket)) {
        socket.emit("error:unauthenticated", { error: "Authentication required" });
        return;
      }
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

    // ── Playwright ──
    socket.on("playwright:task", async (data: { type: string; url: string; actions?: Array<{ action: string; selector?: string; value?: string }> }) => {
      if (!ctx.playwright) {
        socket.emit("playwright:error", { error: "Playwright not enabled" });
        return;
      }
      try {
        let result: unknown;
        const actorId = socket.id;
        if (data.type === "scrape") {
          result = await ctx.playwright.scrape(data.url, actorId);
        } else if (data.type === "screenshot") {
          result = await ctx.playwright.screenshot(data.url, actorId);
        } else if (data.type === "automate") {
          result = await ctx.playwright.automate(data.url, data.actions || [], actorId);
        } else {
          socket.emit("playwright:error", { error: "Unknown task type" });
          return;
        }
        socket.emit("playwright:result", result);
      } catch (err) {
        socket.emit("playwright:error", { error: String(err) });
      }
    });

    // ── Tailscale ──
    socket.on("tailscale:status", async () => {
      if (!ctx.tailscale) {
        socket.emit("tailscale:status", { enabled: false, connected: false });
        return;
      }
      const status = await ctx.tailscale.getStatus();
      const ip = status.connected ? await ctx.tailscale.getTailscaleIp() : null;
      socket.emit("tailscale:status", { ...status, ip });
    });

    socket.on("tailscale:connect", async () => {
      if (!ctx.tailscale) {
        socket.emit("tailscale:error", { error: "Tailscale not configured" });
        return;
      }
      try {
        const success = await ctx.tailscale.start();
        socket.emit("tailscale:connected", { success });
      } catch (err) {
        socket.emit("tailscale:error", { error: String(err) });
      }
    });

    socket.on("tailscale:disconnect", async () => {
      if (!ctx.tailscale) {
        socket.emit("tailscale:error", { error: "Tailscale not configured" });
        return;
      }
      try {
        await ctx.tailscale.stop();
        socket.emit("tailscale:disconnected", { success: true });
      } catch (err) {
        socket.emit("tailscale:error", { error: String(err) });
      }
    });

    // ── Agents ──
    socket.on("agents:list", () => {
      if (!ctx.agents) {
        socket.emit("agents:list", []);
        return;
      }
      const agents = ctx.agents.listAgents();
      socket.emit("agents:list", agents);
    });

    socket.on("agents:get", (_data: { id: string }) => {
      if (!ctx.agents) {
        socket.emit("agents:data", null);
        return;
      }
      const agent = ctx.agents.getAgent(_data.id);
      if (!agent) {
        socket.emit("agents:data", null);
        return;
      }
      const files = ctx.agents.getAgentFiles(_data.id);
      const fileContents: Record<string, string> = {};
      for (const file of files) {
        const content = ctx.agents.readAgentFile(_data.id, file.name);
        if (content) {
          fileContents[file.name] = content;
        }
      }
      socket.emit("agents:data", { agent, files: fileContents });
    });

    socket.on("agents:create", (_data: { name: string; role: string }) => {
      if (!ctx.agents) {
        socket.emit("agents:error", { error: "Agents not configured" });
        return;
      }
      const agent = ctx.agents.createAgent(_data.name, _data.role);
      socket.emit("agents:created", agent);
    });

    socket.on("agents:update", (_data: { id: string; name?: string; role?: string; status?: string }) => {
      if (!ctx.agents) {
        socket.emit("agents:error", { error: "Agents not configured" });
        return;
      }
      const agent = ctx.agents.updateAgent(_data.id, {
        name: _data.name,
        role: _data.role,
        status: _data.status as "active" | "inactive" | "pending",
      });
      socket.emit("agents:updated", agent);
    });

    socket.on("agents:delete", (_data: { id: string }) => {
      if (!ctx.agents) {
        socket.emit("agents:error", { error: "Agents not configured" });
        return;
      }
      // Prevent deletion of bot agent
      if (ctx.agents.isBotAgent(_data.id)) {
        socket.emit("agents:error", { error: "Cannot delete the main bot agent" });
        return;
      }
      const success = ctx.agents.deleteAgent(_data.id);
      socket.emit("agents:deleted", { success });
    });

    socket.on("agents:update-file", (_data: { agentId: string; filename: string; content: string }) => {
      if (!ctx.agents) {
        socket.emit("agents:error", { error: "Agents not configured" });
        return;
      }
      ctx.agents.writeAgentFile(_data.agentId, _data.filename, _data.content);
      socket.emit("agents:file-updated", { success: true });
    });

    socket.on("agents:get-user-info", () => {
      if (!ctx.agents) {
        socket.emit("agents:user-info", "");
        return;
      }
      const userInfo = ctx.agents.getUserInfo();
      socket.emit("agents:user-info", userInfo);
    });

    socket.on("agents:update-user-info", (_data: { content: string }) => {
      if (!ctx.agents) {
        socket.emit("agents:error", { error: "Agents not configured" });
        return;
      }
      ctx.agents.setUserInfo(_data.content);
      socket.emit("agents:user-info-updated", { success: true });
    });

    socket.on("agents:trigger-rca", () => {
      if (!ctx.agents) {
        socket.emit("agents:error", { error: "Agents not configured" });
        return;
      }
      // Trigger RCA for all agents
      const agents = ctx.agents.listAgents();
      for (const agent of agents) {
        const memories = ctx.agents.readAgentFile(agent.id, "memories.md");
        if (memories && memories.includes("Issue:")) {
          ctx.agents.addLessonLearned(agent.id, "root_cause", "Issue identified in memories");
        }
      }
      socket.emit("agents:rca-triggered", { success: true });
    });

    // Self-improvement scheduler events
    socket.on("self-improvement:status", () => {
      socket.emit("self-improvement:status", {
        enabled: config.agents?.enableSelfImprovement || false,
        times: config.agents?.selfImprovementTimes || ["06:00", "18:00"],
        codebaseIndexed: ctx.qmd?.isCodebaseIndexed() || false,
        codebaseStats: ctx.qmd?.getCodebaseStats() || { indexed: false },
        githubConfigured: config.agents?.autoPushGithub || false,
        githubRepo: config.agents?.githubRepo || "",
      });
    });

    socket.on("self-improvement:run", async () => {
      if (!ctx.agents || !ctx.qmd) {
        socket.emit("self-improvement:error", { error: "Self-improvement not configured" });
        return;
      }
      const scheduler = new SelfImprovementScheduler(ctx.agents, ctx.qmd, config.agents!, projectRoot);
      const report = await scheduler.trigger();
      socket.emit("self-improvement:report", report);
    });

    socket.on("self-improvement:index-codebase", async () => {
      if (!ctx.qmd) {
        socket.emit("self-improvement:error", { error: "QMD not configured" });
        return;
      }
      const result = await ctx.qmd.indexCodebase(projectRoot);
      socket.emit("self-improvement:indexed", result);
    });

    // ── Orchestration ──
    socket.on("orchestration:status", async () => {
      try {
        const response = await fetch("http://127.0.0.1:18790/status");
        const data = await response.json();
        socket.emit("orchestration:status", data);
      } catch {
        socket.emit("orchestration:status", { error: "Orchestration server not running" });
      }
    });

    socket.on("orchestration:kanban", async () => {
      try {
        const response = await fetch("http://127.0.0.1:18790/kanban");
        const data = await response.json();
        socket.emit("orchestration:kanban", data);
      } catch {
        socket.emit("orchestration:kanban", { error: "Orchestration server not running" });
      }
    });

    socket.on("orchestration:start", async (data: { request: string }) => {
      try {
        const response = await fetch("http://127.0.0.1:18790/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ request: data.request }),
        });
        const result = await response.json();
        socket.emit("orchestration:started", result);
      } catch (err) {
        socket.emit("orchestration:error", { error: String(err) });
      }
    });

    socket.on("orchestration:feedback", async (data: { feedback: string; approved: boolean }) => {
      try {
        const response = await fetch("http://127.0.0.1:18790/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        const result = await response.json();
        socket.emit("orchestration:feedback-received", result);
      } catch (err) {
        socket.emit("orchestration:error", { error: String(err) });
      }
    });

    socket.on("orchestration:add-task", async (data: { description: string; assigned_to: string[] }) => {
      try {
        const response = await fetch("http://127.0.0.1:18790/task", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        const result = await response.json();
        socket.emit("orchestration:task-added", result);
      } catch (err) {
        socket.emit("orchestration:error", { error: String(err) });
      }
    });

    socket.on("orchestration:move-task", async (data: { task_id: string; status: string }) => {
      try {
        const response = await fetch("http://127.0.0.1:18790/task/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
        const result = await response.json();
        socket.emit("orchestration:task-moved", result);
      } catch (err) {
        socket.emit("orchestration:error", { error: String(err) });
      }
    });

    // Resume task - trigger agent to work on a task in "In Progress"
    socket.on("orchestration:resume-task", async (data: { task_id: string }) => {
      try {
        // Trigger the orchestration to resume work - it will find the task
        const response = await fetch("http://127.0.0.1:18790/task/resume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task_id: data.task_id, request: "Continue working on this task" }),
        });
        const result = await response.json();
        socket.emit("orchestration:resumed", result);
      } catch (err) {
        socket.emit("orchestration:error", { error: String(err) });
      }
    });

    // Clear all done tasks
    socket.on("orchestration:clear-done", async () => {
      try {
        const response = await fetch("http://127.0.0.1:18790/tasks/clear-done", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        const result = await response.json();
        socket.emit("orchestration:done-cleared", result);
      } catch (err) {
        socket.emit("orchestration:error", { error: String(err) });
      }
    });

    // ── QMD Search ──
    socket.on("qmd:search", async (data: { query: string; sources?: string[] }) => {
      if (!ctx.qmd) {
        socket.emit("qmd:results", { error: "QMD not initialized" });
        return;
      }
      try {
        const sources = data.sources as ("agent_files" | "chat_history" | "memory")[] | undefined;
        const results = await ctx.qmd.search(data.query, sources || ["agent_files", "chat_history", "memory"]);
        socket.emit("qmd:results", { results });
      } catch (err) {
        socket.emit("qmd:results", { error: String(err) });
      }
    });

    // ── Voice Transcription ──
    socket.on("voice:transcribe", async (data: { audio: string }) => {
      try {
        // audio is base64 encoded
        const buffer = Buffer.from(data.audio, "base64");
        const result = await transcribeBuffer(buffer);
        socket.emit("voice:transcription", { text: result.text });
      } catch (err) {
        log.error({ err }, "Voice transcription failed");
        socket.emit("voice:transcription", { error: String(err) });
      }
    });

    // ── Voice Synthesis (TTS) ──
    socket.on("voice:speak", async (data: { text: string }) => {
      try {
        const voiceConfig = config.voice;
        if (!voiceConfig?.provider || voiceConfig.provider === "system") {
          socket.emit("voice:speech", { error: "TTS not configured" });
          return;
        }

        const apiKey = voiceConfig.provider === "elevenlabs"
          ? voiceConfig.elevenLabsApiKey
          : config.llm.primary.apiKey;

        if (!apiKey) {
          socket.emit("voice:speech", { error: "API key not configured" });
          return;
        }

        const result = await textToSpeech(data.text, apiKey, {
          provider: voiceConfig.provider as "elevenlabs" | "openai" | "google" | "polly",
          voice: voiceConfig.voiceId,
        });

        socket.emit("voice:speech", {
          audio: result.audio.toString("base64"),
          format: result.format,
        });
      } catch (err) {
        log.error({ err }, "Voice synthesis failed");
        socket.emit("voice:speech", { error: String(err) });
      }
    });

    // ── Voice Mode Toggle ──
    socket.on("voice:toggle", async (data: { enabled: boolean }) => {
      const voiceConfig = config.telegram;
      voiceConfig.voiceReplies = data.enabled;
      log.info({ enabled: data.enabled }, "Voice mode toggled");
      socket.emit("voice:status", { enabled: data.enabled });
    });

    socket.on("voice:status:request", async () => {
      socket.emit("voice:status", {
        enabled: config.telegram.voiceReplies,
        provider: config.telegram.voiceProvider,
        voiceId: config.telegram.voiceId,
        voiceSpeed: config.telegram.voiceSpeed,
      });
    });

    socket.on("voice:settings:update", async (data: { provider?: string; voiceId?: string; voiceSpeed?: number; enabled?: boolean }) => {
      if (data.enabled !== undefined) config.telegram.voiceReplies = data.enabled;
      if (data.provider) config.telegram.voiceProvider = data.provider as "gtts" | "elevenlabs" | "openai" | "coqui" | "piper";
      if (data.voiceId) config.telegram.voiceId = data.voiceId;
      if (data.voiceSpeed) config.telegram.voiceSpeed = data.voiceSpeed;
      log.info({ settings: config.telegram }, "Voice settings updated");
      socket.emit("voice:status", {
        enabled: config.telegram.voiceReplies,
        provider: config.telegram.voiceProvider,
        voiceId: config.telegram.voiceId,
        voiceSpeed: config.telegram.voiceSpeed,
      });
    });

    socket.on("voice:test", async () => {
      try {
        const voiceConfig = config.telegram;
        const apiKey = voiceConfig.voiceProvider === "elevenlabs"
          ? config.voice?.elevenLabsApiKey
          : config.llm.primary.apiKey;

        const { textToSpeech } = await import("./voice/tts.js");
        const testText = "Hello! This is a test of the voice settings. The quick brown fox jumps over the lazy dog.";
        const result = await textToSpeech(testText, apiKey || "", {
          provider: voiceConfig.voiceProvider,
          voice: voiceConfig.voiceId,
        });

        socket.emit("voice:test:result", {
          audio: result.audio.toString("base64"),
          format: result.format,
        });
      } catch (err) {
        log.error({ err }, "Voice test failed");
        socket.emit("voice:test:result", { error: String(err) });
      }
    });

    // ── File Upload ──
    socket.on("file:upload", async (data: { filename: string; content: string; type: string; actorId?: string }) => {
      try {
        // content is base64 encoded
        const buffer = Buffer.from(data.content, "base64");
        const filename = data.filename;

        // Use MediaHandler to store the file
        const mediaFile = mediaHandler.store(buffer, filename, data.type);

        // Extract text from the file (OCR for images, parsing for documents)
        let extractedText: string | null = null;
        try {
          extractedText = await mediaHandler.extractText(mediaFile.id);
        } catch (extractErr) {
          log.warn({ err: extractErr, fileId: mediaFile.id }, "Text extraction failed, continuing without it");
        }

        socket.emit("file:uploaded", {
          filename: mediaFile.filename,
          isImage: mediaFile.mimeType.startsWith("image/"),
          size: mediaFile.sizeBytes,
          id: mediaFile.id,
          status: "stored",
          extractedText: extractedText,
          extractedTextPreview: extractedText ? extractedText.slice(0, 500) + (extractedText.length > 500 ? "..." : "") : null,
        });

        // If we have extracted text and actorId is provided, automatically process with LLM
        if (extractedText && data.actorId) {
          const actorId = data.actorId;
          const session = sessions.getOrCreate(actorId, "web");

          // Determine file type description
          const fileType = mediaFile.mimeType.startsWith("image/") ? "image" :
            mediaFile.mimeType === "application/pdf" ? "PDF document" :
              mediaFile.mimeType.includes("word") ? "Word document" :
                mediaFile.mimeType.includes("spreadsheet") ? "spreadsheet" :
                  mediaFile.mimeType.includes("presentation") ? "PowerPoint presentation" :
                    "document";

          // Build user message with extracted text
          const userMessage = `[Uploaded ${fileType}: ${filename}]\n\n${extractedText}`;
          sessions.addMessage(session.id, "user", userMessage);

          // Emit to Socket.io
          io.to(session.id).emit("chat:message", {
            sessionId: session.id,
            role: "user",
            content: userMessage,
            ts: Date.now(),
            source: "web",
            attachment: {
              type: fileType,
              fileId: mediaFile.id,
              filename: filename,
              extractedText: extractedText,
            },
          });

          // Start streaming response
          io.to(session.id).emit("chat:stream:start", { sessionId: session.id });

          const messages = session.messages.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }));

          const abortController = new AbortController();
          sessions.setAbortController(session.id, abortController);

          let fullResponse = "";
          try {
            for await (const chunk of llmRouter.stream(messages, session.id, botSystemPrompt, abortController.signal)) {
              fullResponse += chunk;
              io.to(session.id).emit("chat:stream:chunk", {
                sessionId: session.id,
                chunk,
              });
            }
          } finally {
            sessions.setAbortController(session.id, null);
          }

          sessions.addMessage(session.id, "assistant", fullResponse);
          io.to(session.id).emit("chat:stream:end", { sessionId: session.id });

          log.info({ sessionId: session.id, fileId: mediaFile.id }, "File uploaded and processed with LLM");
        }
      } catch (err) {
        log.error({ err }, "File upload failed");
        socket.emit("file:uploaded", { error: String(err) });
      }
    });

    // ── Skills List ──
    socket.on("skills:list", async () => {
      try {
        const skills = SkillsManager.listSkills();
        socket.emit("skills:list", { skills });
      } catch (err) {
        log.error({ err }, "Failed to list skills");
        socket.emit("skills:list", { error: String(err) });
      }
    });

    // ── Skills Install ──
    socket.on("skills:install", async (data: { source: string }) => {
      try {
        const result = await SkillsManager.installSkill(data.source);
        socket.emit("skills:installed", result);
      } catch (err) {
        log.error({ err }, "Failed to install skill");
        socket.emit("skills:installed", { success: false, error: String(err) });
      }
    });

    // ── Skills Uninstall ──
    socket.on("skills:uninstall", async (data: { id: string }) => {
      try {
        const result = SkillsManager.uninstallSkill(data.id);
        socket.emit("skills:uninstalled", result);
      } catch (err) {
        log.error({ err }, "Failed to uninstall skill");
        socket.emit("skills:uninstalled", { success: false, error: String(err) });
      }
    });

    // ── Skills Toggle ──
    socket.on("skills:toggle", async (data: { id: string; enabled: boolean }) => {
      try {
        const result = SkillsManager.toggleSkill(data.id, data.enabled);
        socket.emit("skills:toggled", result);
      } catch (err) {
        log.error({ err }, "Failed to toggle skill");
        socket.emit("skills:toggled", { success: false, error: String(err) });
      }
    });

    socket.on("disconnect", () => {
      log.debug({ socketId: socket.id }, "Client disconnected");
    });
  });

  // Start listening
  let { port, host } = config.server;

  // Helper function to check if a port is available
  async function isPortAvailable(port: number, host: string): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createNetServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close();
        resolve(true);
      });
      server.listen(port, host);
    });
  }

  // Find available port if the configured port is in use
  const maxRetries = 10;
  let actualPort = port;
  for (let i = 0; i < maxRetries; i++) {
    const tryPort = port + i;
    if (await isPortAvailable(tryPort, host)) {
      actualPort = tryPort;
      if (tryPort !== port) {
        log.warn({ requested: port, actual: tryPort }, "Port in use, using alternative port");
      }
      break;
    }
    if (i === maxRetries - 1) {
      log.error({ port, attempts: maxRetries }, "No available ports found");
      throw new Error(`Could not find available port after ${maxRetries} attempts`);
    }
  }

  // Simple HTTP endpoint for dashboard to discover gateway port and serve media
  httpServer.on("request", (req, res) => {
    const url = req.url || "";

    // Gateway port discovery
    if (url === "/.gateway-port" || url === "/api/port") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ port: actualPort, host }));
      return;
    }

    // Media file serving: /media/:id
    const mediaMatch = url.match(/^\/media\/(.+)$/);
    if (mediaMatch) {
      const fileId = mediaMatch[1];
      const file = mediaHandler.get(fileId);
      if (file) {
        res.writeHead(200, { "Content-Type": file.mimeType });
        res.end(file.data);
        return;
      }
      res.writeHead(404);
      res.end("Not found");
      return;
    }
  });

  // Get external IP addresses
  async function getExternalIPs(): Promise<string[]> {
    const ips: string[] = [];
    const { networkInterfaces } = await import("node:os");
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === "IPv4" && !net.internal) {
          ips.push(net.address);
        }
      }
    }
    return ips;
  }

  httpServer.listen(actualPort, host, async () => {
    const externalIPs = await getExternalIPs();
    const dashboardPort = config.server.dashboardPort;

    // Build startup info
    const lines: string[] = [];
    lines.push("");
    lines.push("╔════════════════════════════════════════════════════════════╗");
    lines.push("║                  FastBot Started                         ║");
    lines.push("╠════════════════════════════════════════════════════════════╣");
    lines.push(`║  Gateway:  ws://${host}:${actualPort}`.padEnd(62) + "║");
    lines.push(`║            ws://localhost:${actualPort}`.padEnd(62) + "║");
    for (const ip of externalIPs.slice(0, 2)) {
      lines.push(`║            ws://${ip}:${actualPort}`.padEnd(62) + "║");
    }
    lines.push("╠════════════════════════════════════════════════════════════╣");
    lines.push(`║  Dashboard: http://${host}:${dashboardPort}`.padEnd(62) + "║");
    lines.push(`║             http://localhost:${dashboardPort}`.padEnd(62) + "║");
    for (const ip of externalIPs.slice(0, 2)) {
      lines.push(`║             http://${ip}:${dashboardPort}`.padEnd(62) + "║");
    }
    if (config.telegram?.botToken) {
      lines.push("╠════════════════════════════════════════════════════════════╣");
      lines.push("║  Telegram: Bot token configured - search @BotFather        ║");
    }
    lines.push("╚════════════════════════════════════════════════════════════╝");
    lines.push("");

    for (const line of lines) {
      console.log(line);
    }

    log.info({ host, port: actualPort, dashboardPort, externalIPs }, "Gateway listening");
    audit.log({
      event: "session.created",
      actor: "system",
      detail: `Gateway started on ${host}:${actualPort}, Dashboard: ${host}:${dashboardPort}`,
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
    if (playwrightBridge) {
      await playwrightBridge.stop();
    }
    if (tailscaleManager) {
      tailscaleManager.stopStatusChecker();
      await tailscaleManager.stop();
    }
    io.close();
    httpServer.close();
    db.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function getSystemStatus(ctx: GatewayContext) {
  // Check Telegram status
  const telegramStatus = ctx.config.telegram.botToken
    ? (ctx.telegram ? "connected" : "pending")
    : "inactive";

  // Check LLM status
  const llmStatus = ctx.config.llm.primary?.provider && ctx.config.llm.primary?.model
    ? "active"
    : "inactive";

  // Check Playwright status
  const playwrightStatus = ctx.config.playwright?.enabled
    ? (ctx.playwright?.isReady() ? "active" : "inactive")
    : "inactive";

  // Check Tailscale status
  const tailscaleStatus = ctx.config.tailscale?.enabled
    ? ((await ctx.tailscale?.getStatus())?.connected ? "connected" : "inactive")
    : "inactive";

  // Check Voice status
  const voiceStatus = ctx.config.telegram.voiceReplies
    ? (ctx.config.telegram.voiceProvider && ctx.config.telegram.voiceId ? "active" : "inactive")
    : "inactive";

  // Check Auth/JWT status
  const authStatus = ctx.config.security.jwtSecret
    ? "active"
    : "inactive";

  return {
    gateway: "online",
    sessions: ctx.sessions.listActive().length,
    uptime: process.uptime(),
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    subsystems: {
      telegram: telegramStatus,
      llm: llmStatus,
      playwright: playwrightStatus,
      tailscale: tailscaleStatus,
      voice: voiceStatus,
      auth: authStatus,
    },
  };
}

main().catch((err) => {
  log.fatal({ err }, "Gateway failed to start");
  process.exit(1);
});
