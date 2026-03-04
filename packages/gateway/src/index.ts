import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
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
import { PlaywrightBridge } from "./playwright/bridge.js";
import { TailscaleManager } from "./tailscale/manager.js";
import { AgentsManager } from "./agents/manager.js";
import { RcaScheduler } from "./agents/rca-scheduler.js";
import {
  shouldTriggerOrchestration,
  extractOrchestrationRequest,
  triggerOrchestration,
} from "./orchestration/chat-integration.js";
import { QmdStore } from "./qmd/store.js";
import { transcribeBuffer } from "./voice/whisper.js";
import { textToSpeech } from "./voice/tts.js";
import { getBotSystemPrompt } from "./bot/context.js";
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
}

async function main() {
  log.info("SecureClaudebot gateway starting...");

  // Ensure data directory exists
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  // Load config
  const config = loadConfig();

  // Check if first-time setup is needed
  const needsOnboarding = !config.llm?.primary?.apiKey || config.llm.primary.apiKey.startsWith("YOUR_");
  if (needsOnboarding) {
    log.warn("API key not configured - running in limited mode");
    console.log("\n⚠️  SecureClaudebot needs configuration!\n");
    console.log("Please configure your settings in config.json or run the setup wizard.\n");
    console.log("Required: LLM provider API key (set in config.json)\n");
  }

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
    playwright: null,
    tailscale: null,
    agents: null,
    qmd: null,
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
  if (config.agents) {
    agentsManager = new AgentsManager(config.agents);
    await agentsManager.initializeAgents();
    ctx.agents = agentsManager;

    // Initialize QMD (Query Memory Data) store
    ctx.qmd = new QmdStore(db, null, config.agents.directory);
    log.info("QMD store initialized");

    // Start RCA scheduler if enabled
    if (config.agents.enableRcaCron) {
      rcaScheduler = new RcaScheduler(agentsManager, config.agents);
      rcaScheduler.start();
    }
    log.info("Agents manager initialized");
  } else {
    log.info("Agents not configured");
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

        let fullResponse = "";
        for await (const chunk of llmRouter.stream(messages, session.id, botSystemPrompt)) {
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
    socket.on("status:request", async () => {
      socket.emit("status:update", await getSystemStatus(ctx));
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
      socket.emit("voice:status", { enabled: config.telegram.voiceReplies });
    });

    // ── File Upload ──
    socket.on("file:upload", async (data: { filename: string; content: string; type: string }) => {
      try {
        // content is base64 encoded
        const buffer = Buffer.from(data.content, "base64");
        const filename = data.filename;

        // Check if it's an image
        const isImage = data.type.startsWith("image/");

        socket.emit("file:uploaded", {
          filename,
          isImage,
          size: buffer.length,
          status: "received",
        });
      } catch (err) {
        log.error({ err }, "File upload failed");
        socket.emit("file:uploaded", { error: String(err) });
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

  // Simple HTTP endpoint for dashboard to discover gateway port
  httpServer.on("request", (req, res) => {
    if (req.url === "/.gateway-port" || req.url === "/api/port") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ port: actualPort, host }));
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
    lines.push("║              SecuredClaudeBot Started                     ║");
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
    },
  };
}

main().catch((err) => {
  log.fatal({ err }, "Gateway failed to start");
  process.exit(1);
});
