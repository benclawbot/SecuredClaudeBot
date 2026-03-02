"use client";

import { useStatus } from "@/lib/hooks";
import Link from "next/link";

export default function Home() {
  const { status, connected } = useStatus();

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h}h ${m}m ${s}s`;
  };

  return (
    <div className="p-6">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold mb-6">Dashboard Overview</h2>

        {/* Status Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatusCard
            title="Gateway"
            value={connected ? "Online" : "Offline"}
            color={connected ? "emerald" : "red"}
          />
          <StatusCard
            title="Sessions"
            value={String(status?.sessions ?? 0)}
            color="blue"
          />
          <StatusCard
            title="Uptime"
            value={status ? formatUptime(status.uptime) : "--"}
            color="violet"
          />
          <StatusCard
            title="Memory"
            value={status ? `${status.memoryMB} MB` : "--"}
            color="amber"
          />
        </div>

        {/* Subsystem Status */}
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Subsystems</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {status?.subsystems
              ? Object.entries(status.subsystems).map(([name, state]) => (
                  <div
                    key={name}
                    className="flex items-center gap-2 bg-zinc-800/50 rounded-md px-3 py-2"
                  >
                    <div
                      className={`w-2 h-2 rounded-full ${
                        state === "online" || state === "connected"
                          ? "bg-emerald-400"
                          : state === "pending"
                            ? "bg-yellow-400"
                            : "bg-zinc-600"
                      }`}
                    />
                    <span className="text-sm capitalize text-zinc-300">
                      {name}
                    </span>
                    <span className="text-xs text-zinc-500 ml-auto capitalize">
                      {state}
                    </span>
                  </div>
                ))
              : Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="bg-zinc-800/50 rounded-md px-3 py-2 animate-pulse h-10"
                  />
                ))}
          </div>
        </div>

        {/* Quick Links */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <QuickLink
            href="/chat"
            title="Open Chat"
            description="Claude Code-style streaming conversation"
          />
          <QuickLink
            href="/status"
            title="System Status"
            description="Health checks and security events"
          />
          <QuickLink
            href="/settings"
            title="Settings"
            description="Configure API keys, LLM, and security"
          />
        </div>
      </div>
    </div>
  );
}

function StatusCard({
  title,
  value,
  color,
}: {
  title: string;
  value: string;
  color: string;
}) {
  const colors: Record<string, string> = {
    emerald: "text-emerald-400 border-emerald-400/20",
    blue: "text-blue-400 border-blue-400/20",
    yellow: "text-yellow-400 border-yellow-400/20",
    red: "text-red-400 border-red-400/20",
    violet: "text-violet-400 border-violet-400/20",
    amber: "text-amber-400 border-amber-400/20",
  };

  const cls = colors[color] ?? "text-zinc-400 border-zinc-800";

  return (
    <div className={`bg-zinc-900 rounded-lg border p-4 ${cls}`}>
      <p className="text-xs text-zinc-500 uppercase tracking-wider">{title}</p>
      <p className={`text-xl font-mono font-bold mt-1 ${cls.split(" ")[0]}`}>
        {value}
      </p>
    </div>
  );
}

function QuickLink({
  href,
  title,
  description,
}: {
  href: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="bg-zinc-900 rounded-lg border border-zinc-800 p-4 hover:border-zinc-700 hover:bg-zinc-800/50 transition-colors group"
    >
      <h4 className="text-sm font-semibold text-zinc-200 group-hover:text-emerald-400 transition-colors">
        {title}
      </h4>
      <p className="text-xs text-zinc-500 mt-1">{description}</p>
    </Link>
  );
}
