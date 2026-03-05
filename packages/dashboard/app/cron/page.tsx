"use client";

import { useState, useEffect } from "react";
import { useSocket } from "@/lib/socket";
import { Clock, Play, Database, CheckCircle, AlertCircle, Loader2, RefreshCw, Bug, Zap } from "lucide-react";

interface SelfImprovementReport {
  timestamp: number;
  focus: string;
  findings: string[];
  suggestions: string[];
  codeReferences: { file: string; line: number; suggestion: string }[];
}

interface CronStatus {
  enabled: boolean;
  times: string[];
  codebaseIndexed: boolean;
  codebaseStats: {
    indexed: boolean;
    files?: number;
    chunks?: number;
    indexedAt?: number;
  };
}

export default function CronJobsPage() {
  const { socket, connected } = useSocket();
  const [cronStatus, setCronStatus] = useState<CronStatus | null>(null);
  const [improvementReport, setImprovementReport] = useState<SelfImprovementReport | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isIndexing, setIsIndexing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!socket || !connected) return;

    // Request cron status
    socket.emit("self-improvement:status");

    socket.on("self-improvement:status", (data: CronStatus) => {
      setCronStatus(data);
    });

    socket.on("self-improvement:report", (report: SelfImprovementReport) => {
      setImprovementReport(report);
      setIsRunning(false);
    });

    socket.on("self-improvement:indexed", (result: { success: boolean; chunksIndexed: number; error?: string }) => {
      setIsIndexing(false);
      if (result.success) {
        socket.emit("self-improvement:status");
      } else {
        setError(result.error || "Indexing failed");
      }
    });

    socket.on("self-improvement:error", (data: { error: string }) => {
      setError(data.error);
      setIsRunning(false);
      setIsIndexing(false);
    });

    return () => {
      socket.off("self-improvement:status");
      socket.off("self-improvement:report");
      socket.off("self-improvement:indexed");
      socket.off("self-improvement:error");
    };
  }, [socket, connected]);

  const handleRunNow = () => {
    if (!socket || !connected) return;
    setIsRunning(true);
    setError(null);
    socket.emit("self-improvement:run");
  };

  const handleIndexCodebase = () => {
    if (!socket || !connected) return;
    setIsIndexing(true);
    setError(null);
    socket.emit("self-improvement:index-codebase");
  };

  return (
    <div className="p-8 lg:p-12 max-w-4xl mx-auto">
      <header className="mb-12">
        <h1 className="text-3xl font-light tracking-tight mb-2">Cron Jobs</h1>
        <p className="text-white/40">Manage scheduled tasks and self-improvement</p>
      </header>

      <div className="space-y-6">
        {/* Self-Improvement Scheduler */}
        <section className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <Zap size={20} className="text-emerald-400" />
              </div>
              <div>
                <h3 className="text-lg font-light">Self-Improvement</h3>
                <p className="text-xs text-white/40">AI-powered codebase analysis and optimization</p>
              </div>
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full ${cronStatus?.enabled ? "bg-emerald-500/10 text-emerald-400" : "bg-white/5 text-white/40"}`}>
              {cronStatus?.enabled ? "Active" : "Inactive"}
            </span>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
              <div className="flex items-center gap-2">
                <AlertCircle size={16} className="text-red-400" />
                <p className="text-sm text-red-300">{error}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {/* Schedule */}
            <div className="bg-white/5 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock size={16} className="text-white/50" />
                <span className="text-sm text-white/70">Schedule</span>
              </div>
              <div className="flex gap-2">
                {cronStatus?.times.map((time) => (
                  <span
                    key={time}
                    className="px-3 py-1 bg-emerald-500/10 text-emerald-400 text-sm rounded-lg"
                  >
                    {time}
                  </span>
                ))}
              </div>
              <p className="text-xs text-white/30 mt-2">Runs twice daily</p>
            </div>

            {/* Codebase Index */}
            <div className="bg-white/5 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Database size={16} className="text-white/50" />
                <span className="text-sm text-white/70">Codebase Index</span>
              </div>
              <div className="flex items-center gap-2">
                {cronStatus?.codebaseIndexed ? (
                  <>
                    <CheckCircle size={16} className="text-emerald-400" />
                    <span className="text-sm text-emerald-400">
                      {cronStatus.codebaseStats?.files} files, {cronStatus.codebaseStats?.chunks} chunks
                    </span>
                  </>
                ) : (
                  <>
                    <AlertCircle size={16} className="text-amber-400" />
                    <span className="text-sm text-amber-400">Not indexed</span>
                  </>
                )}
              </div>
              <button
                onClick={handleIndexCodebase}
                disabled={!connected || isIndexing}
                className="mt-2 flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 disabled:text-white/30"
              >
                {isIndexing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {isIndexing ? "Indexing..." : "Re-index codebase"}
              </button>
            </div>
          </div>

          {/* Run Now Button */}
          <div className="flex items-center gap-4">
            <button
              onClick={handleRunNow}
              disabled={!connected || isRunning}
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 disabled:bg-white/10 disabled:text-white/30 text-black text-sm font-medium rounded-xl transition-colors"
            >
              {isRunning ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
              {isRunning ? "Running..." : "Run Analysis Now"}
            </button>
            <span className="text-xs text-white/40">
              Analyze codebase, lessons learned, and generate improvement suggestions
            </span>
          </div>
        </section>

        {/* Latest Improvement Report */}
        {improvementReport && (
          <section className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <Bug size={20} className="text-blue-400" />
              </div>
              <div>
                <h3 className="text-lg font-light">Latest Analysis</h3>
                <p className="text-xs text-white/40">
                  {new Date(improvementReport.timestamp).toLocaleString()}
                </p>
              </div>
            </div>

            {improvementReport.findings.length > 0 && (
              <div className="mb-6">
                <h4 className="text-sm text-white/70 mb-3">Findings</h4>
                <ul className="space-y-2">
                  {improvementReport.findings.map((finding, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-white/60">
                      <span className="text-blue-400">•</span>
                      {finding}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {improvementReport.suggestions.length > 0 && (
              <div className="mb-6">
                <h4 className="text-sm text-white/70 mb-3">Suggestions</h4>
                <ul className="space-y-2">
                  {improvementReport.suggestions.map((suggestion, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-emerald-400">
                      <Zap size={14} className="shrink-0 mt-0.5" />
                      {suggestion}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {improvementReport.codeReferences.length > 0 && (
              <div>
                <h4 className="text-sm text-white/70 mb-3">Code References</h4>
                <div className="bg-white/5 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/5">
                        <th className="text-left p-3 text-white/50 font-normal">File</th>
                        <th className="text-left p-3 text-white/50 font-normal">Line</th>
                        <th className="text-left p-3 text-white/50 font-normal">Suggestion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {improvementReport.codeReferences.slice(0, 10).map((ref, i) => (
                        <tr key={i} className="border-b border-white/5 last:border-0">
                          <td className="p-3 text-white/60 font-mono text-xs">{ref.file.split("/").pop()}</td>
                          <td className="p-3 text-white/60">{ref.line}</td>
                          <td className="p-3 text-white/60 text-xs">{ref.suggestion}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        )}

        {/* RCA Scheduler Status */}
        <section className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                <Clock size={20} className="text-amber-400" />
              </div>
              <div>
                <h3 className="text-lg font-light">Root Cause Analysis</h3>
                <p className="text-xs text-white/40">Analyzes lessons learned automatically</p>
              </div>
            </div>
            <span className="text-xs px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400">
              Enabled
            </span>
          </div>
          <p className="text-sm text-white/40">
            Runs periodically to analyze agent memories and lessons learned, identifying patterns and improvements.
          </p>
        </section>
      </div>
    </div>
  );
}
