"use client";

import { useState, useEffect } from "react";
import { useSocket } from "@/lib/socket";
import { Play, Plus, RefreshCw, Check, X, Clock, AlertCircle } from "lucide-react";

interface KanbanTask {
  id: string;
  project_tag: string;
  description: string;
  assigned_to: string[];
  status: string;
  dependencies: string[];
  proof_of_work: string | null;
  created_at: string;
  updated_at: string;
}

interface KanbanBoard {
  Backlog: KanbanTask[];
  "To Do": KanbanTask[];
  "In Progress": KanbanTask[];
  Review: KanbanTask[];
  Done: KanbanTask[];
}

export default function KanbanPage() {
  const { socket, connected } = useSocket();
  const [kanban, setKanban] = useState<KanbanBoard>({
    Backlog: [],
    "To Do": [],
    "In Progress": [],
    Review: [],
    Done: [],
  });
  const [orchStatus, setOrchStatus] = useState<{
    current_phase: string;
    user_changes_pending: boolean;
    active_request_id: string | null;
    task_count: number;
  } | null>(null);
  const [showStartDialog, setShowStartDialog] = useState(false);
  const [userRequest, setUserRequest] = useState("");
  const [showFeedbackDialog, setShowFeedbackDialog] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!socket || !connected) return;

    // Get initial status and kanban
    socket.emit("orchestration:status");
    socket.emit("orchestration:kanban");

    socket.on("orchestration:status", (data) => {
      if (!data.error) {
        setOrchStatus(data);
      }
    });

    socket.on("orchestration:kanban", (data) => {
      if (!data.error) {
        setKanban(data);
      }
    });

    socket.on("orchestration:started", (data) => {
      setLoading(false);
      socket.emit("orchestration:status");
      socket.emit("orchestration:kanban");
    });

    socket.on("orchestration:feedback-received", (data) => {
      setLoading(false);
      setShowFeedbackDialog(false);
      setFeedback("");
      socket.emit("orchestration:status");
      socket.emit("orchestration:kanban");
    });

    socket.on("orchestration:task-added", () => {
      socket.emit("orchestration:kanban");
    });

    socket.on("orchestration:task-moved", () => {
      socket.emit("orchestration:kanban");
    });

    return () => {
      socket.off("orchestration:status");
      socket.off("orchestration:kanban");
      socket.off("orchestration:started");
      socket.off("orchestration:feedback-received");
      socket.off("orchestration:task-added");
      socket.off("orchestration:task-moved");
    };
  }, [socket, connected]);

  const startRequest = () => {
    if (!userRequest.trim()) return;
    setLoading(true);
    socket?.emit("orchestration:start", { request: userRequest });
    setShowStartDialog(false);
    setUserRequest("");
  };

  const submitFeedback = (approved: boolean) => {
    setLoading(true);
    socket?.emit("orchestration:feedback", { feedback, approved });
  };

  const moveTask = (taskId: string, newStatus: string) => {
    socket?.emit("orchestration:move-task", { task_id: taskId, status: newStatus });
  };

  const refresh = () => {
    socket?.emit("orchestration:status");
    socket?.emit("orchestration:kanban");
  };

  const columns: { key: keyof KanbanBoard; title: string; color: string }[] = [
    { key: "Backlog", title: "Backlog", color: "gray" },
    { key: "To Do", title: "To Do", color: "yellow" },
    { key: "In Progress", title: "In Progress", color: "blue" },
    { key: "Review", title: "Review", color: "purple" },
    { key: "Done", title: "Done", color: "emerald" },
  ];

  return (
    <div className="p-8 lg:p-12 max-w-7xl mx-auto">
      <header className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-light tracking-tight mb-2">Agent Orchestration</h1>
            <p className="text-white/40">Multi-agent workflow with human-in-the-loop</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={refresh}
              disabled={!connected}
              className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors"
            >
              <RefreshCw size={18} className="text-white/60" />
            </button>
            <button
              onClick={() => setShowStartDialog(true)}
              disabled={!connected || loading}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-white/10 disabled:text-white/30 text-black text-sm font-medium rounded-lg transition-colors"
            >
              <Play size={16} />
              Start Request
            </button>
          </div>
        </div>
      </header>

      {/* Status Bar */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${orchStatus?.current_phase !== 'idle' ? 'bg-emerald-400' : 'bg-white/20'}`} />
            <span className="text-sm text-white/60">Phase:</span>
            <span className="text-sm text-white/80 font-medium">{orchStatus?.current_phase || 'idle'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-white/40">|</span>
            <span className="text-sm text-white/60">Tasks:</span>
            <span className="text-sm text-white/80">{orchStatus?.task_count || 0}</span>
          </div>
          {orchStatus?.active_request_id && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-white/40">|</span>
              <span className="text-sm text-white/60">Request:</span>
              <span className="text-sm text-emerald-400 font-mono">{orchStatus.active_request_id}</span>
            </div>
          )}
        </div>
        {orchStatus?.user_changes_pending && (
          <button
            onClick={() => setShowFeedbackDialog(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 rounded-lg transition-colors"
          >
            <AlertCircle size={14} className="text-amber-400" />
            <span className="text-xs text-amber-400">Review Required</span>
          </button>
        )}
      </div>

      {/* Kanban Board */}
      <div className="grid grid-cols-5 gap-4 min-h-[60vh]">
        {columns.map((col) => (
          <KanbanColumn
            key={col.key}
            title={col.title}
            color={col.color}
            tasks={kanban[col.key] || []}
            onMoveTask={moveTask}
          />
        ))}
      </div>

      {/* Start Request Dialog */}
      {showStartDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 w-full max-w-lg">
            <h3 className="text-lg font-light mb-4">Start New Request</h3>
            <textarea
              value={userRequest}
              onChange={(e) => setUserRequest(e.target.value)}
              placeholder="Describe what you want the agents to work on..."
              className="w-full h-32 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50 resize-none"
            />
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => setShowStartDialog(false)}
                className="px-4 py-2 text-sm text-white/60 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={startRequest}
                disabled={!userRequest.trim() || loading}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-white/10 disabled:text-white/30 text-black text-sm font-medium rounded-lg transition-colors"
              >
                {loading ? "Starting..." : "Start"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Feedback Dialog */}
      {showFeedbackDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 w-full max-w-lg">
            <h3 className="text-lg font-light mb-4">Review & Feedback</h3>
            <p className="text-sm text-white/40 mb-4">
              Review the current deliverables and provide feedback.
            </p>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Provide feedback or approval..."
              className="w-full h-32 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-emerald-500/50 resize-none"
            />
            <div className="flex justify-between mt-4">
              <button
                onClick={() => { setShowFeedbackDialog(false); submitFeedback(false); }}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-sm rounded-lg transition-colors"
              >
                <X size={16} />
                Request Changes
              </button>
              <button
                onClick={() => { setShowFeedbackDialog(false); submitFeedback(true); }}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-white/10 disabled:text-white/30 text-black text-sm font-medium rounded-lg transition-colors"
              >
                <Check size={16} />
                Approve
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KanbanColumn({
  title,
  color,
  tasks,
  onMoveTask,
}: {
  title: string;
  color: string;
  tasks: KanbanTask[];
  onMoveTask: (taskId: string, newStatus: string) => void;
}) {
  const colors: Record<string, { border: string; dot: string; header: string }> = {
    gray: { border: "border-white/5", dot: "bg-white/20", header: "text-white/40" },
    yellow: { border: "border-yellow-500/20", dot: "bg-yellow-400", header: "text-yellow-400" },
    blue: { border: "border-blue-500/20", dot: "bg-blue-400", header: "text-blue-400" },
    purple: { border: "border-purple-500/20", dot: "bg-purple-400", header: "text-purple-400" },
    emerald: { border: "border-emerald-500/20", dot: "bg-emerald-400", header: "text-emerald-400" },
  };

  const style = colors[color] || colors.gray;
  const statusMap: Record<string, string> = {
    "Backlog": "Backlog",
    "To Do": "To Do",
    "In Progress": "In Progress",
    "Review": "Review",
    "Done": "Done",
  };

  return (
    <div className={`bg-white/[0.02] border ${style.border} rounded-xl p-4 min-h-[400px]`}>
      <div className="flex items-center gap-2 mb-4">
        <div className={`w-2 h-2 rounded-full ${style.dot}`} />
        <h3 className={`text-sm font-medium ${style.header}`}>{title}</h3>
        <span className="text-xs text-white/30 ml-auto bg-white/5 px-2 py-0.5 rounded-full">
          {tasks.length}
        </span>
      </div>
      <div className="space-y-3">
        {tasks.map((task) => (
          <KanbanTaskCard
            key={task.id}
            task={task}
            onMove={onMoveTask}
            currentStatus={statusMap[title]}
          />
        ))}
        {tasks.length === 0 && (
          <div className="border border-dashed border-white/5 rounded-lg py-8 text-center">
            <p className="text-xs text-white/20">No tasks</p>
          </div>
        )}
      </div>
    </div>
  );
}

function KanbanTaskCard({
  task,
  onMove,
  currentStatus,
}: {
  task: KanbanTask;
  onMove: (taskId: string, newStatus: string) => void;
  currentStatus: string;
}) {
  const [showMenu, setShowMenu] = useState(false);

  const availableStatuses = ["Backlog", "To Do", "In Progress", "Review", "Done"].filter(
    (s) => s !== currentStatus
  );

  return (
    <div className="bg-white/5 border border-white/10 rounded-lg p-3 hover:border-white/20 transition-colors group">
      <div className="flex items-start justify-between mb-2">
        <span className="text-xs font-mono text-white/30">{task.id}</span>
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-1 hover:bg-white/5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Plus size={12} className="text-white/40" />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-6 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-lg py-1 z-10 min-w-[120px]">
              {availableStatuses.map((status) => (
                <button
                  key={status}
                  onClick={() => {
                    onMove(task.id, status);
                    setShowMenu(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-white/60 hover:text-white hover:bg-white/5"
                >
                  Move to {status}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <p className="text-sm text-white/80 mb-2 line-clamp-2">{task.description}</p>
      <div className="flex items-center gap-2 flex-wrap">
        {task.assigned_to.map((agent) => (
          <span
            key={agent}
            className="text-[10px] px-1.5 py-0.5 bg-white/5 text-white/40 rounded"
          >
            {agent}
          </span>
        ))}
      </div>
    </div>
  );
}
