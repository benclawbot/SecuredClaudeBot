"use client";

import { useState, useEffect } from "react";
import { useSocket } from "@/lib/socket";
import { Users, Plus, FileText, Trash2, Save, RefreshCw, User, Check, X } from "lucide-react";

interface Agent {
  id: string;
  name: string;
  role: string;
  status: "active" | "inactive" | "pending";
  createdAt: number;
  updatedAt: number;
}

export default function AgentsPage() {
  const { socket, connected } = useSocket();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [agentFiles, setAgentFiles] = useState<Record<string, string>>({});
  const [userInfo, setUserInfo] = useState("");
  const [showNewAgent, setShowNewAgent] = useState(false);
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentRole, setNewAgentRole] = useState("");
  const [activeTab, setActiveTab] = useState<"identity" | "role" | "memories" | "lessons" | "user">("identity");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!socket || !connected) return;

    socket.emit("agents:list");

    socket.on("agents:list", (data: Agent[]) => {
      setAgents(data);
    });

    socket.on("agents:data", (data: { agent: Agent; files: Record<string, string> } | null) => {
      if (data) {
        setSelectedAgent(data.agent);
        setAgentFiles(data.files);
      }
    });

    socket.on("agents:created", (agent: Agent) => {
      setAgents((prev) => [...prev, agent]);
      setShowNewAgent(false);
      setNewAgentName("");
      setNewAgentRole("");
    });

    socket.on("agents:updated", (agent: Agent) => {
      setAgents((prev) => prev.map((a) => (a.id === agent.id ? agent : a)));
      setSelectedAgent(agent);
    });

    socket.on("agents:deleted", () => {
      setSelectedAgent(null);
      setAgentFiles({});
      socket.emit("agents:list");
    });

    socket.on("agents:file-updated", () => {
      setSaving(false);
    });

    socket.on("agents:user-info", (data: string) => {
      setUserInfo(data);
    });

    socket.on("agents:user-info-updated", () => {
      setSaving(false);
    });

    return () => {
      socket.off("agents:list");
      socket.off("agents:data");
      socket.off("agents:created");
      socket.off("agents:updated");
      socket.off("agents:deleted");
      socket.off("agents:file-updated");
      socket.off("agents:user-info");
      socket.off("agents:user-info-updated");
    };
  }, [socket, connected]);

  const selectAgent = (id: string) => {
    socket?.emit("agents:get", { id });
  };

  const createAgent = () => {
    if (!newAgentName || !newAgentRole) return;
    socket?.emit("agents:create", { name: newAgentName, role: newAgentRole });
  };

  const updateAgentStatus = (id: string, status: "active" | "inactive" | "pending") => {
    socket?.emit("agents:update", { id, status });
  };

  const deleteAgent = (id: string) => {
    if (confirm("Are you sure you want to delete this agent? All files will be lost.")) {
      socket?.emit("agents:delete", { id });
    }
  };

  const saveFile = (filename: string, content: string) => {
    if (!selectedAgent) return;
    setSaving(true);
    socket?.emit("agents:update-file", { agentId: selectedAgent.id, filename, content });
  };

  const saveUserInfo = () => {
    setSaving(true);
    socket?.emit("agents:update-user-info", { content: userInfo });
  };

  const triggerRca = () => {
    socket?.emit("agents:trigger-rca");
    alert("Root cause analysis triggered");
  };

  return (
    <div className="p-8 lg:p-12 max-w-6xl mx-auto">
      <header className="mb-12">
        <h1 className="text-3xl font-light tracking-tight mb-2">Agents</h1>
        <p className="text-white/40">Manage AI agents and their knowledge bases</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Agent List */}
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm text-white/60 font-medium">Agents</h2>
            <button
              onClick={() => setShowNewAgent(true)}
              disabled={!connected}
              className="p-2 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-lg transition-colors"
            >
              <Plus size={16} className="text-emerald-400" />
            </button>
          </div>

          {showNewAgent && (
            <div className="bg-white/5 rounded-xl p-3 mb-4 space-y-3">
              <input
                type="text"
                value={newAgentName}
                onChange={(e) => setNewAgentName(e.target.value)}
                placeholder="Agent name"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50"
              />
              <input
                type="text"
                value={newAgentRole}
                onChange={(e) => setNewAgentRole(e.target.value)}
                placeholder="Agent role"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50"
              />
              <div className="flex gap-2">
                <button
                  onClick={createAgent}
                  className="flex-1 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-medium rounded-lg transition-colors"
                >
                  Create
                </button>
                <button
                  onClick={() => setShowNewAgent(false)}
                  className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white/60 text-xs rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {agents.length === 0 ? (
              <p className="text-white/30 text-sm text-center py-4">No agents yet</p>
            ) : (
              agents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => selectAgent(agent.id)}
                  className={`w-full text-left p-3 rounded-xl transition-colors ${
                    selectedAgent?.id === agent.id
                      ? "bg-white/10 border border-white/10"
                      : "hover:bg-white/5 border border-transparent"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-white/80">{agent.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      agent.status === "active"
                        ? "bg-emerald-500/10 text-emerald-400"
                        : agent.status === "pending"
                          ? "bg-amber-500/10 text-amber-400"
                          : "bg-white/5 text-white/40"
                    }`}>
                      {agent.status}
                    </span>
                  </div>
                  <p className="text-xs text-white/40 mt-1 truncate">{agent.role}</p>
                </button>
              ))
            )}
          </div>

          {/* User Info Section */}
          <div className="mt-6 pt-4 border-t border-white/5">
            <button
              onClick={() => {
                socket?.emit("agents:get-user-info");
                setActiveTab("user");
              }}
              className="w-full flex items-center gap-2 p-2 text-sm text-white/60 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            >
              <User size={16} />
              <span>User Information</span>
            </button>
            <button
              onClick={triggerRca}
              className="w-full flex items-center gap-2 p-2 text-sm text-white/60 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            >
              <RefreshCw size={16} />
              <span>Run RCA</span>
            </button>
          </div>
        </div>

        {/* Agent Details */}
        <div className="lg:col-span-2">
          {selectedAgent ? (
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-light">{selectedAgent.name}</h2>
                  <p className="text-xs text-white/40">{selectedAgent.role}</p>
                </div>
                <div className="flex gap-2">
                  <select
                    value={selectedAgent.status}
                    onChange={(e) => updateAgentStatus(selectedAgent.id, e.target.value as "active" | "inactive" | "pending")}
                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white"
                  >
                    <option value="active">Active</option>
                    <option value="pending">Pending</option>
                    <option value="inactive">Inactive</option>
                  </select>
                  <button
                    onClick={() => deleteAgent(selectedAgent.id)}
                    className="p-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg transition-colors"
                  >
                    <Trash2 size={16} className="text-red-400" />
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex gap-2 mb-4 border-b border-white/5 pb-4">
                <button
                  onClick={() => setActiveTab("identity")}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                    activeTab === "identity"
                      ? "bg-white/10 text-white"
                      : "text-white/40 hover:text-white"
                  }`}
                >
                  Identity
                </button>
                <button
                  onClick={() => setActiveTab("role")}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                    activeTab === "role"
                      ? "bg-white/10 text-white"
                      : "text-white/40 hover:text-white"
                  }`}
                >
                  Role
                </button>
                <button
                  onClick={() => setActiveTab("memories")}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                    activeTab === "memories"
                      ? "bg-white/10 text-white"
                      : "text-white/40 hover:text-white"
                  }`}
                >
                  Memories
                </button>
                <button
                  onClick={() => setActiveTab("lessons")}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                    activeTab === "lessons"
                      ? "bg-white/10 text-white"
                      : "text-white/40 hover:text-white"
                  }`}
                >
                  Lessons Learned
                </button>
              </div>

              {/* File Content */}
              <div className="space-y-4">
                {activeTab === "identity" && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs text-white/40">identity.md</label>
                      <button
                        onClick={() => saveFile("identity.md", agentFiles["identity.md"] || "")}
                        disabled={saving}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-emerald-400 hover:text-emerald-300"
                      >
                        <Save size={12} />
                        {saving ? "Saving..." : "Save"}
                      </button>
                    </div>
                    <textarea
                      value={agentFiles["identity.md"] || ""}
                      onChange={(e) => setAgentFiles((prev) => ({ ...prev, "identity.md": e.target.value }))}
                      className="w-full h-64 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50 font-mono resize-none"
                    />
                  </div>
                )}

                {activeTab === "role" && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs text-white/40">role.md</label>
                      <button
                        onClick={() => saveFile("role.md", agentFiles["role.md"] || "")}
                        disabled={saving}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-emerald-400 hover:text-emerald-300"
                      >
                        <Save size={12} />
                        {saving ? "Saving..." : "Save"}
                      </button>
                    </div>
                    <textarea
                      value={agentFiles["role.md"] || ""}
                      onChange={(e) => setAgentFiles((prev) => ({ ...prev, "role.md": e.target.value }))}
                      className="w-full h-64 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50 font-mono resize-none"
                    />
                  </div>
                )}

                {activeTab === "memories" && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs text-white/40">memories.md</label>
                      <button
                        onClick={() => saveFile("memories.md", agentFiles["memories.md"] || "")}
                        disabled={saving}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-emerald-400 hover:text-emerald-300"
                      >
                        <Save size={12} />
                        {saving ? "Saving..." : "Save"}
                      </button>
                    </div>
                    <textarea
                      value={agentFiles["memories.md"] || ""}
                      onChange={(e) => setAgentFiles((prev) => ({ ...prev, "memories.md": e.target.value }))}
                      className="w-full h-64 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50 font-mono resize-none"
                    />
                  </div>
                )}

                {activeTab === "lessons" && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs text-white/40">lessons_learned.md</label>
                      <button
                        onClick={() => saveFile("lessons_learned.md", agentFiles["lessons_learned.md"] || "")}
                        disabled={saving}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-emerald-400 hover:text-emerald-300"
                      >
                        <Save size={12} />
                        {saving ? "Saving..." : "Save"}
                      </button>
                    </div>
                    <textarea
                      value={agentFiles["lessons_learned.md"] || ""}
                      onChange={(e) => setAgentFiles((prev) => ({ ...prev, "lessons_learned.md": e.target.value }))}
                      className="w-full h-64 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50 font-mono resize-none"
                    />
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === "user" ? (
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-light">User Information</h2>
                  <p className="text-xs text-white/40">Information about you that agents should know</p>
                </div>
                <button
                  onClick={saveUserInfo}
                  disabled={saving}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs text-emerald-400 hover:text-emerald-300"
                >
                  <Save size={12} />
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
              <textarea
                value={userInfo}
                onChange={(e) => setUserInfo(e.target.value)}
                className="w-full h-96 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50 font-mono resize-none"
              />
            </div>
          ) : (
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 flex items-center justify-center h-64">
              <p className="text-white/30">Select an agent to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
