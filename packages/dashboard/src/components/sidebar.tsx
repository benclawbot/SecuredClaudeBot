"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSocket } from "@/lib/socket";
import {
  MessageCircle,
  Activity,
  Columns,
  Zap,
  Folder,
  BarChart3,
  Settings,
  Users,
} from "lucide-react";

const navItems = [
  { href: "/chat", label: "Chat", icon: MessageCircle },
  { href: "/status", label: "Status", icon: Activity },
  { href: "/agents", label: "Agents", icon: Users },
  { href: "/kanban", label: "Kanban", icon: Columns },
  { href: "/workflows", label: "Workflows", icon: Zap },
  { href: "/media", label: "Media", icon: Folder },
  { href: "/usage", label: "Usage", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { connected } = useSocket();

  return (
    <aside className="w-16 lg:w-20 shrink-0 bg-[#0a0a0a] flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <Link href="/" className="h-16 flex items-center justify-center border-b border-white/5">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 overflow-hidden">
          <img src="/logo.svg" alt="FastBot" className="w-7 h-7 object-contain" />
        </div>
      </Link>

      {/* Nav */}
      <nav className="flex-1 py-4 flex flex-col gap-1 px-2">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname?.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={`h-11 rounded-lg flex items-center justify-center transition-all duration-200 ${
                active
                  ? "bg-white/10 text-white"
                  : "text-white/40 hover:text-white hover:bg-white/5"
              }`}
              title={label}
            >
              <Icon size={20} strokeWidth={active ? 2 : 1.5} />
            </Link>
          );
        })}
      </nav>

      {/* Status */}
      <div className="h-16 flex items-center justify-center border-t border-white/5">
        <div
          className={`w-2 h-2 rounded-full ${
            connected ? "bg-emerald-400 shadow-lg shadow-emerald-400/50" : "bg-red-500"
          }`}
          title={connected ? "Connected" : "Disconnected"}
        />
      </div>
    </aside>
  );
}
