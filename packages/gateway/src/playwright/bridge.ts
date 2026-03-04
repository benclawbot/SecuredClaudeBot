/**
 * Playwright Bridge — communicates with the sandboxed Playwright worker
 * process via JSON-RPC over stdin/stdout.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createChildLogger } from "../logger/index.js";
import { isUrlSafe } from "../security/ssrf.js";
import type { AuditLog } from "../logger/audit.js";

const log = createChildLogger("playwright:bridge");

interface TaskRequest {
  id: string;
  type: "scrape" | "automate" | "screenshot";
  url: string;
  actions?: Array<{ action: string; selector?: string; value?: string }>;
}

interface TaskResult {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

type PendingCallback = {
  resolve: (result: TaskResult) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Bridge to the Playwright worker process.
 */
export class PlaywrightBridge {
  private worker: ChildProcess | null = null;
  private pending = new Map<string, PendingCallback>();
  private buffer = "";
  private ready = false;
  private idCounter = 0;
  private audit: AuditLog;
  private taskTimeoutMs: number;

  constructor(audit: AuditLog, taskTimeoutMs = 30_000) {
    this.audit = audit;
    this.taskTimeoutMs = taskTimeoutMs;
  }

  /**
   * Start the Playwright worker process.
   */
  async start(): Promise<void> {
    if (this.worker) return;

    // Use tsx to run the worker with ESM
    this.worker = spawn("npx", ["tsx", "packages/playwright/src/worker.ts"], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: process.cwd(),
      shell: true,
    });

    this.worker.stdout?.setEncoding("utf8");
    this.worker.stderr?.setEncoding("utf8");

    this.worker.stdout?.on("data", (chunk: string) => {
      this.buffer += chunk;
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.ready) {
            this.ready = true;
            log.info("Playwright worker ready");
            continue;
          }
          this.handleResult(msg as TaskResult);
        } catch {
          log.warn({ line }, "Invalid JSON from worker");
        }
      }
    });

    this.worker.stderr?.on("data", (data: string) => {
      log.warn({ stderr: data.trim() }, "Playwright worker stderr");
    });

    this.worker.on("exit", (code) => {
      log.warn({ code }, "Playwright worker exited");
      this.ready = false;
      this.worker = null;

      // Reject all pending tasks
      for (const [id, cb] of this.pending) {
        clearTimeout(cb.timer);
        cb.reject(new Error("Playwright worker exited"));
      }
      this.pending.clear();
    });

    // Wait for ready signal
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Worker start timeout")), 15_000);
      const check = setInterval(() => {
        if (this.ready) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve();
        }
      }, 100);
    });
  }

  /**
   * Scrape a URL — returns title and text content.
   */
  async scrape(url: string, actor: string): Promise<{ title: string; text: string }> {
    this.enforceUrlSafe(url, actor);
    const result = await this.send({ type: "scrape", url });
    return result.data as { title: string; text: string };
  }

  /**
   * Take a screenshot — returns base64 PNG.
   */
  async screenshot(url: string, actor: string): Promise<string> {
    this.enforceUrlSafe(url, actor);
    const result = await this.send({ type: "screenshot", url });
    return (result.data as { screenshot: string }).screenshot;
  }

  /**
   * Run automation actions on a page.
   */
  async automate(
    url: string,
    actions: Array<{ action: string; selector?: string; value?: string }>,
    actor: string
  ): Promise<string[]> {
    this.enforceUrlSafe(url, actor);
    const result = await this.send({ type: "automate", url, actions });
    return (result.data as { results: string[] }).results;
  }

  /**
   * Check if the worker is running and ready.
   */
  isReady(): boolean {
    return this.ready && this.worker !== null;
  }

  /**
   * Stop the worker process.
   */
  stop(): void {
    if (this.worker) {
      this.worker.kill("SIGTERM");
      this.worker = null;
      this.ready = false;
    }
  }

  // ── Private ──

  private enforceUrlSafe(url: string, actor: string): void {
    if (!isUrlSafe(url)) {
      this.audit.log({
        event: "security.ssrf_blocked",
        actor,
        detail: `Playwright SSRF blocked: ${url}`,
      });
      throw new Error(`URL blocked by SSRF policy: ${url}`);
    }
  }

  private send(req: Omit<TaskRequest, "id">): Promise<TaskResult> {
    if (!this.ready || !this.worker) {
      return Promise.reject(new Error("Playwright worker not ready"));
    }

    const id = `pw-${++this.idCounter}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Playwright task ${id} timed out`));
      }, this.taskTimeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.worker!.stdin!.write(JSON.stringify({ id, ...req }) + "\n");
    });
  }

  private handleResult(result: TaskResult): void {
    const cb = this.pending.get(result.id);
    if (!cb) {
      log.warn({ id: result.id }, "Received result for unknown task");
      return;
    }

    clearTimeout(cb.timer);
    this.pending.delete(result.id);

    if (result.success) {
      cb.resolve(result);
    } else {
      cb.reject(new Error(result.error ?? "Unknown error"));
    }
  }
}
