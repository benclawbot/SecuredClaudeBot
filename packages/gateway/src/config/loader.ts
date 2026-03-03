import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { appConfigSchema, type AppConfig } from "./schema.js";
import { createChildLogger } from "../logger/index.js";

const log = createChildLogger("config");

const DEFAULT_CONFIG_PATH = resolve(process.cwd(), "config.json");
const PORT_FILE_PATH = resolve(process.cwd(), ".gateway-port");

// Generate a random port in the range 10000-60000
function randomPort(): number {
  return Math.floor(Math.random() * 50000) + 10000;
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
    log.warn({ path: configPath }, "Config file not found, generating new config with random port");
    // Generate random port on first start
    raw = {
      server: { port: randomPort(), host: "127.0.0.1" },
      telegram: { botToken: "", approvedUsers: [] },
      llm: {
        primary: { provider: "anthropic", model: "" },
        fallbacks: [],
      },
      security: { pin: "", shellAllowedPaths: ["."], binaryAllowlist: ["git", "node", "npm", "pnpm"] },
      memory: { dbPath: "data/scb.db" },
    };
    // Save the generated config
    saveConfig(raw as unknown as AppConfig, configPath);
  }

  // Environment variable overrides (highest priority)
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

  // GitHub
  if (env.SCB_GITHUB_TOKEN) {
    (raw as any).github = { token: env.SCB_GITHUB_TOKEN };
  }
}

/**
 * Save the current config to file (merges with existing).
 */
export function saveConfig(config: AppConfig, configPath: string = DEFAULT_CONFIG_PATH): void {
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  log.info({ path: configPath }, "Config saved");
}

/**
 * Write a config scaffold file for the onboarding wizard.
 */
export function writeConfigScaffold(configPath: string = DEFAULT_CONFIG_PATH): void {
  const scaffold = {
    server: { port: randomPort(), host: "127.0.0.1" },
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
