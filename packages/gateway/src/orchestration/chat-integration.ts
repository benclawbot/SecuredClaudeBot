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
## Orchestration Capabilities

You have access to an agent orchestration system that can delegate complex tasks to specialized sub-agents.

**When to use orchestration:**
- When the user requests multiple things that need separate tracking
- When a complex project needs structured workflow management
- When you want to track progress across multiple steps
- When the task requires multiple specialized agents working together

**How to use:**
1. Acknowledge the request and explain you'll set up orchestration
2. Use the delegation feature to create tasks in the orchestration system
3. The user can then monitor progress via the Kanban board

**You can delegate:**
- Brainstorming and idea generation
- Infrastructure planning and architecture
- User story creation
- Code implementation
- Testing and validation

When you want to delegate, tell the user you're starting an orchestration workflow and ask if they'd like to proceed.
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
