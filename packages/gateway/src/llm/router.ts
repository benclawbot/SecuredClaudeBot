import { generateText, streamText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createMistral } from "@ai-sdk/mistral";
import { createCohere } from "@ai-sdk/cohere";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGroq } from "@ai-sdk/groq";
import { createMinimax } from "vercel-minimax-ai-provider";
import { createOllama } from "ollama-ai-provider";
import { createChildLogger } from "../logger/index.js";
import { UsageTracker } from "./usage.js";
import type { LlmProvider, LlmConfig } from "../config/schema.js";

const log = createChildLogger("llm:router");

/**
 * Create a Vercel AI SDK model instance from a provider config.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createModel(provider: LlmProvider): any {
  switch (provider.provider) {
    case "anthropic":
      return createAnthropic({ apiKey: provider.apiKey })(provider.model);
    case "openai":
      return createOpenAI({
        apiKey: provider.apiKey,
        ...(provider.baseUrl ? { baseURL: provider.baseUrl } : {}),
      })(provider.model);
    case "google":
      return createGoogleGenerativeAI({ apiKey: provider.apiKey })(
        provider.model
      );
    case "mistral":
      return createMistral({ apiKey: provider.apiKey })(provider.model);
    case "cohere":
      return createCohere({ apiKey: provider.apiKey })(provider.model);
    case "deepseek":
      return createDeepSeek({ apiKey: provider.apiKey })(provider.model);
    case "groq":
      return createGroq({ apiKey: provider.apiKey })(provider.model);
    case "ollama":
      return createOllama({
        baseURL: provider.baseUrl ?? "http://localhost:11434/api",
      })(provider.model);
    case "minimax":
      // MiniMax uses a specific API endpoint
      return createMinimax({
        apiKey: provider.apiKey ?? "",
      })(provider.model);
    case "custom":
      // Custom provider - uses OpenAI SDK format with custom base URL
      if (!provider.baseUrl) {
        throw new Error("Custom provider requires a Base URL");
      }
      return createOpenAI({
        apiKey: provider.apiKey ?? "",
        baseURL: provider.baseUrl,
      })(provider.model);
    default:
      throw new Error(`Unknown LLM provider: ${provider.provider}`);
  }
}

export class LlmRouter {
  private usage = new UsageTracker();

  constructor(private config: LlmConfig) {
    log.info(
      {
        primary: config.primary.provider,
        model: config.primary.model,
        fallbacks: config.fallbacks.length,
      },
      "LLM router initialized"
    );
  }

  /**
   * Update the primary provider config at runtime.
   */
  updatePrimary(config: Partial<LlmProvider>): void {
    this.config.primary = { ...this.config.primary, ...config };
    log.info(
      {
        provider: this.config.primary.provider,
        model: this.config.primary.model,
      },
      "LLM primary provider updated"
    );
  }

  /**
   * Validate LLM configuration by attempting a simple request.
   * Returns detailed error info if validation fails.
   */
  async validateConfig(config: LlmProvider): Promise<{ valid: true } | { valid: false; error: string; hint?: string }> {
    // Validate required fields
    if (!config.provider) {
      return { valid: false, error: "Provider is required", hint: "Valid providers: anthropic, openai, google, ollama" };
    }

    if (!config.model) {
      return { valid: false, error: "Model is required", hint: "e.g., claude-sonnet-4-20250514, gpt-4o, gemini-2.0-flash" };
    }

    // Validate provider
    const validProviders = ["anthropic", "openai", "google", "mistral", "cohere", "deepseek", "groq", "ollama", "minimax", "custom"];
    if (!validProviders.includes(config.provider)) {
      return { valid: false, error: `Unknown provider: "${config.provider}"`, hint: `Valid providers: ${validProviders.join(", ")}` };
    }

    // Custom provider requires base URL
    if (config.provider === "custom") {
      if (!config.baseUrl) {
        return { valid: false, error: "Base URL is required for custom provider", hint: "Enter the API endpoint URL (e.g., https://api.minimax.io/anthropic)" };
      }
      if (!config.model) {
        return { valid: false, error: "Model is required for custom provider", hint: "Enter the model name (e.g., MiniMax-M2.5)" };
      }
      // Test the custom endpoint
      try {
        const model = createOpenAI({
          apiKey: config.apiKey ?? "",
          baseURL: config.baseUrl,
        })(config.model);
        const result = await generateText({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          model: model as any,
          messages: [{ role: "user", content: "Hi" }],
        });
        if (!result.text && !result.toolCalls) {
          return { valid: false, error: "Empty response from custom API", hint: "The model may be invalid or the API may be experiencing issues" };
        }
        log.info({ baseUrl: config.baseUrl, model: config.model }, "Custom provider validated successfully");
        return { valid: true };
      } catch (err: any) {
        const errorMessage = err.message || String(err);
        if (errorMessage.includes("404") || errorMessage.includes("not found")) {
          return { valid: false, error: `Model not found: ${config.model}`, hint: "Check the model name is correct for this provider" };
        }
        if (errorMessage.includes("401") || errorMessage.includes("authentication") || errorMessage.includes("API key")) {
          return { valid: false, error: "Authentication failed", hint: "Check your API key is correct" };
        }
        return { valid: false, error: errorMessage, hint: "Check your Base URL and model configuration" };
      }
    }

    // Check API key for non-ollama providers
    if (config.provider !== "ollama") {
      if (!config.apiKey) {
        return { valid: false, error: "API key is required", hint: "Enter your API key in the Settings" };
      }
      if (config.apiKey === "YOUR_ANTHROPIC_API_KEY_HERE" || config.apiKey.startsWith("YOUR_")) {
        return { valid: false, error: "API key is a placeholder", hint: "Replace with your actual API key" };
      }
      if (config.apiKey.length < 10) {
        return { valid: false, error: "API key appears too short", hint: "API keys are typically 40+ characters (sk-...)" };
      }
    }

    // For Ollama, check base URL is reachable
    if (config.provider === "ollama") {
      const baseUrl = config.baseUrl ?? "http://localhost:11434/api";
      try {
        const response = await fetch(baseUrl.replace("/api", "/"));
        if (!response.ok) {
          return { valid: false, error: `Ollama not reachable at ${baseUrl}`, hint: "Make sure Ollama is running (ollama serve)" };
        }
      } catch (err) {
        return { valid: false, error: `Cannot connect to Ollama at ${baseUrl}`, hint: "Make sure Ollama is running on localhost:11434" };
      }
    }

    // Test the actual API with a minimal request
    try {
      const model = createModel(config);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await generateText({
        model: model as any,
        messages: [{ role: "user", content: "Hi" }],
      });

      if (!result.text && !result.toolCalls) {
        return { valid: false, error: "Empty response from API", hint: "The model may be invalid or the API may be experiencing issues" };
      }

      log.info({ provider: config.provider, model: config.model }, "LLM config validated successfully");
      return { valid: true };
    } catch (err: any) {
      // Parse detailed error messages
      const errorMessage = err.message || String(err);

      // Anthropic-specific errors
      if (errorMessage.includes("401") || errorMessage.includes("authentication")) {
        return { valid: false, error: "Authentication failed (401)", hint: "Your API key is invalid or expired. Check your API key in Settings." };
      }
      if (errorMessage.includes("403") || errorMessage.includes("forbidden")) {
        return { valid: false, error: "Access forbidden (403)", hint: "Your API key doesn't have access to this model. Check your Anthropic dashboard." };
      }
      if (errorMessage.includes("429") || errorMessage.includes("rate_limit")) {
        return { valid: false, error: "Rate limit exceeded (429)", hint: "Too many requests. Wait a moment and try again." };
      }
      if (errorMessage.includes("400") && config.provider === "anthropic") {
        if (errorMessage.includes("model")) {
          return { valid: false, error: "Invalid model for Anthropic", hint: `Model "${config.model}" may not exist. Try: claude-sonnet-4-20250514, claude-3-5-haiku-20241022` };
        }
      }

      // OpenAI-specific errors
      if (config.provider === "openai") {
        if (errorMessage.includes("401")) {
          return { valid: false, error: "Invalid OpenAI API key", hint: "Check your API key at https://platform.openai.com/api-keys" };
        }
        if (errorMessage.includes("404") || errorMessage.includes("model not found")) {
          return { valid: false, error: `Model not found: ${config.model}`, hint: "Try: gpt-4o, gpt-4o-mini, gpt-4-turbo" };
        }
      }

      // Google-specific errors
      if (config.provider === "google") {
        if (errorMessage.includes("401") || errorMessage.includes("API key")) {
          return { valid: false, error: "Invalid Google API key", hint: "Get your API key from Google AI Studio" };
        }
        if (errorMessage.includes("404") || errorMessage.includes("not found")) {
          return { valid: false, error: `Model not found: ${config.model}`, hint: "Try: gemini-2.0-flash, gemini-1.5-pro" };
        }
      }

      // Mistral-specific errors
      if (config.provider === "mistral") {
        if (errorMessage.includes("401") || errorMessage.includes("authentication")) {
          return { valid: false, error: "Invalid Mistral API key", hint: "Get your API key from https://console.mistral.ai" };
        }
        if (errorMessage.includes("404") || errorMessage.includes("not found")) {
          return { valid: false, error: `Model not found: ${config.model}`, hint: "Try: mistral-large-latest, pixtral-large-latest" };
        }
      }

      // Cohere-specific errors
      if (config.provider === "cohere") {
        if (errorMessage.includes("401") || errorMessage.includes("authentication")) {
          return { valid: false, error: "Invalid Cohere API key", hint: "Get your API key from https://cohere.com/api-keys" };
        }
      }

      // DeepSeek-specific errors
      if (config.provider === "deepseek") {
        if (errorMessage.includes("401") || errorMessage.includes("authentication")) {
          return { valid: false, error: "Invalid DeepSeek API key", hint: "Get your API key from https://platform.deepseek.com" };
        }
      }

      // Groq-specific errors
      if (config.provider === "groq") {
        if (errorMessage.includes("401") || errorMessage.includes("authentication")) {
          return { valid: false, error: "Invalid Groq API key", hint: "Get your API key from https://console.groq.com" };
        }
        if (errorMessage.includes("404") || errorMessage.includes("not found")) {
          return { valid: false, error: `Model not found: ${config.model}`, hint: "Try: llama-3.3-70b-versatile, mixtral-8x7b-32768" };
        }
      }

      // MiniMax-specific errors
      if (config.provider === "minimax") {
        if (errorMessage.includes("401") || errorMessage.includes("authentication")) {
          return { valid: false, error: "Invalid MiniMax API key", hint: "Get your API key from https://platform.minimaxi.com" };
        }
        if (errorMessage.includes("404") || errorMessage.includes("not found")) {
          return { valid: false, error: `Model not found: ${config.model}`, hint: "Try: M2-her, or check MiniMax model names" };
        }
      }

      // Generic fallback
      return { valid: false, error: errorMessage, hint: "Check your configuration and try again" };
    }
  }

  /**
   * Generate a full response (non-streaming).
   * Tries primary, then fallbacks in order.
   */
  async generate(
    messages: any[],
    sessionId: string,
    systemPrompt?: string
  ): Promise<{ text: string; provider: string; model: string }> {
    const providers = [this.config.primary, ...this.config.fallbacks];

    for (const provider of providers) {
      try {
        const model = createModel(provider);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await generateText({
          model: model as any,
          messages,
          ...(systemPrompt ? { system: systemPrompt } : {}),
        });

        this.usage.record(
          provider.provider,
          provider.model,
          (result.usage as any)?.inputTokens ?? 0,
          (result.usage as any)?.outputTokens ?? 0,
          sessionId
        );

        log.info(
          {
            provider: provider.provider,
            model: provider.model,
            tokensIn: (result.usage as any)?.inputTokens ?? 0,
            tokensOut: (result.usage as any)?.outputTokens ?? 0,
          },
          "LLM response generated"
        );

        return {
          text: result.text,
          provider: provider.provider,
          model: provider.model,
        };
      } catch (err) {
        log.warn(
          { provider: provider.provider, model: provider.model, err },
          "LLM provider failed, trying fallback"
        );
      }
    }

    throw new Error("All LLM providers failed");
  }

  /**
   * Stream a response. Yields text chunks.
   * Only tries primary provider (streaming + fallback is complex).
   */
  async *stream(
    messages: any[],
    sessionId: string,
    systemPrompt?: string
  ): AsyncGenerator<string, void, unknown> {
    const provider = this.config.primary;

    // Validate config before attempting request
    if (!provider.apiKey || provider.apiKey === "YOUR_ANTHROPIC_API_KEY_HERE") {
      throw new Error(
        `Invalid API key for ${provider.provider}. Please configure a valid API key in Settings.`
      );
    }

    const model = createModel(provider);

    const result = streamText({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: model as any,
      messages,
      ...(systemPrompt ? { system: systemPrompt } : {}),
    });

    let totalIn = 0;
    let totalOut = 0;

    for await (const chunk of result.textStream) {
      yield chunk;
      totalOut += chunk.length; // Approximate — real count from usage
    }

    // Record usage from final result
    const finalResult = await result;
    this.usage.record(
      provider.provider,
      provider.model,
      (finalResult.usage as any)?.inputTokens ?? totalIn,
      (finalResult.usage as any)?.outputTokens ?? totalOut,
      sessionId
    );
  }

  getUsage(): UsageTracker {
    return this.usage;
  }
}
