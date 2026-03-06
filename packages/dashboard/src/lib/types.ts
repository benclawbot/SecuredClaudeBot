/** Shared types for the Mission Control dashboard */

export interface ChatMessage {
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
}

export interface SystemStatus {
  gateway: string;
  sessions: number;
  uptime: number;
  memoryMB: number;
  subsystems: Record<string, string>;
}

export interface UsageTotals {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  calls: number;
}

export interface UsageRecord {
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  sessionId: string;
  timestamp: number;
}
