/**
 * YAML Workflow Engine — define and execute multi-step pipelines.
 * Steps run sequentially with conditional branching and variable passing.
 */
import yaml from "js-yaml";
import { createChildLogger } from "../logger/index.js";
import type { AuditLog } from "../logger/audit.js";

const log = createChildLogger("workflows");

export interface WorkflowStep {
  name: string;
  action: string;
  params: Record<string, unknown>;
  condition?: string;
  onError?: "stop" | "skip" | "retry";
  retries?: number;
}

export interface WorkflowDef {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  variables: Record<string, unknown>;
}

export type StepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface StepResult {
  step: string;
  status: StepStatus;
  output?: unknown;
  error?: string;
  durationMs: number;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: "running" | "completed" | "failed";
  results: StepResult[];
  variables: Record<string, unknown>;
  startedAt: number;
  completedAt?: number;
}

type ActionHandler = (
  params: Record<string, unknown>,
  vars: Record<string, unknown>
) => Promise<unknown>;

/**
 * Workflow engine that parses YAML definitions and runs step pipelines.
 */
export class WorkflowEngine {
  private workflows = new Map<string, WorkflowDef>();
  private runs = new Map<string, WorkflowRun>();
  private actions = new Map<string, ActionHandler>();
  private audit: AuditLog;
  private runCounter = 0;

  constructor(audit: AuditLog) {
    this.audit = audit;
    log.info("Workflow engine initialized");
  }

  /**
   * Register an action handler (e.g., "llm.generate", "shell.exec", "http.fetch").
   */
  registerAction(name: string, handler: ActionHandler): void {
    this.actions.set(name, handler);
    log.debug({ action: name }, "Action registered");
  }

  /**
   * Load a workflow from a YAML string.
   */
  loadFromYaml(yamlStr: string): WorkflowDef {
    const raw = yaml.load(yamlStr) as Record<string, unknown>;

    const def: WorkflowDef = {
      id: String(raw.id ?? `wf-${Date.now()}`),
      name: String(raw.name ?? "Untitled"),
      description: String(raw.description ?? ""),
      steps: ((raw.steps as unknown[]) ?? []).map((s: any) => ({
        name: String(s.name ?? ""),
        action: String(s.action ?? ""),
        params: (s.params as Record<string, unknown>) ?? {},
        condition: s.condition ? String(s.condition) : undefined,
        onError: s.onError ?? "stop",
        retries: Number(s.retries ?? 0),
      })),
      variables: (raw.variables as Record<string, unknown>) ?? {},
    };

    this.workflows.set(def.id, def);
    log.info({ id: def.id, name: def.name, steps: def.steps.length }, "Workflow loaded");
    return def;
  }

  /**
   * List registered workflows.
   */
  listWorkflows(): WorkflowDef[] {
    return Array.from(this.workflows.values());
  }

  /**
   * Execute a workflow by ID.
   */
  async execute(workflowId: string, inputVars: Record<string, unknown> = {}): Promise<WorkflowRun> {
    const def = this.workflows.get(workflowId);
    if (!def) throw new Error(`Unknown workflow: ${workflowId}`);

    const runId = `run-${++this.runCounter}`;
    const run: WorkflowRun = {
      id: runId,
      workflowId,
      status: "running",
      results: [],
      variables: { ...def.variables, ...inputVars },
      startedAt: Date.now(),
    };

    this.runs.set(runId, run);

    this.audit.log({
      event: "agent.spawned",
      actor: "workflow",
      detail: `Workflow started: ${def.name} (${runId})`,
    });

    try {
      for (const step of def.steps) {
        const result = await this.executeStep(step, run);
        run.results.push(result);

        if (result.status === "failed" && step.onError === "stop") {
          run.status = "failed";
          break;
        }
      }

      if (run.status === "running") {
        run.status = "completed";
      }
    } catch (err) {
      run.status = "failed";
      log.error({ runId, err }, "Workflow execution failed");
    }

    run.completedAt = Date.now();

    this.audit.log({
      event: run.status === "completed" ? "agent.completed" : "agent.failed",
      actor: "workflow",
      detail: `Workflow ${run.status}: ${def.name} (${run.results.length} steps, ${run.completedAt - run.startedAt}ms)`,
    });

    return run;
  }

  /**
   * Get a workflow run by ID.
   */
  getRun(runId: string): WorkflowRun | undefined {
    return this.runs.get(runId);
  }

  /**
   * List recent runs.
   */
  listRuns(limit = 20): WorkflowRun[] {
    return Array.from(this.runs.values())
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }

  // ── Private ──

  private async executeStep(
    step: WorkflowStep,
    run: WorkflowRun
  ): Promise<StepResult> {
    const start = Date.now();

    // Check condition
    if (step.condition) {
      const conditionMet = this.evaluateCondition(step.condition, run.variables);
      if (!conditionMet) {
        return {
          step: step.name,
          status: "skipped",
          durationMs: Date.now() - start,
        };
      }
    }

    // Find action handler
    const handler = this.actions.get(step.action);
    if (!handler) {
      return {
        step: step.name,
        status: "failed",
        error: `Unknown action: ${step.action}`,
        durationMs: Date.now() - start,
      };
    }

    // Resolve variable references in params
    const resolvedParams = this.resolveParams(step.params, run.variables);

    // Execute with optional retries
    const maxAttempts = (step.retries ?? 0) + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const output = await handler(resolvedParams, run.variables);

        // Store output in variables for subsequent steps
        run.variables[`${step.name}.output`] = output;

        return {
          step: step.name,
          status: "completed",
          output,
          durationMs: Date.now() - start,
        };
      } catch (err) {
        if (attempt === maxAttempts) {
          const msg = err instanceof Error ? err.message : String(err);

          if (step.onError === "skip") {
            return {
              step: step.name,
              status: "skipped",
              error: msg,
              durationMs: Date.now() - start,
            };
          }

          return {
            step: step.name,
            status: "failed",
            error: msg,
            durationMs: Date.now() - start,
          };
        }

        log.warn(
          { step: step.name, attempt, maxAttempts },
          "Step failed, retrying"
        );
      }
    }

    // Should never reach here
    return {
      step: step.name,
      status: "failed",
      error: "Exhausted retries",
      durationMs: Date.now() - start,
    };
  }

  /**
   * Simple condition evaluation: supports "var == value" and "var != value".
   */
  private evaluateCondition(
    condition: string,
    vars: Record<string, unknown>
  ): boolean {
    const eqMatch = condition.match(/^(\S+)\s*==\s*(.+)$/);
    if (eqMatch) {
      return String(vars[eqMatch[1]!]) === eqMatch[2]!.trim();
    }

    const neqMatch = condition.match(/^(\S+)\s*!=\s*(.+)$/);
    if (neqMatch) {
      return String(vars[neqMatch[1]!]) !== neqMatch[2]!.trim();
    }

    // Truthy check
    return !!vars[condition];
  }

  /**
   * Resolve `{{variable}}` references in params.
   */
  private resolveParams(
    params: Record<string, unknown>,
    vars: Record<string, unknown>
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string") {
        resolved[key] = value.replace(/\{\{(\S+?)\}\}/g, (_, varName) =>
          String(vars[varName] ?? "")
        );
      } else {
        resolved[key] = value;
      }
    }

    return resolved;
  }
}
