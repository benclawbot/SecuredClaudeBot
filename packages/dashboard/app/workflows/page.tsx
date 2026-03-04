"use client";

import { useState, useEffect, useCallback } from "react";
import { useSocket } from "@/lib/socket";
import { useWorkflows } from "@/lib/use-workflows";
import { Zap, Play, Clock, CheckCircle2, XCircle, AlertCircle, Plus, FileText, History, Box, ArrowRight, Trash2, GripVertical, Settings, GitBranch, Webhook, Database, Bell, Mail, MessageSquare, Terminal, FileJson } from "lucide-react";
import type { WorkflowTemplate, WorkflowRun } from "@/lib/workflows";

const categoryColors: Record<string, string> = {
  development: "bg-blue-500/20 text-blue-400",
  analytics: "bg-purple-500/20 text-purple-400",
  marketing: "bg-orange-500/20 text-orange-400",
  other: "bg-zinc-500/20 text-zinc-400",
};

// Node type icons
const nodeIcons: Record<string, typeof Zap> = {
  http_get: Webhook,
  http_post: Webhook,
  transform: Terminal,
  send_notification: Bell,
  email: Mail,
  telegram: MessageSquare,
  database: Database,
  github: GitBranch,
  default: Zap,
};

interface WorkflowNode {
  id: string;
  name: string;
  action: string;
  config: Record<string, string>;
}

