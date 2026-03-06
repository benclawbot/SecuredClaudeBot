import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "url";
import { createServer } from "node:net";
import { appConfigSchema, type AppConfig } from "./schema.js";
import { createChildLogger } from "../logger/index.js";

const log = createChildLogger("config");

// Get the directory of this file (packages/gateway/src/config/)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Project root is three levels up from config/loader.ts
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..");
const DEFAULT_CONFIG_PATH = resolve(PROJECT_ROOT, "config.json");
const ENV_FILE_PATH = resolve(PROJECT_ROOT, ".env");
const PORT_FILE_PATH = resolve(__dirname, "..", ".gateway-port");

// Port ranges to exclude (known defaults like OpenClaw's 18789)
const EXCLUDED_PORTS = new Set([18789]);

// Check if a port is available (sync check)
function isPortAvailable(port: number): boolean {
  // Skip the check for now - server will fail to start if port is in use anyway
  // and there's existing logic to handle that
  return true;
}

// Generate a random port in the range 10000-60000, excluding known defaults
function randomPort(): number {
  let port: number;
  let attempts = 0;
  do {
    port = Math.floor(Math.random() * 50000) + 10000;
    attempts++;
    // Max 10 attempts
    if (attempts > 10) break;
  } while (EXCLUDED_PORTS.has(port));
  return port;
}

// Save gateway port to a file for dashboard to discover
export function saveGatewayPort(port: number): void {
  writeFileSync(PORT_FILE_PATH, port.toString(), "utf-8");
}

// Read gateway port from file (for dashboard)
export function readGatewayPort(): number | null {
  if (existsSync(PORT_FILE_PATH)) {
    const content = readFileSync(PORT_FILE_PATH, "utf-8").trim();
    const port = parseInt(content, 10);
    return isNaN(port) ? null : port;
  }
  return null;
}

/**
 * Load and validate config from a JSON file + environment variable overrides.
 */
export function loadConfig(
  configPath: string = DEFAULT_CONFIG_PATH
): AppConfig {
  let raw: Record<string, unknown> = {};

  if (existsSync(configPath)) {
    log.info({ path: configPath }, "Loading config from file");
    const content = readFileSync(configPath, "utf-8");
    raw = JSON.parse(content) as Record<string, unknown>;
  } else {
    log.warn({ path: configPath }, "Config file not found, using defaults");
    // Minimal defaults for first-run - will prompt for setup
    raw = {
      server: { port: 44512, dashboardPort: 3100, host: "0.0.0.0" },
      llm: {
        primary: { provider: "minimax", apiKey: "temp", model: "M2.5" },
        fallbacks: []
      },
      security: { jwtSecret: "temp-secret-change-me", pin: "temp123" }
    };
  }

  // Apply environment overrides first
  applyEnvOverrides(raw);

  const result = appConfigSchema.safeParse(raw);
  if (!result.success) {
    log.error({ errors: result.error.flatten() }, "Config validation failed");
    throw new Error(
      `Invalid configuration: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`
    );
  }

  log.info("Config loaded and validated");

  // Save port to file for dashboard to discover
  saveGatewayPort(result.data.server.port);

  return result.data;
}

