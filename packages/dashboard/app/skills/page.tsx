"use client";

import { useState, useEffect } from "react";
import { useSocket } from "@/lib/socket";
import {
  Wrench,
  Plus,
  Trash2,
  Play,
  Power,
  PowerOff,
  Search,
  Package,
  Check,
  X,
  ExternalLink,
  Download
} from "lucide-react";

interface Skill {
  id: string;
  name: string;
  description: string;
  source: string;
  installedAt: number;
  enabled: boolean;
  tools: string[];
}

export default function SkillsPage() {
  const { socket, connected } = useSocket();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [installSource, setInstallSource] = useState("");
  const [installError, setInstallError] = useState<string | null>(null);
  const [installSuccess, setInstallSuccess] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!socket || !connected) return;

    loadSkills();

    socket.on("skills:list", (data: { skills?: Skill[]; error?: string }) => {
      if (data.skills) {
        setSkills(data.skills);
      }
      setLoading(false);
    });

    socket.on("skills:installed", (data: { success?: boolean; skill?: Skill; error?: string }) => {
      setInstalling(false);
      if (data.success) {
        setInstallSuccess(`Successfully installed ${data.skill?.name || "skill"}!`);
        setInstallSource("");
        loadSkills();
        setTimeout(() => setInstallSuccess(null), 3000);
      } else {
        setInstallError(data.error || "Failed to install skill");
      }
    });

    socket.on("skills:uninstalled", (data: { success?: boolean; error?: string }) => {
      if (data.success) {
        loadSkills();
      }
    });

    socket.on("skills:toggled", (data: { success?: boolean; error?: string }) => {
      if (data.success) {
        loadSkills();
      }
    });

    return () => {
      socket.off("skills:list");
      socket.off("skills:installed");
      socket.off("skills:uninstalled");
      socket.off("skills:toggled");
    };
  }, [socket, connected]);

  const loadSkills = () => {
    socket?.emit("skills:list");
  };

  const handleInstall = () => {
    if (!installSource.trim()) return;
    setInstalling(true);
    setInstallError(null);
    socket?.emit("skills:install", { source: installSource.trim() });
  };

  const handleUninstall = (skillId: string) => {
    if (confirm(`Are you sure you want to uninstall this skill?`)) {
      socket?.emit("skills:uninstall", { id: skillId });
    }
  };

  const handleToggle = (skillId: string, enabled: boolean) => {
    socket?.emit("skills:toggle", { id: skillId, enabled: !enabled });
  };

  const filteredSkills = skills.filter(
    (skill) =>
      skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      skill.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {/* Main Content */}
      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-light">Skills</h2>
              <p className="text-sm text-white/40">
                Install Claude Code compatible skills for the AI agents
              </p>
            </div>
          </div>

          {/* Install Section */}
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 mb-6">
            <h3 className="text-lg font-light mb-4">Install New Skill</h3>

            {installError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <p className="text-xs text-red-400">{installError}</p>
              </div>
            )}

            {installSuccess && (
              <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                <p className="text-xs text-emerald-400">{installSuccess}</p>
              </div>
            )}

            <div className="flex gap-3">
              <div className="flex-1 relative">
                <Package size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  type="text"
                  value={installSource}
                  onChange={(e) => setInstallSource(e.target.value)}
                  placeholder="GitHub repo URL or npm package name"
                  className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-500/50"
                  onKeyDown={(e) => e.key === "Enter" && handleInstall()}
                />
              </div>
              <button
                onClick={handleInstall}
                disabled={!connected || installing || !installSource.trim()}
                className="flex items-center gap-2 px-5 py-3 bg-blue-500 hover:bg-blue-400 disabled:bg-white/10 disabled:text-white/30 text-black text-sm font-medium rounded-xl transition-colors"
              >
                {installing ? (
                  <>
                    <Download size={16} className="animate-spin" />
                    Installing...
                  </>
                ) : (
                  <>
                    <Plus size={16} />
                    Install
                  </>
                )}
              </button>
            </div>
            <p className="text-xs text-white/40 mt-2">
              Supports GitHub repositories (e.g., https://github.com/user/repo or user/repo)
            </p>
          </div>

          {/* Search */}
          <div className="relative mb-6">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search skills..."
              className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-500/50"
            />
          </div>

          {/* Skills List */}
          {loading ? (
            <div className="text-center py-20 text-white/40">Loading skills...</div>
          ) : filteredSkills.length === 0 ? (
            <div className="text-center py-20">
              <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center mx-auto mb-4">
                <Wrench size={32} className="text-blue-400" />
              </div>
              <h3 className="text-lg font-semibold text-zinc-300 mb-2">
                {searchQuery ? "No skills found" : "No skills installed"}
              </h3>
              <p className="text-sm text-zinc-500 max-w-md mx-auto">
                {searchQuery
                  ? "Try a different search term"
                  : "Install a skill to get started. Skills extend the capabilities of your AI agents."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredSkills.map((skill) => (
                <div
                  key={skill.id}
                  className={`bg-white/[0.03] border rounded-2xl p-5 transition-all ${
                    skill.enabled
                      ? "border-white/[0.12]"
                      : "border-white/[0.06] opacity-60"
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                        skill.enabled ? "bg-blue-500/10" : "bg-white/5"
                      }`}>
                        <Wrench size={20} className={skill.enabled ? "text-blue-400" : "text-white/30"} />
                      </div>
                      <div>
                        <h4 className="text-base font-light text-white">{skill.name}</h4>
                        <p className="text-xs text-white/40">{formatDate(skill.installedAt)}</p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleToggle(skill.id, skill.enabled)}
                        className={`p-2 rounded-lg transition-colors ${
                          skill.enabled
                            ? "hover:bg-emerald-500/10 text-emerald-400"
                            : "hover:bg-white/5 text-white/40"
                        }`}
                        title={skill.enabled ? "Disable" : "Enable"}
                      >
                        {skill.enabled ? <Power size={16} /> : <PowerOff size={16} />}
                      </button>
                      <button
                        onClick={() => handleUninstall(skill.id)}
                        className="p-2 rounded-lg hover:bg-red-500/10 text-white/40 hover:text-red-400 transition-colors"
                        title="Uninstall"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  <p className="text-sm text-white/60 mb-4 line-clamp-2">
                    {skill.description || "No description available"}
                  </p>

                  {skill.tools.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {skill.tools.slice(0, 5).map((tool, i) => (
                        <span
                          key={i}
                          className="text-xs text-white/40 bg-white/5 px-2 py-1 rounded"
                        >
                          {tool}
                        </span>
                      ))}
                      {skill.tools.length > 5 && (
                        <span className="text-xs text-white/30 px-2 py-1">
                          +{skill.tools.length - 5} more
                        </span>
                      )}
                    </div>
                  )}

                  {skill.source && (
                    <a
                      href={skill.source}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-white/40 hover:text-white transition-colors"
                    >
                      <ExternalLink size={12} />
                      View Source
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
