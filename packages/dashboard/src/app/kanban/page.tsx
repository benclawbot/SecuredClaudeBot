"use client";

import { useSocket } from "@/lib/socket";

export default function KanbanPage() {
  const { connected } = useSocket();

  return (
    <div className="p-6">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-2xl font-bold mb-6">Agent Kanban</h2>

        <div className="grid grid-cols-3 gap-4 min-h-[60vh]">
          {/* Pending Column */}
          <KanbanColumn title="Pending" color="yellow" count={0}>
            <EmptyState text="No pending tasks" />
          </KanbanColumn>

          {/* Active Column */}
          <KanbanColumn title="Active" color="blue" count={0}>
            <EmptyState text="No active tasks" />
          </KanbanColumn>

          {/* Done Column */}
          <KanbanColumn title="Done" color="emerald" count={0}>
            <EmptyState text="No completed tasks" />
          </KanbanColumn>
        </div>

        <p className="text-xs text-zinc-600 text-center mt-6">
          Agent tasks will appear here once the orchestrator is active (Phase 7).
        </p>
      </div>
    </div>
  );
}

function KanbanColumn({
  title,
  color,
  count,
  children,
}: {
  title: string;
  color: string;
  count: number;
  children: React.ReactNode;
}) {
  const colors: Record<string, string> = {
    yellow: "border-yellow-500/20",
    blue: "border-blue-500/20",
    emerald: "border-emerald-500/20",
  };
  const dotColors: Record<string, string> = {
    yellow: "bg-yellow-400",
    blue: "bg-blue-400",
    emerald: "bg-emerald-400",
  };

  return (
    <div
      className={`bg-zinc-900 rounded-lg border ${colors[color] ?? "border-zinc-800"} p-4`}
    >
      <div className="flex items-center gap-2 mb-4">
        <div className={`w-2 h-2 rounded-full ${dotColors[color] ?? "bg-zinc-600"}`} />
        <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
        <span className="text-xs text-zinc-500 ml-auto bg-zinc-800 px-2 py-0.5 rounded-full">
          {count}
        </span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="border border-dashed border-zinc-800 rounded-md py-12 text-center">
      <p className="text-xs text-zinc-600">{text}</p>
    </div>
  );
}
