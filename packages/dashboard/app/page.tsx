"use client";

import { useStatus } from "@/lib/hooks";
import { useSocket } from "@/lib/socket";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, Activity, Settings, Cpu, Clock, HardDrive } from "lucide-react";
import { CredentialsModal, useCredentialsCheck } from "@/components/credentials-modal";

export default function Home() {
  const { status, connected } = useStatus();
  const { socket } = useSocket();
  const router = useRouter();
  const { showCredentialsModal, completeCredentials } = useCredentialsCheck();
  const [checkedSetup, setCheckedSetup] = useState(false);

  // Check if setup is needed - redirect to settings instead of setup
  useEffect(() => {
    if (socket && connected && !checkedSetup) {
      setCheckedSetup(true);
      socket.emit("setup:check");
      socket.on("setup:status", (data: { needsSetup: boolean; isConfigured: boolean }) => {
        if (data.needsSetup && !data.isConfigured) {
          router.replace("/settings");
        }
      });
      return () => {
        socket.off("setup:status");
      };
    }
  }, [socket, connected, router, checkedSetup]);

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  };

  const stats = [
    { label: "Status", value: connected ? "Online" : "Offline", icon: Activity, color: connected ? "emerald" : "red" },
    { label: "Sessions", value: String(status?.sessions ?? 0), icon: Cpu, color: "blue" },
    { label: "Uptime", value: status ? formatUptime(status.uptime) : "--", icon: Clock, color: "violet" },
    { label: "Memory", value: status ? `${status.memoryMB} MB` : "--", icon: HardDrive, color: "amber" },
  ];

  const subsystems = status?.subsystems ? Object.entries(status.subsystems) : [];

  return (
    <>
      <CredentialsModal isOpen={showCredentialsModal} onComplete={completeCredentials} />
      <div className="p-8 lg:p-12 max-w-6xl mx-auto">
      {/* Header */}
      <header className="mb-12">
        <h1 className="text-3xl font-light tracking-tight mb-2">Dashboard</h1>
        <p className="text-white/40">FastBot overview</p>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-12">
        {stats.map(({ label, value, icon: Icon, color }) => (
          <div
            key={label}
            className="group bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/[0.12] rounded-2xl p-5 transition-all duration-300"
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs text-white/40 uppercase tracking-wider">{label}</span>
              <Icon size={16} className={`text-white/20 group-hover:text-${color}-400 transition-colors`} style={{ color: color === 'emerald' ? '#34d399' : color === 'red' ? '#f87171' : color === 'blue' ? '#60a5fa' : color === 'violet' ? '#a78bfa' : '#fbbf24' }} />
            </div>
            <p className="text-2xl font-light">{value}</p>
          </div>
        ))}
      </div>

      {/* Subsystems */}
      <section className="mb-12">
        <h2 className="text-sm text-white/40 uppercase tracking-wider mb-4">Subsystems</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {subsystems.length > 0
            ? subsystems.map(([name, state]) => (
                <div
                  key={name}
                  className="bg-white/[0.02] border border-white/[0.04] rounded-xl px-4 py-3 flex items-center gap-3"
                >
                  <div
                    className={`w-1.5 h-1.5 rounded-full ${
                      state === "online" || state === "connected"
                        ? "bg-emerald-400 shadow-lg shadow-emerald-400/50"
                        : state === "pending"
                          ? "bg-amber-400"
                          : "bg-white/20"
                    }`}
                  />
                  <span className="text-sm text-white/60 capitalize">{name}</span>
                </div>
              ))
            : Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-white/[0.02] border border-white/[0.04] rounded-xl px-4 py-3 animate-pulse"
                >
                  <div className="h-3 w-20 bg-white/10 rounded" />
                </div>
              ))}
        </div>
      </section>

      {/* Quick Links */}
      <section>
        <h2 className="text-sm text-white/40 uppercase tracking-wider mb-4">Quick Access</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <QuickLink href="/chat" icon={MessageCircle} title="Chat" description="Start a conversation" />
          <QuickLink href="/status" icon={Activity} title="Status" description="System health & events" />
          <QuickLink href="/settings" icon={Settings} title="Settings" description="Configure your bot" />
        </div>
      </section>
    </div>
    </>
  );
}

function QuickLink({ href, icon: Icon, title, description }: { href: string; icon: any; title: string; description: string }) {
  return (
    <Link
      href={href}
      className="group bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/[0.12] rounded-2xl p-6 transition-all duration-300"
    >
      <div className="flex items-center gap-4 mb-3">
        <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-emerald-500/20 transition-colors">
          <Icon size={20} className="text-white/60 group-hover:text-emerald-400 transition-colors" />
        </div>
        <h3 className="text-lg font-light">{title}</h3>
      </div>
      <p className="text-sm text-white/40">{description}</p>
    </Link>
  );
}