function applyEnvOverrides(raw: Record<string, unknown>): void {
  const env = process.env;

  // Telegram
  if (env.SCB_TELEGRAM_TOKEN) {
    (raw as any).telegram ??= {};
    (raw as any).telegram.botToken = env.SCB_TELEGRAM_TOKEN;
  }

  // LLM primary
  if (env.SCB_LLM_PROVIDER || env.SCB_LLM_API_KEY || env.SCB_LLM_MODEL) {
    (raw as any).llm ??= {};
    (raw as any).llm.primary ??= {};
    if (env.SCB_LLM_PROVIDER)
      (raw as any).llm.primary.provider = env.SCB_LLM_PROVIDER;
    if (env.SCB_LLM_API_KEY)
      (raw as any).llm.primary.apiKey = env.SCB_LLM_API_KEY;
    if (env.SCB_LLM_MODEL)
      (raw as any).llm.primary.model = env.SCB_LLM_MODEL;
  }

  // Server
  if (env.SCB_PORT) {
    (raw as any).server ??= {};
    (raw as any).server.port = Number(env.SCB_PORT);
  }

  // Security PIN
  if (env.SCB_PIN) {
    (raw as any).security ??= {};
    (raw as any).security.pin = env.SCB_PIN;
  }

  // GitHub OAuth
  if (env.SCB_GITHUB_CLIENT_ID || env.SCB_GITHUB_CLIENT_SECRET) {
    (raw as any).github ??= {};
    if (env.SCB_GITHUB_CLIENT_ID)
      (raw as any).github.clientId = env.SCB_GITHUB_CLIENT_ID;
    if (env.SCB_GITHUB_CLIENT_SECRET)
      (raw as any).github.clientSecret = env.SCB_GITHUB_CLIENT_SECRET;
  }

  // Google OAuth
  if (env.SCB_GOOGLE_CLIENT_ID || env.SCB_GOOGLE_CLIENT_SECRET) {
    (raw as any).google ??= {};
    if (env.SCB_GOOGLE_CLIENT_ID)
      (raw as any).google.clientId = env.SCB_GOOGLE_CLIENT_ID;
    if (env.SCB_GOOGLE_CLIENT_SECRET)
      (raw as any).google.clientSecret = env.SCB_GOOGLE_CLIENT_SECRET;
  }

  // JWT Secret
  if (env.SCB_JWT_SECRET) {
    (raw as any).security ??= {};
    (raw as any).security.jwtSecret = env.SCB_JWT_SECRET;
  }

  // Microsoft OAuth
  if (env.SCB_MICROSOFT_CLIENT_ID || env.SCB_MICROSOFT_CLIENT_SECRET) {
    (raw as any).microsoft ??= {};
    if (env.SCB_MICROSOFT_CLIENT_ID)
      (raw as any).microsoft.clientId = env.SCB_MICROSOFT_CLIENT_ID;
    if (env.SCB_MICROSOFT_CLIENT_SECRET)
      (raw as any).microsoft.clientSecret = env.SCB_MICROSOFT_CLIENT_SECRET;
  }
}

/**
 * Save the current config to file (merges with existing).
 * Sensitive values are saved to .env instead.
 */
export function saveConfig(config: AppConfig, configPath: string = DEFAULT_CONFIG_PATH): void {
  // First save secrets to .env
  saveSecretsToEnv(config);

  // Then save non-sensitive config to config.json (with secrets redacted)
  const sanitizedConfig = redactSecrets(config);
  writeFileSync(configPath, JSON.stringify(sanitizedConfig, null, 2), "utf-8");
  log.info({ path: configPath }, "Config saved");
}

/**
 * Save sensitive values to .env file.
 */
