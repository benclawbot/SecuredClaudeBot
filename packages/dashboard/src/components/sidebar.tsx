"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSocket } from "@/lib/socket";

const navItems = [
  { href: "/chat", label: "Chat", icon: "💬" },
  { href: "/status", label: "Status", icon: "📊" },
  { href: "/kanban", label: "Kanban", icon: "📋" },
  { href: "/workflows", label: "Workflows", icon: "⚡" },
  { href: "/media", label: "Media", icon: "📁" },
  { href: "/usage", label: "Usage", icon: "📈" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { connected } = useSocket();

  return (
    <nav className="w-56 shrink-0 border-r border-zinc-800 bg-zinc-950 p-4 flex flex-col gap-1 h-screen sticky top-0">
      <Link href="/" className="flex items-center gap-2 mb-6 px-2">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
          <span className="text-emerald-400 font-bold text-sm">SC</span>
        </div>
        <div>
          <h1 className="text-sm font-bold text-zinc-100 leading-tight">
            Mission Control
          </h1>
          <span className="text-[10px] text-zinc-500 leading-tight">
            SecureClaudebot
          </span>
        </div>
      </Link>

      {navItems.map(({ href, label, icon }) => {
        const active = pathname === href || pathname?.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
              active
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50"
            }`}
          >
            <span className="text-base">{icon}</span>
            {label}
          </Link>
        );
      })}

      <div className="mt-auto pt-4 border-t border-zinc-800">
        <div className="flex items-center gap-2 px-3 py-2">
          <div
            className={`w-2 h-2 rounded-full ${
              connected ? "bg-emerald-400" : "bg-red-400"
            }`}
          />
          <span className="text-xs text-zinc-500">
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>
    </nav>
  );
}
