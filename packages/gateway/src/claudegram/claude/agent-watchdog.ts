/**
 * Agent watchdog that monitors the SDK message loop for unresponsive behavior.
 * Logs warnings when no messages are received for extended periods.
 */

import { formatDuration } from '../utils/agent-timer.js';

export interface WatchdogOptions {
  chatId: string;
  warnAfterSeconds: number;
  logIntervalSeconds: number;
  timeoutMs?: number; // 0 or undefined = no hard timeout
  onWarning?: (sinceLastMessageMs: number, totalElapsedMs: number) => void;
  onTimeout?: () => void;
}

export class AgentWatchdog {
  private chatId: string;
  private warnAfterMs: number;
  private logIntervalMs: number;
  private timeoutMs: number;
  private onWarning?: (sinceLastMessageMs: number, totalElapsedMs: number) => void;
  private onTimeout?: () => void;

  private startTime: number = 0;
  private lastActivityTime: number = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private hasWarned: boolean = false;
  private stopped: boolean = false;

  constructor(options: WatchdogOptions) {
    this.chatId = options.chatId;
    this.warnAfterMs = options.warnAfterSeconds * 1000;
    this.logIntervalMs = options.logIntervalSeconds * 1000;
    this.timeoutMs = options.timeoutMs || 0;
    this.onWarning = options.onWarning;
    this.onTimeout = options.onTimeout;
  }

  /**
   * Start the watchdog timer.
   */
  start(): void {
    this.startTime = Date.now();
    this.lastActivityTime = this.startTime;
    this.hasWarned = false;
    this.stopped = false;

    this.intervalId = setInterval(() => {
      if (this.stopped) return;
      this.check();
    }, this.logIntervalMs);
  }

  /**
   * Record activity (message received from SDK).
   */
  recordActivity(messageType?: string): void {
    this.lastActivityTime = Date.now();
    this.hasWarned = false; // Reset warning state on activity
  }

  /**
   * Check if watchdog should fire warnings or timeout.
   */
  private check(): void {
    const now = Date.now();
    const sinceLastActivity = now - this.lastActivityTime;
    const totalElapsed = now - this.startTime;

    // Check hard timeout first
    if (this.timeoutMs > 0 && totalElapsed >= this.timeoutMs) {
      console.log(
        `[Claude] WATCHDOG TIMEOUT: No response after ${formatDuration(totalElapsed)}, chat:${this.chatId}`
      );
      this.onTimeout?.();
      this.stop();
      return;
    }

    // Check warning threshold
    if (sinceLastActivity >= this.warnAfterMs) {
      if (!this.hasWarned) {
        // First warning at threshold
        this.hasWarned = true;
        console.log(
          `[Claude] WATCHDOG WARNING: No messages for ${formatDuration(sinceLastActivity)} (total: ${formatDuration(totalElapsed)}), chat:${this.chatId}`
        );
        this.onWarning?.(sinceLastActivity, totalElapsed);
      } else {
        // Subsequent "still waiting" logs
        console.log(
          `[Claude] [${formatDuration(totalElapsed)}] WATCHDOG: Still waiting, no messages for ${formatDuration(sinceLastActivity)}, chat:${this.chatId}`
        );
      }
    } else {
      // Under threshold - just log elapsed time at trace level
      console.log(
        `[Claude] [${formatDuration(totalElapsed)}] WATCHDOG: Logging - still waiting for messages`
      );
    }
  }

  /**
   * Stop the watchdog timer.
   */
  stop(): void {
    this.stopped = true;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Get total elapsed time since start.
   */
  getElapsedMs(): number {
    return Date.now() - this.startTime;
  }
}
