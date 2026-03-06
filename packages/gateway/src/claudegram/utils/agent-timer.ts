/**
 * Agent timer utility for tracking elapsed time during agent queries.
 * Provides human-readable duration formatting and timing state management.
 */

export interface AgentTimer {
  startTime: number;
  lastMessageTime: number;
  messageCount: number;
}

/**
 * Create a new agent timer initialized to the current time.
 */
export function createAgentTimer(): AgentTimer {
  const now = Date.now();
  return {
    startTime: now,
    lastMessageTime: now,
    messageCount: 0,
  };
}

/**
 * Record that a message was received, updating the last message time.
 */
export function recordMessage(timer: AgentTimer): void {
  timer.lastMessageTime = Date.now();
  timer.messageCount++;
}

/**
 * Get elapsed milliseconds since timer start.
 */
export function getElapsedMs(timer: AgentTimer): number {
  return Date.now() - timer.startTime;
}

/**
 * Get milliseconds since last message was recorded.
 */
export function getSinceLastMessageMs(timer: AgentTimer): number {
  return Date.now() - timer.lastMessageTime;
}

/**
 * Format a duration in milliseconds to human-readable string.
 * Examples: "0s", "45s", "1m 30s", "2m 0s"
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

/**
 * Get a timing report string for logging.
 */
export function getTimingReport(timer: AgentTimer): string {
  const elapsed = formatDuration(getElapsedMs(timer));
  return `${elapsed} elapsed, ${timer.messageCount} messages`;
}
