"""State models for agent orchestration"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class KanbanTask(BaseModel):
    """Single task in the Kanban board"""
    id: str = Field(default="", description="Unique task ID e.g. T-001")
    project_tag: str = Field(default="", description="Project/request tag e.g. REQ-20260304-001")
    description: str = Field(default="", description="Task description")
    assigned_to: list[str] = Field(default_factory=list, description="Agent roles assigned")
    status: str = Field(default="Backlog", description="Task status: Backlog | To Do | In Progress | Review | Done")
    dependencies: list[str] = Field(default_factory=list, description="Task IDs this depends on")
    proof_of_work: Optional[str] = Field(default=None, description="Evidence of work: artifact path, code, etc.")
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class SwarmState(BaseModel):
    """Global state for the orchestration system"""
    kanban: list[KanbanTask] = Field(default_factory=list, description="All tasks in the Kanban board")
    active_request_id: Optional[str] = Field(default=None, description="Current active request ID")
    user_changes_pending: bool = Field(default=False, description="Whether user feedback is pending")
    last_user_feedback: Optional[str] = Field(default=None, description="Last feedback from user")
    current_phase: str = Field(default="idle", description="Current flow phase")
    task_counter: int = Field(default=0, description="Counter for generating task IDs")


class OrchestratorConfig(BaseModel):
    """Configuration for the orchestrator"""
    db_path: str = Field(default="./data/orchestration.db", description="SQLite database path")
    llm_provider: str = Field(default="minimax", description="LLM provider to use")
    llm_model: str = Field(default="M2.5", description="LLM model to use")
    auto_save_interval: int = Field(default=30, description="Auto-save interval in seconds")
