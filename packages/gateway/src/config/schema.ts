import { z } from "zod";

export const telegramConfigSchema = z.object({
  botToken: z.string().optional(),
  /** Telegram user IDs that are pre-approved (skip approval flow) */
  approvedUsers: z.array(z.number()).default([]),
  /** Rate limit: max requests per minute per user */
  rateLimit: z.number().default(20),
  /** Enable voice (TTS) replies in Telegram */
  voiceReplies: z.boolean().default(true),
  /** Voice provider for TTS: gtts (free), elevenlabs, openai, coqui, piper */
  voiceProvider: z.enum(["gtts", "elevenlabs", "openai", "coqui", "piper"]).default("gtts"),
  /** Voice ID (language for gtts, model for coqui/piper, voice ID for elevenlabs/openai) */
  voiceId: z.string().default("en"),
  /** Voice speed: 0.5 = slow, 1.0 = normal, 2.0 = fast */
  voiceSpeed: z.number().min(0.5).max(2.0).default(1.0),
});

export const llmProviderSchema = z.object({
  provider: z.enum([
    "anthropic",
    "openai",
    "google",
    "mistral",
    "cohere",
    "deepseek",
    "groq",
    "ollama",
    "minimax",
    "custom",
  ]),
  apiKey: z.string().optional(),
  model: z.string(),
  baseUrl: z.string().optional(),
});

export const llmConfigSchema = z.object({
  /** The primary LLM to use */
  primary: llmProviderSchema,
  /** Fallback providers tried in order */
  fallbacks: z.array(llmProviderSchema).default([]),
});

export const securityConfigSchema = z.object({
  /** Paths the shell module is allowed to access */
  shellAllowedPaths: z.array(z.string()).default([]),
  /** Executables the shell module can spawn */
  binaryAllowlist: z
    .array(z.string())
    .default(["git", "node", "npm", "pnpm", "npx", "ls", "cat", "echo"]),
  /** Dashboard rate limit: max requests per minute per JWT */
  dashboardRateLimit: z.number().default(60),
  /** JWT secret (auto-generated on first run) */
  jwtSecret: z.string().optional(),
});

export const serverConfigSchema = z.object({
  /** Gateway WebSocket port */
  port: z.number().default(44512),
  /** Dashboard Next.js port */
  dashboardPort: z.number().default(3100),
  /** Hostname to bind to (use 0.0.0.0 for external access, 127.0.0.1 for localhost only) */
  host: z.string().default("0.0.0.0"),
  /** Public hostname for OAuth callbacks (e.g., Tailscale IP or domain). If not set, uses host. */
  publicHost: z.string().optional(),
});

export const memoryConfigSchema = z.object({
  /** SQLite database path */
  dbPath: z.string().default("data/scb.db"),
  /** Embedding provider */
  embeddingProvider: z
    .enum(["openai", "ollama"])
    .default("openai"),
  /** Embedding model */
  embeddingModel: z.string().default("text-embedding-3-small"),
  /** Consolidation interval in minutes */
  consolidationIntervalMinutes: z.number().default(30),
  /** Ollama base URL for embeddings */
  ollamaBaseUrl: z.string().url().optional(),
});

export const googleConfigSchema = z
  .object({
    clientId: z.string(),
    clientSecret: z.string(),
    refreshToken: z.string().optional(),
    scopes: z.array(z.string()).default([
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/photoslibrary.readonly",
      "https://www.googleapis.com/auth/youtube.readonly",
    ]),
  })
  .optional();

export const microsoftConfigSchema = z
  .object({
    clientId: z.string(),
    clientSecret: z.string(),
    tenantId: z.string().default("common"),
    refreshToken: z.string().optional(),
    scopes: z.array(z.string()).default([
      "User.Read",
      "Mail.Read",
      "Calendars.Read",
      "Files.Read",
      "offline_access",
    ]),
  })
  .optional();

export const githubConfigSchema = z
  .object({
    clientId: z.string(),
    clientSecret: z.string(),
    token: z.string().optional(),
    scopes: z.array(z.string()).default(["read:user", "repo", "gist"]),
  })
  .optional();

