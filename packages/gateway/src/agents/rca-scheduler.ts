/**
 * RCA Scheduler - runs root cause analysis and lesson learning
 */
import { createChildLogger } from "../logger/index.js";
import { AgentsManager } from "./manager.js";
import type { AgentsConfig } from "../config/schema.js";

const log = createChildLogger("rca-scheduler");

export class RcaScheduler {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private agentsManager: AgentsManager;
  private config: AgentsConfig;

  constructor(agentsManager: AgentsManager, config: AgentsConfig = {} as AgentsConfig) {
    this.agentsManager = agentsManager;
    this.config = config || ({} as AgentsConfig);
  }

  /**
   * Start the RCA scheduler
   */
  start(): void {
    if (!this.config?.enableRcaCron) {
      log.info("RCA cron disabled");
      return;
    }

    // For simplicity, run every hour - in production would use cron syntax
    const intervalMs = (this.config?.autoSaveInterval || 5) * 60 * 1000;

    this.intervalId = setInterval(() => {
      this.runRca();
    }, intervalMs);

    log.info({ intervalMinutes: this.config?.autoSaveInterval || 5 }, "RCA scheduler started");
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      log.info("RCA scheduler stopped");
    }
  }

  /**
   * Run RCA analysis
   */
  private runRca(): void {
    log.debug("Running RCA analysis...");

    const agents = this.agentsManager.listAgents();

    for (const agent of agents) {
      if (agent.status !== "active") continue;

      // Check memories for issues/warnings
      const memories = this.agentsManager.readAgentFile(agent.id, "memories.md");
      if (memories && memories.includes("## Warnings")) {
        // Parse warnings and generate RCA
        this.analyzeAndLearn(agent.id, memories);
      }
    }
  }

  /**
   * Analyze issues and add lessons learned
   */
  private analyzeAndLearn(agentId: string, memories: string): void {
    // Simple pattern matching for warnings
    const warningPattern = /## Warnings\s*([\s\S]*?)(?=##|$)/g;
    const match = warningPattern.exec(memories);

    if (match && match[1]) {
      const warnings = match[1].trim();
      if (warnings) {
        // Add as root cause analysis
        this.agentsManager.addLessonLearned(agentId, "root_cause", `Identified in memories: ${warnings}`);
        log.info({ agentId, warnings }, "Added RCA from warnings");
      }
    }
  }

  /**
   * Manually trigger RCA
   */
  triggerRca(): void {
    this.runRca();
    log.info("Manual RCA triggered");
  }
}
