/**
 * Orchestration integration for chat
 * Allows the main agent to delegate tasks to the orchestration system
 */
import { createChildLogger } from "../logger/index.js";
import type { GatewayContext } from "../index.js";

const log = createChildLogger("orchestration:chat");

/**
 * System prompt addition that makes the LLM aware of orchestration capabilities
 */
export const ORCHESTRATION_SYSTEM_PROMPT = `
## Project Building (CRITICAL)

When a user asks you to BUILD something, CREATE something, or MAKE an application:
- Use the Write tool to CREATE FILES directly
- Create a folder structure in ./projects/{project-name}/
- Write all necessary files (index.html, app.py, etc.)
- Do NOT just describe the code - actually CREATE the files!

**How to build a project:**
1. Create folder: mkdir ./projects/{project-name}
2. Create files using Write tool
3. Tell user where files were created and how to run

Example: User says "build me a todo app"
→ Write to ./projects/todo-list/index.html with complete code
→ Write to ./projects/todo-list/style.css if needed
→ Write to ./projects/todo-list/script.js if needed

## Orchestration (for complex multi-agent tasks)

You also have access to an agent orchestration system for complex workflows.

**When to use orchestration:**
- When user wants multiple agents working in parallel
- When tracking progress via Kanban board
- For complex projects needing multiple specialized agents

**You can delegate:**
- Brainstorming and idea generation
- Infrastructure planning and architecture
- User story creation
- Testing and validation

For simple projects - just create files directly using Write tool!
`;

/**
 * Check if a message should trigger orchestration
 */
export function shouldTriggerOrchestration(message: string): boolean {
  const lower = message.toLowerCase();

  // Explicit commands
  if (lower.startsWith("/delegate") || lower.startsWith("/orchestrate")) {
    return true;
  }

  // Keywords that suggest complex multi-step tasks
  const orchestrationKeywords = [
    "build",
    "create a project",
    "build a project",
    "create a system",
    "implement a feature",
    "develop a",
    "work on multiple",
    "plan and execute",
    "manage a project",
    "track progress",
    "kanban",
    "workflow",
    "delegate to agents",
    "use multiple agents",
    "make an app",
    "build an app",
    "write code for",
  ];

  return orchestrationKeywords.some(keyword => lower.includes(keyword));
}

/**
 * Extract the request from a message (strip command prefix)
 */
export function extractOrchestrationRequest(message: string): string {
  // Remove command prefix if present
  let request = message.replace(/^\/(delegate|orchestrate)\s*/i, "");

  // If empty after removing command, use the full message
  if (!request.trim()) {
    request = message;
  }

  return request.trim();
}

/**
 * Trigger orchestration from a chat message
 */
export async function triggerOrchestration(
  ctx: GatewayContext,
  request: string,
  sessionId: string
): Promise<{ requestId: string; phase: string } | null> {
  try {
    const response = await fetch("http://127.0.0.1:18790/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request }),
    });

    if (!response.ok) {
      throw new Error(`Orchestration server returned ${response.status}`);
    }

    const data = await response.json() as { request_id: string; phase: string };

    log.info({ requestId: data.request_id, sessionId }, "Orchestration started from chat");

    return {
      requestId: data.request_id,
      phase: data.phase,
    };
  } catch (err) {
    log.error({ err, sessionId }, "Failed to trigger orchestration");
    return null;
  }
}

/**
 * Get current orchestration status
 */
export async function getOrchestrationStatus(): Promise<{
  phase: string;
  taskCount: number;
  userChangesPending: boolean;
} | null> {
  try {
    const response = await fetch("http://127.0.0.1:18790/status");
    if (!response.ok) return null;
    return await response.json() as { phase: string; taskCount: number; userChangesPending: boolean };
  } catch {
    return null;
  }
}

/**
 * Get the Kanban board
 */
export async function getKanbanBoard(): Promise<Record<string, unknown[]> | null> {
  try {
    const response = await fetch("http://127.0.0.1:18790/kanban");
    if (!response.ok) return null;
    return await response.json() as Record<string, unknown[]>;
  } catch {
    return null;
  }
}
