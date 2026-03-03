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
  })
  .optional();

export const githubConfigSchema = z
  .object({
    token: z.string(),
  })
  .optional();

export const voiceConfigSchema = z
  .object({
    provider: z.enum(["elevenlabs", "system"]).default("system"),
    elevenLabsApiKey: z.string().optional(),
    voiceId: z.string().optional(),
  })
  .optional();

export const appConfigSchema = z.object({
  server: serverConfigSchema.default({}),
  telegram: telegramConfigSchema,
  llm: llmConfigSchema,
  security: securityConfigSchema.default({}),
  memory: memoryConfigSchema.default({}),
  google: googleConfigSchema,
  github: githubConfigSchema,
  voice: voiceConfigSchema,
});

export type AppConfig = z.infer<typeof appConfigSchema>;
export type TelegramConfig = z.infer<typeof telegramConfigSchema>;
export type LlmConfig = z.infer<typeof llmConfigSchema>;
export type LlmProvider = z.infer<typeof llmProviderSchema>;
export type SecurityConfig = z.infer<typeof securityConfigSchema>;
export type ServerConfig = z.infer<typeof serverConfigSchema>;
export type MemoryConfig = z.infer<typeof memoryConfigSchema>;
