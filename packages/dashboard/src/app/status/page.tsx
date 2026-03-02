"use client";

import { useStatus } from "@/lib/hooks";
import { useSocket } from "@/lib/socket";
import { useEffect, useState } from "react";

interface AuditEntry {
  id: number;
  event: string;
  actor: string;
  detail: string;
  ts: number;
}

export default function StatusPage() {
  const { status, connected } = useStatus(3000);
  const { socket } = useSocket();
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);

  // Request recent audit events
  useEffect(() => {
    if (!socket || !connected) return;

    socket.emit("audit:request", { limit: 50 });
    socket.on("audit:entries", (entries: AuditEntry[]) => {
      setAuditLog(entries);
    });

    return () => {
      socket.off("audit:entries");
    };
  }, [socket, connected]);

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
  };

  return (
    <div className="p-6">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold mb-6">System Status</h2>

        {/* Connection Banner */}
        {!connected && (
          <div className="bg-red-900/20 border border-red-500/20 rounded-lg p-4 mb-6 flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-red-400 animate-pulse" />
            <span className="text-red-300 text-sm">
              Gateway disconnected. Attempting to reconnect...
            </span>
          </div>
        )}

        {/* Main Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <MetricCard
            label="Status"
            value={connected ? "Online" : "Offline"}
            color={connected ? "emerald" : "red"}
          />
          <MetricCard
            label="Uptime"
            value={status ? formatUptime(status.uptime) : "--"}
            color="violet"
          />
          <MetricCard
            label="Active Sessions"
            value={String(status?.sessions ?? "--")}
            color="blue"
          />
          <MetricCard
            label="Heap Memory"
            value={status ? `${status.memoryMB} MB` : "--"}
            color="amber"
          />
        </div>

        {/* Subsystems */}
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Subsystems</h3>
          <div className="space-y-3">
            {status?.subsystems ? (
              Object.entries(status.subsystems).map(([name, state]) => (
                <SubsystemRow key={name} name={name} state={state} />
              ))
            ) : (
              <div className="text-zinc-500 text-sm">
                Waiting for status data...
              </div>
            )}
          </div>
        </div>

        {/* Security Audit Log */}
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
          <h3 className="text-lg font-semibold mb-4">Security Audit Log</h3>
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {auditLog.length > 0 ? (
              auditLog.map((entry) => (
                <AuditRow key={entry.id} entry={entry} />
              ))
            ) : (
              <div className="text-zinc-500 text-sm py-4 text-center">
                {connected
                  ? "No recent audit events"
                  : "Connect to gateway to view audit log"}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  const colors: Record<string, string> = {
    emerald: "text-emerald-400 border-emerald-400/20",
    red: "text-red-400 border-red-400/20",
    blue: "text-blue-400 border-blue-400/20",
    violet: "text-violet-400 border-violet-400/20",
    amber: "text-amber-400 border-amber-400/20",
  };
  const cls = colors[color] ?? "";

  return (
    <div className={`bg-zinc-900 rounded-lg border p-4 ${cls}`}>
      <p className="text-xs text-zinc-500 uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-mono font-bold mt-1 ${cls.split(" ")[0]}`}>
        {value}
      </p>
    </div>
  );
}

function SubsystemRow({ name, state }: { name: string; state: string }) {
  const stateColors: Record<string, string> = {
    online: "bg-emerald-400",
    connected: "bg-emerald-400",
    pending: "bg-yellow-400",
    offline: "bg-red-400",
    error: "bg-red-400",
    unknown: "bg-zinc-600",
  };

  return (
    <div className="flex items-center justify-between bg-zinc-800/40 rounded-md px-4 py-3">
      <div className="flex items-center gap-3">
        <div
          className={`w-2.5 h-2.5 rounded-full ${stateColors[state] ?? "bg-zinc-600"}`}
        />
        <span className="text-sm font-medium capitalize text-zinc-200">
          {name}
        </span>
      </div>
      <span
        className={`text-xs px-2 py-0.5 rounded-full capitalize ${
          state === "online" || state === "connected"
            ? "bg-emerald-400/10 text-emerald-400"
            : state === "pending"
              ? "bg-yellow-400/10 text-yellow-400"
              : state === "error" || state === "offline"
                ? "bg-red-400/10 text-red-400"
                : "bg-zinc-700 text-zinc-400"
        }`}
      >
        {state}
      </span>
    </div>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const time = new Date(entry.ts).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const isSecurityEvent = entry.event.startsWith("security.");

  return (
    <div
      className={`flex items-start gap-3 px-3 py-2 rounded text-xs font-mono ${
        isSecurityEvent ? "bg-red-900/10" : "bg-zinc-800/30"
      }`}
    >
      <span className="text-zinc-600 shrink-0 w-36">{time}</span>
      <span
        className={`shrink-0 w-40 ${
          isSecurityEvent ? "text-red-400" : "text-zinc-400"
        }`}
      >
        {entry.event}
      </span>
      <span className="text-zinc-500 shrink-0 w-20 truncate">
        {entry.actor}
      </span>
      <span className="text-zinc-400 truncate">{entry.detail}</span>
    </div>
  );
}
