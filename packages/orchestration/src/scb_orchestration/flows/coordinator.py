"""Simplified Flow coordinator without CrewAI LLM dependency"""
import uuid
from typing import Optional
from ..state import SwarmState, KanbanTask, StatePersistence


class SwarmCoordinatorFlow:
    """Simple flow coordinator for multi-agent orchestration"""

    def __init__(self, initial_state: Optional[SwarmState] = None, persistence: Optional[StatePersistence] = None):
        self.state = initial_state or SwarmState()
        self.persistence = persistence

    def run(self, inputs: dict) -> dict:
        """Run the flow with inputs"""
        user_request = inputs.get("user_request", "")

        # Initialize kanban if empty
        if not self.state.kanban:
            self.state.kanban = []

        # Generate request ID
        current_req = self.state.active_request_id or f"REQ-{uuid.uuid4().hex[:8]}"
        self.state.active_request_id = current_req

        # Create a task for the request
        task_id = f"T-{len(self.state.kanban) + 1:03d}"
        task = KanbanTask(
            id=task_id,
            project_tag=current_req,
            description=f"Request: {user_request[:100]}...",
            assigned_to=["orchestrator"],
            status="In Progress",
        )
        self.state.kanban.append(task)

        # Create analysis task
        analysis_id = f"T-{len(self.state.kanban) + 1:03d}"
        analysis_task = KanbanTask(
            id=analysis_id,
            project_tag=current_req,
            description=f"Analyze: {user_request[:80]}...",
            assigned_to=["brainstormer"],
            status="To Do",
            dependencies=[task_id],
        )
        self.state.kanban.append(analysis_task)

        self.state.current_phase = "analyze_and_brainstorm"

        # Save state
        if self.persistence:
            self.persistence.save_state(self.state)

        return {
            "request_id": current_req,
            "phase": self.state.current_phase,
            "tasks_created": 2,
        }

    def add_task(self, description: str, assigned_to: list[str], project_tag: Optional[str] = None) -> KanbanTask:
        """Add a new task to the Kanban"""
        task_id = f"T-{len(self.state.kanban) + 1:03d}"
        task = KanbanTask(
            id=task_id,
            project_tag=project_tag or self.state.active_request_id or "REQ-001",
            description=description,
            assigned_to=assigned_to,
            status="To Do",
        )
        self.state.kanban.append(task)
        if self.persistence:
            self.persistence.save_state(self.state)
        return task

    def move_task(self, task_id: str, new_status: str) -> bool:
        """Move a task to a new status"""
        for task in self.state.kanban:
            if task.id == task_id:
                task.status = new_status
                from datetime import datetime
                task.updated_at = datetime.utcnow().isoformat()
                if self.persistence:
                    self.persistence.save_state(self.state)
                return True
        return False

    def get_kanban_board(self) -> dict:
        """Get Kanban board organized by status"""
        board = {
            "Backlog": [],
            "To Do": [],
            "In Progress": [],
            "Review": [],
            "Done": [],
        }
        for task in self.state.kanban:
            if isinstance(task, dict):
                task_dict = task
            else:
                task_dict = task.model_dump() if hasattr(task, 'model_dump') else task.dict()
            if task_dict.get("status") in board:
                board[task_dict["status"]].append(task_dict)
        return board

    def needs_user_input(self) -> bool:
        """Check if flow is waiting for user input"""
        return self.state.current_phase == "validate_as_orchestrator"


def create_flow(persistence: Optional[StatePersistence] = None) -> SwarmCoordinatorFlow:
    """Create and return a new Flow instance"""
    initial_state = None
    if persistence:
        initial_state = persistence.load_state()

    return SwarmCoordinatorFlow(initial_state=initial_state, persistence=persistence)
