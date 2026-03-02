"use client";

export default function WorkflowsPage() {
  return (
    <div className="p-6">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold mb-6">Workflows</h2>

        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-violet-500/10 flex items-center justify-center mx-auto mb-4">
            <span className="text-violet-400 text-2xl">&#9889;</span>
          </div>
          <h3 className="text-lg font-semibold text-zinc-300 mb-2">
            YAML Workflow Pipelines
          </h3>
          <p className="text-sm text-zinc-500 max-w-md mx-auto mb-4">
            Create and manage reusable task sequences with YAML-defined
            workflows. Define steps, conditions, and approvals.
          </p>
          <p className="text-xs text-zinc-600">
            Coming in Phase 13 — Workflow engine
          </p>
        </div>
      </div>
    </div>
  );
}