// Parse YAML to nodes
function parseYamlToNodes(yaml: string): WorkflowNode[] {
  const nodes: WorkflowNode[] = [];
  try {
    // Simple YAML parsing
    const lines = yaml.split("\n");
    let currentNode: Partial<WorkflowNode> | null = null;
    let inSteps = false;
    let nodeIndex = 0;

    for (const line of lines) {
      if (line.includes("steps:")) {
        inSteps = true;
        continue;
      }
      if (inSteps && line.includes("- name:")) {
        if (currentNode && currentNode.name) {
          nodes.push(currentNode as WorkflowNode);
        }
        const name = line.replace("- name:", "").trim().replace(/['"]/g, "");
        currentNode = {
          id: `node-${nodeIndex++}`,
          name,
          action: "default",
          config: {},
        };
      }
      if (currentNode && line.includes("action:")) {
        currentNode.action = line.replace("action:", "").trim().replace(/['"]/g, "");
      }
      if (currentNode && line.includes("url:")) {
        currentNode.config = { ...currentNode.config, url: line.replace("url:", "").trim().replace(/['"]/g, "") };
      }
    }
    if (currentNode && currentNode.name) {
      nodes.push(currentNode as WorkflowNode);
    }
  } catch (e) {
    console.error("Failed to parse YAML:", e);
  }
  return nodes;
}

// Generate YAML from nodes
function nodesToYaml(nodes: WorkflowNode[]): string {
  let yaml = `workflow:
  name: Custom Workflow
  description: User-defined workflow

steps:
`;
  for (const node of nodes) {
    yaml += `  - name: ${node.name}
    action: ${node.action}
`;
    if (node.config.url) {
      yaml += `    url: "${node.config.url}"
`;
    }
    if (node.config.input) {
      yaml += `    input: "${node.config.input}"
`;
    }
    if (node.config.channel) {
      yaml += `    channel: "${node.config.channel}"
`;
    }
  }
  return yaml;
}

// Add a new node
function addNode(nodes: WorkflowNode[], type: string): WorkflowNode[] {
  const newNode: WorkflowNode = {
    id: `node-${Date.now()}`,
    name: `New ${type}`,
    action: type,
    config: {},
  };
  return [...nodes, newNode];
}

// Remove a node
function removeNode(nodes: WorkflowNode[], id: string): WorkflowNode[] {
  return nodes.filter((n) => n.id !== id);
}

// Update a node
function updateNode(nodes: WorkflowNode[], id: string, updates: Partial<WorkflowNode>): WorkflowNode[] {
  return nodes.map((n) => (n.id === id ? { ...n, ...updates } : n));
}

function WorkflowCard({
  template,
  onRun,
  running,
}: {
  template: WorkflowTemplate;
  onRun: () => void;
  running: boolean;
}) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 hover:border-white/[0.12] transition-all">
      <div className="flex items-start justify-between mb-4">
        <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
          <Zap size={20} className="text-violet-400" />
        </div>
        <span className={`text-xs px-2 py-1 rounded-full ${categoryColors[template.category] || categoryColors.other}`}>
          {template.category}
        </span>
      </div>

      <h3 className="text-lg font-light text-white mb-2">{template.name}</h3>
      <p className="text-sm text-white/40 mb-4">{template.description}</p>

      <div className="flex flex-wrap gap-1 mb-4">
        {template.steps.slice(0, 3).map((step, i) => (
          <span key={i} className="text-xs text-white/30 bg-white/5 px-2 py-1 rounded">
            {step}
          </span>
        ))}
        {template.steps.length > 3 && (
          <span className="text-xs text-white/30 bg-white/5 px-2 py-1 rounded">
            +{template.steps.length - 3} more
          </span>
        )}
      </div>

      <button
        onClick={onRun}
        disabled={running}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-violet-500 hover:bg-violet-400 disabled:bg-white/10 disabled:text-white/30 text-black font-medium rounded-xl transition-colors"
      >
        <Play size={16} />
        {running ? "Running..." : "Run Workflow"}
      </button>
    </div>
  );
}

function WorkflowHistoryItem({ run }: { run: WorkflowRun }) {
  const statusIcon = {
    pending: <Clock size={16} className="text-yellow-400" />,
    running: <AlertCircle size={16} className="text-blue-400 animate-pulse" />,
    completed: <CheckCircle2 size={16} className="text-emerald-400" />,
    failed: <XCircle size={16} className="text-red-400" />,
  };

  const statusColor = {
    pending: "text-yellow-400",
    running: "text-blue-400",
    completed: "text-emerald-400",
    failed: "text-red-400",
  };

  return (
    <div className="bg-white/[0.02] border border-white/[0.04] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          {statusIcon[run.status]}
          <span className="text-sm font-medium text-white">{run.workflowId}</span>
        </div>
        <span className={`text-xs ${statusColor[run.status]}`}>
          {run.status}
        </span>
      </div>

      {run.steps.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-white/40 mb-2">Steps:</p>
          {run.steps.map((step, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              {step.status === "completed" ? (
                <CheckCircle2 size={12} className="text-emerald-400" />
              ) : step.status === "failed" ? (
                <XCircle size={12} className="text-red-400" />
              ) : (
                <Clock size={12} className="text-white/20" />
              )}
              <span className="text-white/60">{step.name}</span>
            </div>
          ))}
        </div>
      )}

      <div className="text-xs text-white/30 mt-3">
        {new Date(run.startedAt).toLocaleString()}
      </div>
    </div>
  );
}

// Visual Node Component
function WorkflowNodeCard({
  node,
  index,
  isLast,
  onUpdate,
  onRemove,
}: {
  node: WorkflowNode;
  index: number;
  isLast: boolean;
  onUpdate: (updates: Partial<WorkflowNode>) => void;
  onRemove: () => void;
}) {
  const Icon = nodeIcons[node.action] || nodeIcons.default;
  const [showConfig, setShowConfig] = useState(false);

  return (
    <div className="relative">
      {/* Connector line */}
      {!isLast && (
        <div className="absolute left-1/2 -bottom-6 w-0.5 h-6 bg-violet-500/30"></div>
      )}

      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl overflow-hidden">
        {/* Node header */}
        <div className="flex items-center gap-3 p-3 bg-white/[0.02]">
          <GripVertical size={16} className="text-white/20 cursor-grab" />
          <div className="w-8 h-8 rounded-lg bg-violet-500/20 flex items-center justify-center">
            <Icon size={16} className="text-violet-400" />
          </div>
          <input
            type="text"
            value={node.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            className="flex-1 bg-transparent text-sm text-white border-none outline-none"
          />
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="p-1.5 rounded-lg hover:bg-white/5 text-white/40 hover:text-white"
          >
            <Settings size={14} />
          </button>
          <button
            onClick={onRemove}
            className="p-1.5 rounded-lg hover:bg-red-500/10 text-white/40 hover:text-red-400"
          >
            <Trash2 size={14} />
          </button>
        </div>

        {/* Node body */}
        <div className="px-3 pb-3">
          <select
            value={node.action}
            onChange={(e) => onUpdate({ action: e.target.value })}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white/70 outline-none"
          >
            <option value="http_get">HTTP GET</option>
            <option value="http_post">HTTP POST</option>
            <option value="transform">Transform</option>
            <option value="send_notification">Send Notification</option>
            <option value="email">Send Email</option>
            <option value="telegram">Send Telegram</option>
            <option value="database">Database Query</option>
            <option value="github">GitHub Action</option>
          </select>
        </div>

        {/* Config panel */}
        {showConfig && (
          <div className="px-3 pb-3 pt-0 border-t border-white/5 space-y-2">
            {node.action.includes("http") && (
              <input
                type="text"
                placeholder="URL"
                value={node.config.url || ""}
                onChange={(e) => onUpdate({ config: { ...node.config, url: e.target.value } })}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder-white/30 outline-none"
              />
            )}
            {node.action === "transform" && (
              <input
                type="text"
                placeholder="Input (e.g., ${step1.output})"
                value={node.config.input || ""}
                onChange={(e) => onUpdate({ config: { ...node.config, input: e.target.value } })}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder-white/30 outline-none"
              />
            )}
            {node.action === "send_notification" && (
              <input
                type="text"
                placeholder="Channel (e.g., telegram, slack)"
                value={node.config.channel || ""}
                onChange={(e) => onUpdate({ config: { ...node.config, channel: e.target.value } })}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder-white/30 outline-none"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Node type selector
function AddNodeButton({ onAdd }: { onAdd: (type: string) => void }) {
  const [showMenu, setShowMenu] = useState(false);

  const nodeTypes = [
    { id: "http_get", name: "HTTP GET", icon: Webhook },
    { id: "http_post", name: "HTTP POST", icon: Webhook },
    { id: "transform", name: "Transform", icon: Terminal },
    { id: "send_notification", name: "Notify", icon: Bell },
    { id: "email", name: "Email", icon: Mail },
    { id: "telegram", name: "Telegram", icon: MessageSquare },
    { id: "database", name: "Database", icon: Database },
    { id: "github", name: "GitHub", icon: GitBranch },
  ];

  return (
    <div className="relative">
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="flex items-center gap-2 px-4 py-2 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/20 text-violet-400 rounded-xl text-sm transition-colors"
      >
        <Plus size={16} />
        Add Node
      </button>

      {showMenu && (
        <div className="absolute top-full left-0 mt-2 w-48 bg-zinc-900 border border-white/10 rounded-xl overflow-hidden z-10">
          {nodeTypes.map((type) => (
            <button
              key={type.id}
              onClick={() => {
                onAdd(type.id);
                setShowMenu(false);
              }}
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 text-left text-sm text-white/70 hover:text-white"
            >
              <type.icon size={14} />
              {type.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function VisualWorkflowEditor({
  yaml,
  onYamlChange,
}: {
  yaml: string;
  onYamlChange: (yaml: string) => void;
}) {
  const [nodes, setNodes] = useState<WorkflowNode[]>([]);

  // Sync YAML to nodes when YAML changes externally
  useEffect(() => {
    const parsed = parseYamlToNodes(yaml);
    if (parsed.length > 0) {
      setNodes(parsed);
    }
  }, []);

  const handleAddNode = (type: string) => {
    const newNodes = addNode(nodes, type);
    setNodes(newNodes);
    onYamlChange(nodesToYaml(newNodes));
  };

  const handleRemoveNode = (id: string) => {
    const newNodes = removeNode(nodes, id);
    setNodes(newNodes);
    onYamlChange(nodesToYaml(newNodes));
  };

  const handleUpdateNode = (id: string, updates: Partial<WorkflowNode>) => {
    const newNodes = updateNode(nodes, id, updates);
    setNodes(newNodes);
    onYamlChange(nodesToYaml(newNodes));
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* YAML Editor */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <FileText size={16} className="text-violet-400" />
          <span className="text-sm text-white/70">YAML Code</span>
        </div>
        <textarea
          value={yaml}
          onChange={(e) => {
            onYamlChange(e.target.value);
            setNodes(parseYamlToNodes(e.target.value));
          }}
          className="w-full h-96 bg-black/30 border border-white/10 rounded-xl p-4 text-xs text-white font-mono focus:outline-none focus:border-violet-500/50 resize-none"
          placeholder="Paste your YAML workflow here..."
        />
      </div>

      {/* Visual Editor */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <GitBranch size={16} className="text-violet-400" />
            <span className="text-sm text-white/70">Visual Flow</span>
          </div>
          <AddNodeButton onAdd={handleAddNode} />
        </div>

        {/* Node canvas */}
        <div className="h-96 overflow-y-auto space-y-6 p-2">
          {nodes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <FileJson size={32} className="text-white/20 mb-2" />
              <p className="text-sm text-white/40">No nodes yet</p>
              <p className="text-xs text-white/30">Add a node to start building your workflow</p>
            </div>
          ) : (
            nodes.map((node, index) => (
              <WorkflowNodeCard
                key={node.id}
                node={node}
                index={index}
                isLast={index === nodes.length - 1}
                onUpdate={(updates) => handleUpdateNode(node.id, updates)}
                onRemove={() => handleRemoveNode(node.id)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default function WorkflowsPage() {
  const { socket, connected } = useSocket();
  const { templates, history, running, fetchTemplates, fetchHistory, runWorkflow } = useWorkflows();
  const [activeTab, setActiveTab] = useState<"templates" | "create" | "history">("templates");
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowTemplate | null>(null);
  const [customYaml, setCustomYaml] = useState(`workflow:
  name: My Custom Workflow
  description: Example workflow

steps:
  - name: Fetch Data
    action: http_get
    url: https://api.example.com/data

  - name: Process
    action: transform
    input: \${step1.output}

  - name: Notify
    action: send_notification
    channel: telegram`);
  const [runStatus, setRunStatus] = useState<{ success?: boolean; message?: string } | null>(null);

  useEffect(() => {
    if (connected) {
      fetchTemplates();
      fetchHistory();
    }
  }, [connected, fetchTemplates, fetchHistory]);

  const handleRunWorkflow = async (workflow: WorkflowTemplate) => {
    setSelectedWorkflow(workflow);
    setRunStatus(null);
    try {
      await runWorkflow(workflow.id);
      setRunStatus({ success: true, message: `Workflow "${workflow.name}" started successfully!` });
      fetchHistory();
    } catch (err) {
      setRunStatus({ success: false, message: String(err) });
    }
  };

  const handleRunCustom = async () => {
    if (!customYaml.trim()) return;
    setRunStatus(null);
    try {
      await runWorkflow("custom", { yaml: customYaml });
      setRunStatus({ success: true, message: "Custom workflow started successfully!" });
      setActiveTab("history");
    } catch (err) {
      setRunStatus({ success: false, message: String(err) });
    }
  };

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-light tracking-tight mb-2">Workflows</h1>
            <p className="text-white/40">Automate tasks with AI-powered workflows</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab("templates")}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              activeTab === "templates"
                ? "bg-violet-500/20 text-violet-400"
                : "text-white/40 hover:text-white hover:bg-white/5"
            }`}
          >
            <Box size={16} />
            Templates
          </button>
          <button
            onClick={() => setActiveTab("create")}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              activeTab === "create"
                ? "bg-violet-500/20 text-violet-400"
                : "text-white/40 hover:text-white hover:bg-white/5"
            }`}
          >
            <Plus size={16} />
            Create
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
              activeTab === "history"
                ? "bg-violet-500/20 text-violet-400"
                : "text-white/40 hover:text-white hover:bg-white/5"
            }`}
          >
            <History size={16} />
            History
          </button>
        </div>

        {/* Status Message */}
        {runStatus && (
          <div
            className={`mb-6 p-4 rounded-xl flex items-center gap-3 ${
              runStatus.success
                ? "bg-emerald-500/10 border border-emerald-500/20"
                : "bg-red-500/10 border border-red-500/20"
            }`}
          >
            {runStatus.success ? (
              <CheckCircle2 size={20} className="text-emerald-400" />
            ) : (
              <XCircle size={20} className="text-red-400" />
            )}
            <span className={runStatus.success ? "text-emerald-400" : "text-red-400"}>
              {runStatus.message}
            </span>
          </div>
        )}

        {/* Templates Tab */}
        {activeTab === "templates" && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((template) => (
              <WorkflowCard
                key={template.id}
                template={template}
                onRun={() => handleRunWorkflow(template)}
                running={running && selectedWorkflow?.id === template.id}
              />
            ))}
          </div>
        )}

        {/* Create Tab */}
        {activeTab === "create" && (
          <div className="space-y-4">
            <VisualWorkflowEditor yaml={customYaml} onYamlChange={setCustomYaml} />

            <div className="flex justify-end">
              <button
                onClick={handleRunCustom}
                disabled={!customYaml.trim() || running}
                className="flex items-center gap-2 px-6 py-3 bg-violet-500 hover:bg-violet-400 disabled:bg-white/10 disabled:text-white/30 text-black font-medium rounded-xl transition-colors"
              >
                <Play size={18} />
                {running ? "Running..." : "Run Custom Workflow"}
              </button>
            </div>
          </div>
        )}

        {/* History Tab */}
        {activeTab === "history" && (
          <div className="space-y-4">
            {history.length > 0 ? (
              history.map((run) => <WorkflowHistoryItem key={run.id} run={run} />)
            ) : (
              <div className="text-center py-12">
                <Clock size={48} className="text-white/20 mx-auto mb-4" />
                <p className="text-white/40">No workflow runs yet</p>
                <p className="text-sm text-white/30 mt-1">
                  Run a workflow from the Templates tab to get started
                </p>
              </div>
            )}
          </div>
        )}

        {/* Empty State */}
        {activeTab === "templates" && templates.length === 0 && (
          <div className="text-center py-12">
            <Zap size={48} className="text-white/20 mx-auto mb-4" />
            <p className="text-white/40">No workflow templates available</p>
            <p className="text-sm text-white/30 mt-1">
              Create a custom workflow in the Create tab
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