function saveSecretsToEnv(config: AppConfig): void {
  const envVars: string[] = [];

  // Telegram bot token
  if (config.telegram?.botToken && !config.telegram.botToken.startsWith("YOUR_")) {
    envVars.push(`SCB_TELEGRAM_TOKEN=${config.telegram.botToken}`);
  }

  // LLM API key
  if (config.llm?.primary?.apiKey && !config.llm.primary.apiKey.startsWith("YOUR_")) {
    envVars.push(`SCB_LLM_API_KEY=${config.llm.primary.apiKey}`);
  }
  if (config.llm?.primary?.provider) {
    envVars.push(`SCB_LLM_PROVIDER=${config.llm.primary.provider}`);
  }
  if (config.llm?.primary?.model) {
    envVars.push(`SCB_LLM_MODEL=${config.llm.primary.model}`);
  }

  // JWT Secret
  if (config.security?.jwtSecret && !config.security.jwtSecret.startsWith("YOUR_")) {
    envVars.push(`SCB_JWT_SECRET=${config.security.jwtSecret}`);
  }

  // GitHub OAuth
  if (config.github?.clientId && !config.github.clientId.startsWith("YOUR_")) {
    envVars.push(`SCB_GITHUB_CLIENT_ID=${config.github.clientId}`);
  }
  if (config.github?.clientSecret && !config.github.clientSecret.startsWith("YOUR_")) {
    envVars.push(`SCB_GITHUB_CLIENT_SECRET=${config.github.clientSecret}`);
  }

  // Google OAuth
  if (config.google?.clientId && !config.google.clientId.startsWith("YOUR_")) {
    envVars.push(`SCB_GOOGLE_CLIENT_ID=${config.google.clientId}`);
  }
  if (config.google?.clientSecret && !config.google.clientSecret.startsWith("YOUR_")) {
    envVars.push(`SCB_GOOGLE_CLIENT_SECRET=${config.google.clientSecret}`);
  }

  // Microsoft OAuth
  if (config.microsoft?.clientId && !config.microsoft.clientId.startsWith("YOUR_")) {
    envVars.push(`SCB_MICROSOFT_CLIENT_ID=${config.microsoft.clientId}`);
  }
  if (config.microsoft?.clientSecret && !config.microsoft.clientSecret.startsWith("YOUR_")) {
    envVars.push(`SCB_MICROSOFT_CLIENT_SECRET=${config.microsoft.clientSecret}`);
  }

  // Read existing .env to preserve comments and other vars
  let existingContent = "";
  if (existsSync(ENV_FILE_PATH)) {
    existingContent = readFileSync(ENV_FILE_PATH, "utf-8");
  }

  // Merge: update existing vars or add new ones
  const lines = existingContent.split("\n");
  const result: string[] = [];
  const handledKeys = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      result.push(line);
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex > 0) {
      const key = trimmed.substring(0, eqIndex);
      // Check if we have a new value for this key
      const newValue = envVars.find(v => v.startsWith(`${key}=`));
      if (newValue) {
        result.push(newValue);
        handledKeys.add(key);
      } else {
        result.push(line);
      }
    } else {
      result.push(line);
    }
  }

  // Add any unhandled new env vars
  for (const envVar of envVars) {
    const key = envVar.split("=")[0];
    if (!handledKeys.has(key)) {
      result.push(envVar);
    }
  }

  writeFileSync(ENV_FILE_PATH, result.join("\n"), "utf-8");
  log.info({ path: ENV_FILE_PATH }, "Secrets saved to .env");
}

/**
 * Redact secrets from config for storage in config.json.
 */
function redactSecrets(config: AppConfig): AppConfig {
  const redacted = JSON.parse(JSON.stringify(config)) as AppConfig;

  // Redact API keys and secrets
  if (redacted.telegram?.botToken) {
    redacted.telegram.botToken = "YOUR_TELEGRAM_BOT_TOKEN";
  }
  if (redacted.llm?.primary?.apiKey) {
    redacted.llm.primary.apiKey = "YOUR_API_KEY";
  }
  if (redacted.security?.jwtSecret) {
    redacted.security.jwtSecret = "YOUR_JWT_SECRET";
  }
  if (redacted.github?.clientId) {
    redacted.github.clientId = "YOUR_GITHUB_CLIENT_ID";
  }
  if (redacted.github?.clientSecret) {
    redacted.github.clientSecret = "YOUR_GITHUB_CLIENT_SECRET";
  }
  if (redacted.google?.clientId) {
    redacted.google.clientId = "YOUR_GOOGLE_CLIENT_ID";
  }
  if (redacted.google?.clientSecret) {
    redacted.google.clientSecret = "YOUR_GOOGLE_CLIENT_SECRET";
  }
  if (redacted.microsoft?.clientId) {
    redacted.microsoft.clientId = "YOUR_MICROSOFT_CLIENT_ID";
  }
  if (redacted.microsoft?.clientSecret) {
    redacted.microsoft.clientSecret = "YOUR_MICROSOFT_CLIENT_SECRET";
  }

  return redacted;
}

/**
 * Write a config scaffold file for the onboarding wizard.
 */
export function writeConfigScaffold(configPath: string = DEFAULT_CONFIG_PATH): void {
  const scaffold = {
    server: { port: randomPort(), host: "0.0.0.0" },
    telegram: { botToken: "YOUR_TELEGRAM_BOT_TOKEN", approvedUsers: [] },
    llm: {
      primary: { provider: "anthropic", apiKey: "YOUR_API_KEY", model: "claude-sonnet-4-20250514" },
      fallbacks: [],
    },
    security: { pin: "", shellAllowedPaths: ["."], binaryAllowlist: ["git", "node", "npm", "pnpm"] },
    memory: { dbPath: "data/scb.db" },
  };

  const dir = dirname(configPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(scaffold, null, 2), "utf-8");
  log.info({ path: configPath }, "Config scaffold written");
}