export const voiceConfigSchema = z
  .object({
    provider: z.enum(["elevenlabs", "system"]).default("system"),
    elevenLabsApiKey: z.string().optional(),
    voiceId: z.string().optional(),
  })
  .optional();

export const playwrightConfigSchema = z
  .object({
    /** Enable Playwright for web automation */
    enabled: z.boolean().default(true),
    /** Browser to use */
    browser: z.enum(["chromium", "firefox", "webkit"]).default("chromium"),
    /** Headless mode */
    headless: z.boolean().default(true),
    /** Timeout for tasks in ms */
    timeoutMs: z.number().default(30000),
  })
  .optional();

export const tailscaleConfigSchema = z
  .object({
    /** Enable Tailscale for remote access */
    enabled: z.boolean().default(false),
    /** Tailscale auth key (or use 'login' for interactive) */
    authKey: z.string().optional(),
    /** Additional Tailscale arguments */
    args: z.array(z.string()).default([]),
    /** Advertise exit node */
    advertiseExitNode: z.boolean().default(false),
  })
  .optional();

export const agentSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  status: z.enum(["active", "inactive", "pending"]).default("pending"),
  createdAt: z.number(),
  updatedAt: z.number(),
});

/** Orchestration config for CrewAI Flow */
export const orchestrationConfigSchema = z
  .object({
    /** Enable orchestration */
    enabled: z.boolean().default(false),
    /** Orchestration server port */
    port: z.number().default(18790),
    /** Database path for state persistence */
    dbPath: z.string().default("./data/orchestration.db"),
  })
  .optional();

export const agentsConfigSchema = z
  .object({
    /** Agents directory path */
    directory: z.string().default("data/agents"),
    /** User info file name */
    userInfoFile: z.string().default("user_info.md"),
    /** Auto-save interval in minutes */
    autoSaveInterval: z.number().default(5),
    /** Enable CRON for root cause analysis */
    enableRcaCron: z.boolean().default(true),
    /** RCA cron schedule (cron syntax) */
    rcaCronSchedule: z.string().default("0 2 * * *"), // Daily at 2am
    /** Enable self-improvement scheduler */
    enableSelfImprovement: z.boolean().default(true),
    /** Times to run self-improvement (HH:MM format) */
    selfImprovementTimes: z.array(z.string()).default(["06:00", "18:00"]),
    /** Auto-index codebase on startup */
    autoIndexCodebase: z.boolean().default(true),
    /** Auto-push improvements to GitHub */
    autoPushGithub: z.boolean().default(false),
    /** GitHub repository for auto-push (owner/repo format) */
    githubRepo: z.string().optional(),
  })
  .optional();

/** Claudegram agent configuration */
export const claudegramAgentSchema = z.object({
  /** Path to Claude Code executable */
  claudeExecutablePath: z.string().default('claude'),
  /** Use bundled Claude Code */
  claudeUseBundled: z.boolean().default(true),
  /** SDK log level */
  claudeSdkLogLevel: z.enum(['off', 'basic', 'verbose', 'trace']).default('basic'),
  /** Include partial messages */
  claudeSdkIncludePartial: z.boolean().default(false),
  /** Show reasoning summary */
  claudeReasoningSummary: z.boolean().default(true),
  /** Enable dangerous mode (bypass permissions) */
  dangerousMode: z.boolean().default(false),
  /** Max iterations for loop mode */
  maxLoopIterations: z.number().default(5),
  /** Enable agent watchdog */
  agentWatchdogEnabled: z.boolean().default(true),
  /** Watchdog warning seconds */
  agentWatchdogWarnSeconds: z.number().default(30),
  /** Watchdog log interval seconds */
  agentWatchdogLogSeconds: z.number().default(10),
  /** Query timeout ms (0 = disabled) */
  agentQueryTimeoutMs: z.number().default(0),
  /** Cancel on new message */
  cancelOnNewMessage: z.boolean().default(false),
  /** Show usage in responses */
  contextShowUsage: z.boolean().default(false),
  /** Notify on compaction */
  contextNotifyCompaction: z.boolean().default(true),
  /** Default streaming mode */
  streamingMode: z.enum(['streaming', 'wait']).default('streaming'),
  /** Workspace directory */
  workspaceDir: z.string().default(process.env.HOME || '.'),
});

