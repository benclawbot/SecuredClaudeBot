import { describe, it, expect, beforeEach, vi } from "vitest";
import { CronScheduler } from "./scheduler.js";

function mockAudit() {
  return { log: vi.fn(), query: vi.fn(() => []) } as any;
}

describe("CronScheduler", () => {
  let scheduler: CronScheduler;

  beforeEach(() => {
    scheduler = new CronScheduler(mockAudit());
  });

  afterAll(() => {
    scheduler.shutdown();
  });

  it("registers a job", () => {
    const job = scheduler.register("test1", "Test Job", "*/5 * * * *", () => {});
    expect(job.id).toBe("test1");
    expect(job.name).toBe("Test Job");
    expect(job.enabled).toBe(true);
    expect(job.runCount).toBe(0);
  });

  it("throws for duplicate job IDs", () => {
    scheduler.register("dup", "Job", "* * * * *", () => {});
    expect(() => scheduler.register("dup", "Job 2", "* * * * *", () => {})).toThrow(
      "already exists"
    );
  });

  it("lists registered jobs", () => {
    scheduler.register("j1", "Job 1", "*/5 * * * *", () => {});
    scheduler.register("j2", "Job 2", "0 * * * *", () => {});

    const jobs = scheduler.list();
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.id)).toContain("j1");
    expect(jobs.map((j) => j.id)).toContain("j2");
  });

  it("unregisters a job", () => {
    scheduler.register("rem", "Remove Me", "* * * * *", () => {});
    expect(scheduler.unregister("rem")).toBe(true);
    expect(scheduler.list()).toHaveLength(0);
  });

  it("returns false for unregistering unknown job", () => {
    expect(scheduler.unregister("nope")).toBe(false);
  });

  it("enables and disables a job", () => {
    scheduler.register("toggle", "Toggle", "* * * * *", () => {}, false);
    const job = scheduler.getJob("toggle")!;
    expect(job.enabled).toBe(false);

    scheduler.setEnabled("toggle", true);
    expect(scheduler.getJob("toggle")!.enabled).toBe(true);

    scheduler.setEnabled("toggle", false);
    expect(scheduler.getJob("toggle")!.enabled).toBe(false);
  });

  it("runs a job immediately with runNow", async () => {
    let ran = false;
    scheduler.register("now", "Run Now", "0 0 1 1 *", () => {
      ran = true;
    }, false); // Don't auto-start

    await scheduler.runNow("now");
    expect(ran).toBe(true);

    const job = scheduler.getJob("now")!;
    expect(job.runCount).toBe(1);
    expect(job.lastRun).toBeGreaterThan(0);
  });

  it("captures errors from job execution", async () => {
    scheduler.register("fail", "Failer", "0 0 1 1 *", () => {
      throw new Error("boom");
    }, false);

    await scheduler.runNow("fail");

    const job = scheduler.getJob("fail")!;
    expect(job.lastError).toBe("boom");
  });

  it("shuts down all jobs", () => {
    scheduler.register("s1", "Job 1", "* * * * *", () => {});
    scheduler.register("s2", "Job 2", "* * * * *", () => {});
    scheduler.shutdown(); // Should not throw
  });
});

function afterAll(fn: () => void) {
  // Simple cleanup — vitest handles this automatically
}
