"use client";

import { useSocket } from "@/lib/socket";
import { useEffect, useState } from "react";
import type { UsageTotals, UsageRecord } from "@/lib/types";

interface ProviderUsage {
  [provider: string]: UsageTotals;
}

export default function UsagePage() {
  const { socket, connected } = useSocket();
  const [totals, setTotals] = useState<UsageTotals | null>(null);
  const [byProvider, setByProvider] = useState<ProviderUsage>({});
  const [records, setRecords] = useState<UsageRecord[]>([]);

  useEffect(() => {
    if (!socket || !connected) return;

    socket.emit("usage:request");

    socket.on(
      "usage:data",
      (data: {
        totals: UsageTotals;
        byProvider: ProviderUsage;
        records: UsageRecord[];
      }) => {
        setTotals(data.totals);
        setByProvider(data.byProvider);
        setRecords(data.records);
      }
    );

    // Refresh every 10 seconds
    const interval = setInterval(() => socket.emit("usage:request"), 10_000);

    return () => {
      socket.off("usage:data");
      clearInterval(interval);
    };
  }, [socket, connected]);

  const formatCost = (usd: number) => {
    if (usd < 0.01) return `$${usd.toFixed(6)}`;
    if (usd < 1) return `$${usd.toFixed(4)}`;
    return `$${usd.toFixed(2)}`;
  };

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  return (
    <div className="p-6">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold mb-6">Usage & Costs</h2>

        {/* Totals */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Total Calls"
            value={String(totals?.calls ?? 0)}
            color="blue"
          />
          <StatCard
            label="Tokens In"
            value={formatTokens(totals?.tokensIn ?? 0)}
            color="violet"
          />
          <StatCard
            label="Tokens Out"
            value={formatTokens(totals?.tokensOut ?? 0)}
            color="amber"
          />
          <StatCard
            label="Total Cost"
            value={formatCost(totals?.costUsd ?? 0)}
            color="emerald"
          />
        </div>

        {/* By Provider */}
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">By Provider</h3>
          {Object.keys(byProvider).length > 0 ? (
            <div className="space-y-3">
              {Object.entries(byProvider).map(([provider, usage]) => (
                <div
                  key={provider}
                  className="flex items-center justify-between bg-zinc-800/40 rounded-md px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <ProviderIcon provider={provider} />
                    <div>
                      <span className="text-sm font-medium capitalize text-zinc-200">
                        {provider}
                      </span>
                      <span className="text-xs text-zinc-500 ml-2">
                        {usage.calls} call{usage.calls !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-6 text-xs">
                    <span className="text-zinc-400">
                      {formatTokens(usage.tokensIn)} in /{" "}
                      {formatTokens(usage.tokensOut)} out
                    </span>
                    <span className="text-emerald-400 font-mono font-medium">
                      {formatCost(usage.costUsd)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-zinc-500 text-sm text-center py-6">
              No usage data yet. Start chatting to see usage statistics.
            </p>
          )}
        </div>

        {/* Recent Calls */}
        <div className="bg-zinc-900 rounded-lg border border-zinc-800 p-6">
          <h3 className="text-lg font-semibold mb-4">Recent Calls</h3>
          {records.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-zinc-500 border-b border-zinc-800">
                    <th className="text-left py-2 pr-4">Time</th>
                    <th className="text-left py-2 pr-4">Provider</th>
                    <th className="text-left py-2 pr-4">Model</th>
                    <th className="text-right py-2 pr-4">Tokens In</th>
                    <th className="text-right py-2 pr-4">Tokens Out</th>
                    <th className="text-right py-2">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {records
                    .slice()
                    .reverse()
                    .slice(0, 50)
                    .map((rec, i) => (
                      <tr
                        key={`${rec.timestamp}-${i}`}
                        className="border-b border-zinc-800/50 text-zinc-300"
                      >
                        <td className="py-2 pr-4 text-zinc-500 font-mono">
                          {new Date(rec.timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </td>
                        <td className="py-2 pr-4 capitalize">{rec.provider}</td>
                        <td className="py-2 pr-4 text-zinc-400 font-mono text-[11px]">
                          {rec.model}
                        </td>
                        <td className="py-2 pr-4 text-right font-mono">
                          {formatTokens(rec.tokensIn)}
                        </td>
                        <td className="py-2 pr-4 text-right font-mono">
                          {formatTokens(rec.tokensOut)}
                        </td>
                        <td className="py-2 text-right font-mono text-emerald-400">
                          {formatCost(rec.costUsd)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-zinc-500 text-sm text-center py-6">
              No calls recorded yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
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

function ProviderIcon({ provider }: { provider: string }) {
  const colors: Record<string, string> = {
    anthropic: "bg-orange-500/20 text-orange-400",
    openai: "bg-green-500/20 text-green-400",
    google: "bg-blue-500/20 text-blue-400",
    ollama: "bg-violet-500/20 text-violet-400",
  };

  return (
    <div
      className={`w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold ${
        colors[provider] ?? "bg-zinc-700 text-zinc-400"
      }`}
    >
      {provider.slice(0, 2).toUpperCase()}
    </div>
  );
}