/** Claudegram media configuration */
export const claudegramMediaSchema = z.object({
  /** Enable Reddit fetch */
  redditEnabled: z.boolean().default(true),
  /** Reddit client ID */
  redditClientId: z.string().optional(),
  /** Reddit client secret */
  redditClientSecret: z.string().optional(),
  /** Enable Reddit video download */
  vredditEnabled: z.boolean().default(true),
  /** Enable Medium fetch */
  mediumEnabled: z.boolean().default(true),
  /** Enable media extraction (YouTube, Instagram, TikTok) */
  extractEnabled: z.boolean().default(true),
  /** Enable voice transcription */
  transcribeEnabled: z.boolean().default(true),
  /** Enable TTS */
  ttsEnabled: z.boolean().default(true),
});

export const appConfigSchema = z.object({
  server: serverConfigSchema.optional(),
  telegram: telegramConfigSchema.optional(),
  llm: llmConfigSchema.optional(),
  security: securityConfigSchema.optional(),
  memory: memoryConfigSchema.optional(),
  google: googleConfigSchema,
  microsoft: microsoftConfigSchema,
  github: githubConfigSchema,
  voice: voiceConfigSchema,
  playwright: playwrightConfigSchema,
  tailscale: tailscaleConfigSchema,
  agents: agentsConfigSchema,
  orchestration: orchestrationConfigSchema,
  claudegram: z.object({
    agent: claudegramAgentSchema.optional(),
    media: claudegramMediaSchema.optional(),
  }).optional(),
}).transform((val) => ({
  server: serverConfigSchema.parse(val.server ?? {}),
  telegram: telegramConfigSchema.parse(val.telegram ?? {}),
  llm: llmConfigSchema.parse(val.llm ?? {}),
  security: securityConfigSchema.parse(val.security ?? {}),
  memory: memoryConfigSchema.parse(val.memory ?? {}),
  google: val.google,
  microsoft: val.microsoft,
  github: val.github,
  voice: val.voice,
  playwright: val.playwright,
  tailscale: val.tailscale,
  agents: val.agents,
  orchestration: val.orchestration,
  claudegram: {
    agent: claudegramAgentSchema.parse(val.claudegram?.agent ?? {}),
    media: claudegramMediaSchema.parse(val.claudegram?.media ?? {}),
  },
}));

export type AppConfig = z.infer<typeof appConfigSchema>;
export type TelegramConfig = z.infer<typeof telegramConfigSchema>;
export type LlmConfig = z.infer<typeof llmConfigSchema>;
export type LlmProvider = z.infer<typeof llmProviderSchema>;
export type SecurityConfig = z.infer<typeof securityConfigSchema>;
export type ServerConfig = z.infer<typeof serverConfigSchema>;
export type MemoryConfig = z.infer<typeof memoryConfigSchema>;
export type PlaywrightConfig = z.infer<typeof playwrightConfigSchema>;
export type TailscaleConfig = z.infer<typeof tailscaleConfigSchema>;
export type GoogleConfig = z.infer<typeof googleConfigSchema>;
export type MicrosoftConfig = z.infer<typeof microsoftConfigSchema>;
export type GithubConfig = z.infer<typeof githubConfigSchema>;
export type Agent = z.infer<typeof agentSchema>;
export type AgentsConfig = z.infer<typeof agentsConfigSchema>;
export type OrchestrationConfig = z.infer<typeof orchestrationConfigSchema>;
export type ClaudegramAgentConfig = z.infer<typeof claudegramAgentSchema>;
export type ClaudegramMediaConfig = z.infer<typeof claudegramMediaSchema>;
