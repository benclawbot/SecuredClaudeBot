/**
 * Claude Code Runner - Spawns Claude Code for agent tasks
 * Provides full agent capabilities (Write, Bash, Read, Glob, Grep, etc.)
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createChildLogger } from "./logger/index.js";
import { Readable } from "node:stream";

const log = createChildLogger("claude-runner");

export interface ClaudeRunnerOptions {
  /** Working directory for Claude Code */
  cwd?: string;
  /** Additional allowed directories */
  allowedDirs?: string[];
  /** Allowed tools (default: all) */
  allowedTools?: string[];
  /** Skip permission prompts */
  skipPermissions?: boolean;
  /** Model to use */
  model?: string;
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  id: string;
}

export interface ToolResult {
  toolUseId: string;
  content: string;
  isError?: boolean;
}

/**
 * Callback types for streaming output
 */
export interface ClaudeCallbacks {
  onToolCall?: (tool: ToolCall) => void;
  onToolResult?: (result: ToolResult) => void;
  onChunk?: (text: string) => void;
  onResult?: (result: string) => void;
  onError?: (error: string) => void;
}

/**
 * Parse a line of JSON output from Claude Code stream
 */
function parseLine(line: string): { type: string; data: unknown } | null {
  try {
    const obj = JSON.parse(line);
    return { type: obj.type, data: obj };
  } catch {
    return null;
  }
}

/**
 * Run Claude Code with a prompt and stream results
 */
export async function* runClaudeCode(
  prompt: string,
  options: ClaudeRunnerOptions = {},
  callbacks: ClaudeCallbacks = {}
): AsyncGenerator<string, void, unknown> {
  const {
    cwd = process.cwd(),
    allowedDirs = [],
    allowedTools = [],
    skipPermissions = true,
    model,
  } = options;

  // Build arguments
  const args = [
    "--print",
    "--output-format", "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    // Allow all tools explicitly
    "--allowedTools", "Write,Bash,Read,Glob,Grep,Edit,MultiEdit,NotebookEdit,Task,WebFetch,WebSearch",
    prompt,
  ];

  // Add optional flags
  if (skipPermissions) {
    args.unshift("--dangerously-skip-permissions");
  }

  if (allowedDirs.length > 0) {
    args.push("--add-dir", ...allowedDirs);
  }

  if (allowedTools.length > 0) {
    args.push("--allowedTools", allowedTools.join(","));
  }

  if (model) {
    args.push("--model", model);
  }

  log.info({ prompt: prompt.substring(0, 50), cwd }, "Starting Claude Code");

  // Spawn Claude Code process
  const proc = spawn("claude", args, {
    cwd,
    env: {
      ...process.env,
      CLAUDECODE: "", // Unset to allow nested execution
    },
    shell: true,
  });

  let buffer = "";
  let finalResult = "";

  // Process stdout
  proc.stdout?.on("data", (data: Buffer) => {
    buffer += data.toString();

    // Process complete JSON lines
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      const parsed = parseLine(line);
      if (!parsed) continue;

      const { type, data: d } = parsed;

      // Handle tool calls
      if (type === "assistant") {
        const msg = d as { message: { content: unknown[] } };
        if (msg.message?.content) {
          for (const block of msg.message.content) {
            if (block && typeof block === "object" && (block as any).type === "tool_use") {
              const tool = (block as any);
              const toolCall: ToolCall = {
                name: tool.name,
                input: tool.input,
                id: tool.id,
              };
              callbacks.onToolCall?.(toolCall);
            }
          }
        }
      }

      // Handle tool results
      if (type === "user") {
        const msg = d as { message: { content: unknown[] } };
        if (msg.message?.content) {
          for (const block of msg.message.content) {
            if (block && typeof block === "object" && (block as any).type === "tool_result") {
              const result = (block as any);
              callbacks.onToolResult?.({
                toolUseId: result.tool_use_id,
                content: result.content,
                isError: result.is_error,
              });
            }
          }
        }
      }

      // Handle text chunks
      if (type === "content" && (d as { subtype: string }).subtype === "text") {
        const text = (d as { content: { text: string } }).content?.text;
        if (text) {
          callbacks.onChunk?.(text);
          finalResult += text;
        }
      }
    }
  });

  // Process stderr (for debugging)
  proc.stderr?.on("data", (data: Buffer) => {
    const text = data.toString();
    // Log debug info
    if (text.includes("tool_use") || text.includes("result")) {
      log.debug({ text }, "Claude Code debug");
    }
  });

  // Handle process completion
  await new Promise<void>((resolve, reject) => {
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Claude Code exited with code ${code}`));
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });

  // Yield final result
  if (finalResult) {
    callbacks.onResult?.(finalResult);
    yield finalResult;
  }
}

/**
 * Run Claude Code and get full result (non-streaming)
 */
export async function runClaudeCodeSync(
  prompt: string,
  options: ClaudeRunnerOptions = {}
): Promise<string> {
  let result = "";

  for await (const chunk of runClaudeCode(prompt, options, {
    onChunk: (text) => {
      result += text;
    },
  })) {
    // Just consume the generator
  }

  return result;
}

/**
 * Check if Claude Code is available
 */
export function isClaudeCodeAvailable(): boolean {
  try {
    require("child_process").execSync("claude --version", {
      stdio: "ignore",
      env: { ...process.env, CLAUDECODE: "" },
    });
    return true;
  } catch {
    return false;
  }
}
