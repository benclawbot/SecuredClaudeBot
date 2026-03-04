import { z } from "zod";

export const telegramConfigSchema = z.object({
  botToken: z.string().min(1),
  /** Telegram user IDs that are pre-approved (skip approval flow) */
  approvedUsers: z.array(z.number()).default([]),
  /** Rate limit: max requests per minute per user */
  rateLimit: z.number().default(20),
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
  /** PIN used to derive encryption key */
  pin: z.string().min(4).optional(),
  /** Paths the shell module is allowed to access */
  shellAllowedPaths: z.array(z.string()).default([]),
  /** Executables the shell module can spawn */
  binaryAllowlist: z
    .array(z.string())
    .default(["git", "node", "npm", "pnpm", "npx", "ls", "cat", "echo"]),
  /** Dashboard rate limit: max requests per minute per JWT */
  dashboardRateLimit: z.number().default(60),
  /** JWT secret (auto-generated if not set) */
  jwtSecret: z.string().optional(),
});

export const serverConfigSchema = z.object({
  /** Gateway WebSocket port */
  port: z.number().default(18789),
  /** Dashboard Next.js port */
  dashboardPort: z.number().default(3100),
  /** Hostname to bind to */
  host: z.string().default("127.0.0.1"),
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
    enabled: z.boolean().default(false),
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
  })
  .optional();

export const appConfigSchema = z.object({
  server: serverConfigSchema.default({}),
  telegram: telegramConfigSchema,
  llm: llmConfigSchema,
  security: securityConfigSchema.default({}),
  memory: memoryConfigSchema.default({}),
  google: googleConfigSchema,
  microsoft: microsoftConfigSchema,
  github: githubConfigSchema,
  voice: voiceConfigSchema,
  playwright: playwrightConfigSchema,
  tailscale: tailscaleConfigSchema,
  agents: agentsConfigSchema,
  orchestration: orchestrationConfigSchema,
});

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
