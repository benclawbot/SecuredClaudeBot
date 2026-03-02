import { describe, it, expect, beforeEach, vi } from "vitest";
import { WorkflowEngine } from "./engine.js";

function mockAudit() {
  return { log: vi.fn(), query: vi.fn(() => []) } as any;
}

const SAMPLE_YAML = `
id: wf-test
name: Test Workflow
description: A test workflow
variables:
  greeting: Hello
steps:
  - name: step1
    action: echo
    params:
      message: "{{greeting}} World"
  - name: step2
    action: echo
    params:
      message: "Step 2"
  - name: step3
    action: echo
    params:
      message: "Conditional"
    condition: "flag == true"
`;

describe("WorkflowEngine", () => {
  let engine: WorkflowEngine;

  beforeEach(() => {
    engine = new WorkflowEngine(mockAudit());
    engine.registerAction("echo", async (params) => {
      return { echoed: params.message };
    });
  });

  describe("loadFromYaml", () => {
    it("parses a YAML workflow", () => {
      const def = engine.loadFromYaml(SAMPLE_YAML);
      expect(def.id).toBe("wf-test");
      expect(def.name).toBe("Test Workflow");
      expect(def.steps).toHaveLength(3);
      expect(def.variables.greeting).toBe("Hello");
    });
  });

  describe("execute", () => {
    it("runs all steps sequentially", async () => {
      engine.loadFromYaml(SAMPLE_YAML);
      const run = await engine.execute("wf-test");

      expect(run.status).toBe("completed");
      expect(run.results).toHaveLength(3);
      expect(run.results[0].status).toBe("completed");
      expect(run.results[0].output).toEqual({ echoed: "Hello World" });
    });

    it("resolves variables in params", async () => {
      engine.loadFromYaml(SAMPLE_YAML);
      const run = await engine.execute("wf-test", { greeting: "Hi" });

      expect(run.results[0].output).toEqual({ echoed: "Hi World" });
    });

    it("skips steps when condition is not met", async () => {
      engine.loadFromYaml(SAMPLE_YAML);
      const run = await engine.execute("wf-test");

      // step3 has condition "flag == true" but flag is not set
      expect(run.results[2].status).toBe("skipped");
    });

    it("runs conditional step when condition is met", async () => {
      engine.loadFromYaml(SAMPLE_YAML);
      const run = await engine.execute("wf-test", { flag: "true" });

      expect(run.results[2].status).toBe("completed");
    });

    it("handles action failure with onError=stop", async () => {
      const yaml = `
id: wf-fail
name: Fail Workflow
steps:
  - name: boom
    action: fail_action
    params: {}
    onError: stop
  - name: never
    action: echo
    params:
      message: should not run
`;
      engine.registerAction("fail_action", async () => {
        throw new Error("kaboom");
      });
      engine.loadFromYaml(yaml);
      const run = await engine.execute("wf-fail");

      expect(run.status).toBe("failed");
      expect(run.results).toHaveLength(1);
      expect(run.results[0].status).toBe("failed");
      expect(run.results[0].error).toBe("kaboom");
    });

    it("skips failed step with onError=skip", async () => {
      const yaml = `
id: wf-skip
name: Skip Workflow
steps:
  - name: soft_fail
    action: fail_action
    params: {}
    onError: skip
  - name: continues
    action: echo
    params:
      message: I ran
`;
      engine.registerAction("fail_action", async () => {
        throw new Error("oops");
      });
      engine.loadFromYaml(yaml);
      const run = await engine.execute("wf-skip");

      expect(run.status).toBe("completed");
      expect(run.results[0].status).toBe("skipped");
      expect(run.results[1].status).toBe("completed");
    });

    it("retries failed steps", async () => {
      let attempt = 0;
      engine.registerAction("flaky", async () => {
        attempt++;
        if (attempt < 3) throw new Error("not yet");
        return "success";
      });

      const yaml = `
id: wf-retry
name: Retry Workflow
steps:
  - name: flaky_step
    action: flaky
    params: {}
    retries: 3
`;
      engine.loadFromYaml(yaml);
      const run = await engine.execute("wf-retry");

      expect(run.status).toBe("completed");
      expect(run.results[0].output).toBe("success");
    });
  });

  describe("listRuns", () => {
    it("lists workflow runs", async () => {
      engine.loadFromYaml(SAMPLE_YAML);
      await engine.execute("wf-test");
      await engine.execute("wf-test");

      expect(engine.listRuns()).toHaveLength(2);
    });
  });
});
