/**
 * Onboarding Wizard — interactive first-run setup.
 * Guides the user through Telegram token, LLM key, and PIN configuration.
 * Designed to work over both CLI and Telegram DM.
 */
import { createChildLogger } from "../logger/index.js";
import type { KeyStore } from "../crypto/keystore.js";
import type { AuditLog } from "../logger/audit.js";

const log = createChildLogger("onboarding");

export type WizardStep =
  | "welcome"
  | "pin"
  | "telegram"
  | "llm_provider"
  | "llm_key"
  | "confirm"
  | "done";

export interface WizardState {
  currentStep: WizardStep;
  data: {
    pin?: string;
    telegramToken?: string;
    llmProvider?: string;
    llmApiKey?: string;
    llmModel?: string;
  };
  completed: boolean;
}

export interface WizardResponse {
  message: string;
  promptType: "text" | "password" | "select";
  options?: string[];
  nextStep: WizardStep;
}

/**
 * Stateful onboarding wizard that can be driven by any UI (CLI, Telegram, Web).
 */
export class OnboardingWizard {
  private state: WizardState;

  constructor(
    private keyStore: KeyStore,
    private audit: AuditLog
  ) {
    this.state = {
      currentStep: "welcome",
      data: {},
      completed: false,
    };
    log.info("Onboarding wizard initialized");
  }

  /**
   * Get the current step's prompt.
   */
  getPrompt(): WizardResponse {
    switch (this.state.currentStep) {
      case "welcome":
        return {
          message:
            "Welcome to FastBot! Let's set up your secure AI gateway.\n\n" +
            "First, we'll configure your encryption PIN, Telegram bot, and LLM provider.\n\n" +
            "Type 'start' to begin.",
          promptType: "text",
          nextStep: "pin",
        };

      case "pin":
        return {
          message:
            "Set your encryption PIN (min 4 characters).\n" +
            "This PIN encrypts all your API keys and secrets using AES-256-GCM.",
          promptType: "password",
          nextStep: "telegram",
        };

      case "telegram":
        return {
          message:
            "Enter your Telegram Bot Token.\n" +
            "Get one from @BotFather on Telegram.\n" +
            "Type 'skip' to configure later.",
          promptType: "password",
          nextStep: "llm_provider",
        };

      case "llm_provider":
        return {
          message: "Choose your primary LLM provider:",
          promptType: "select",
          options: ["anthropic", "openai", "google", "ollama"],
          nextStep: "llm_key",
        };

      case "llm_key":
        return {
          message: `Enter your ${this.state.data.llmProvider ?? "LLM"} API key.\n` +
            (this.state.data.llmProvider === "ollama"
              ? "For Ollama (local), just press Enter to skip."
              : ""),
          promptType: "password",
          nextStep: "confirm",
        };

      case "confirm":
        return {
          message: this.getSummary() + "\n\nType 'confirm' to save or 'restart' to start over.",
          promptType: "text",
          nextStep: "done",
        };

      case "done":
        return {
          message: "Setup complete! Your gateway is ready to launch.",
          promptType: "text",
          nextStep: "done",
        };
    }
  }

  /**
   * Process user input for the current step.
   */
  async processInput(input: string): Promise<WizardResponse> {
    const trimmed = input.trim();

    switch (this.state.currentStep) {
      case "welcome":
        this.state.currentStep = "pin";
        break;

      case "pin":
        if (trimmed.length < 4) {
          return {
            message: "PIN must be at least 4 characters. Try again.",
            promptType: "password",
            nextStep: "pin",
          };
        }
        this.state.data.pin = trimmed;
        this.state.currentStep = "telegram";
        break;

      case "telegram":
        if (trimmed.toLowerCase() !== "skip") {
          this.state.data.telegramToken = trimmed;
        }
        this.state.currentStep = "llm_provider";
        break;

      case "llm_provider":
        const validProviders = ["anthropic", "openai", "google", "ollama"];
        if (!validProviders.includes(trimmed.toLowerCase())) {
          return {
            message: "Invalid provider. Choose: anthropic, openai, google, or ollama",
            promptType: "select",
            options: validProviders,
            nextStep: "llm_provider",
          };
        }
        this.state.data.llmProvider = trimmed.toLowerCase();
        this.state.data.llmModel = this.getDefaultModel(trimmed.toLowerCase());
        this.state.currentStep = "llm_key";
        break;

      case "llm_key":
        if (trimmed && trimmed.toLowerCase() !== "skip") {
          this.state.data.llmApiKey = trimmed;
        }
        this.state.currentStep = "confirm";
        break;

      case "confirm":
        if (trimmed.toLowerCase() === "restart") {
          this.state = { currentStep: "welcome", data: {}, completed: false };
          return this.getPrompt();
        }

        if (trimmed.toLowerCase() === "confirm") {
          await this.saveConfig();
          this.state.currentStep = "done";
          this.state.completed = true;
        }
        break;
    }

    return this.getPrompt();
  }

  /**
   * Check if onboarding is complete.
   */
  isComplete(): boolean {
    return this.state.completed;
  }

  /**
   * Get current state (for persistence).
   */
  getState(): WizardState {
    return { ...this.state };
  }

  // ── Private ──

  private getDefaultModel(provider: string): string {
    const defaults: Record<string, string> = {
      anthropic: "claude-sonnet-4-20250514",
      openai: "gpt-4o",
      google: "gemini-2.0-flash",
      ollama: "llama3.2",
    };
    return defaults[provider] ?? "unknown";
  }

  private getSummary(): string {
    const d = this.state.data;
    return [
      "Configuration Summary:",
      `  PIN: ${"*".repeat(d.pin?.length ?? 0)}`,
      `  Telegram: ${d.telegramToken ? "configured" : "skipped"}`,
      `  LLM: ${d.llmProvider ?? "none"} / ${d.llmModel ?? "none"}`,
      `  API Key: ${d.llmApiKey ? "configured" : "not set"}`,
    ].join("\n");
  }

  private async saveConfig(): Promise<void> {
    const d = this.state.data;

    // Store secrets in encrypted key store
    if (d.telegramToken) {
      await this.keyStore.set("telegram_token", d.telegramToken);
    }
    if (d.llmApiKey) {
      await this.keyStore.set("llm_api_key", d.llmApiKey);
    }

    this.audit.log({
      event: "config.updated",
      actor: "onboarding",
      detail: `Initial setup completed — provider: ${d.llmProvider}`,
    });

    log.info("Onboarding configuration saved");
  }
}
