/**
 * Cron Scheduler — runs tasks on a schedule using Croner.
 * Supports dynamic job registration, pausing, and audit logging.
 */
import { Cron, type CronOptions } from "croner";
import { createChildLogger } from "../logger/index.js";
import type { AuditLog } from "../logger/audit.js";

const log = createChildLogger("cron");

export interface ScheduledJob {
  id: string;
  name: string;
  pattern: string;
  enabled: boolean;
  lastRun?: number;
  nextRun?: number;
  runCount: number;
  lastError?: string;
}

type JobHandler = () => Promise<void> | void;

interface InternalJob {
  meta: ScheduledJob;
  handler: JobHandler;
  cron: Cron | null;
}

/**
 * Scheduler that wraps Croner for cron-based task execution.
 */
export class CronScheduler {
  private jobs = new Map<string, InternalJob>();
  private audit: AuditLog;

  constructor(audit: AuditLog) {
    this.audit = audit;
    log.info("Cron scheduler initialized");
  }

  /**
   * Register a new scheduled job.
   */
  register(
    id: string,
    name: string,
    pattern: string,
    handler: JobHandler,
    autoStart = true
  ): ScheduledJob {
    if (this.jobs.has(id)) {
      throw new Error(`Job already exists: ${id}`);
    }

    const meta: ScheduledJob = {
      id,
      name,
      pattern,
      enabled: autoStart,
      runCount: 0,
    };

    const job: InternalJob = {
      meta,
      handler,
      cron: null,
    };

    this.jobs.set(id, job);

    if (autoStart) {
      this.startJob(job);
    }

    log.info({ id, name, pattern, autoStart }, "Job registered");
    return { ...meta };
  }

  /**
   * Unregister and stop a job.
   */
  unregister(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;

    if (job.cron) {
      job.cron.stop();
    }

    this.jobs.delete(id);
    log.info({ id }, "Job unregistered");
    return true;
  }

  /**
   * Enable/disable a job.
   */
  setEnabled(id: string, enabled: boolean): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;

    if (enabled && !job.meta.enabled) {
      job.meta.enabled = true;
      this.startJob(job);
    } else if (!enabled && job.meta.enabled) {
      job.meta.enabled = false;
      if (job.cron) {
        job.cron.stop();
        job.cron = null;
      }
    }

    return true;
  }

  /**
   * Run a job immediately (outside its schedule).
   */
  async runNow(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Unknown job: ${id}`);

    await this.executeJob(job);
  }

  /**
   * List all registered jobs.
   */
  list(): ScheduledJob[] {
    return Array.from(this.jobs.values()).map((j) => {
      // Update next run from cron
      if (j.cron) {
        const next = j.cron.nextRun();
        j.meta.nextRun = next ? next.getTime() : undefined;
      }
      return { ...j.meta };
    });
  }

  /**
   * Get a specific job by ID.
   */
  getJob(id: string): ScheduledJob | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;

    if (job.cron) {
      const next = job.cron.nextRun();
      job.meta.nextRun = next ? next.getTime() : undefined;
    }

    return { ...job.meta };
  }

  /**
   * Stop all jobs (for shutdown).
   */
  shutdown(): void {
    for (const job of this.jobs.values()) {
      if (job.cron) {
        job.cron.stop();
        job.cron = null;
      }
    }
    log.info("Cron scheduler shut down");
  }

  // ── Private ──

  private startJob(job: InternalJob): void {
    if (job.cron) {
      job.cron.stop();
    }

    job.cron = new Cron(job.meta.pattern, {
      name: job.meta.id,
      catch: true,
    }, () => this.executeJob(job));

    const next = job.cron.nextRun();
    job.meta.nextRun = next ? next.getTime() : undefined;

    log.info({ id: job.meta.id, nextRun: job.meta.nextRun }, "Job started");
  }

  private async executeJob(job: InternalJob): Promise<void> {
    const start = Date.now();

    try {
      await job.handler();

      job.meta.lastRun = Date.now();
      job.meta.runCount++;
      job.meta.lastError = undefined;

      this.audit.log({
        event: "agent.completed",
        actor: "cron",
        detail: `Cron job completed: ${job.meta.name} (${Date.now() - start}ms)`,
      });

      log.info(
        { id: job.meta.id, durationMs: Date.now() - start },
        "Job executed"
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      job.meta.lastRun = Date.now();
      job.meta.lastError = msg;

      this.audit.log({
        event: "agent.failed",
        actor: "cron",
        detail: `Cron job failed: ${job.meta.name} — ${msg}`,
      });

      log.error({ id: job.meta.id, err: msg }, "Job execution failed");
    }
  }
}
