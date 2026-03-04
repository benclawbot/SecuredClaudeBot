"""CrewAI Flow coordinator for agent orchestration"""
import uuid
from typing import Optional
from crewai import Flow, Task, Agent
from crewai.flow.flow import persist
from crewai.flow import listen, start, router
from ..state import SwarmState, KanbanTask, StatePersistence


class SwarmCoordinatorFlow(Flow[SwarmState]):
    """Flow coordinator for multi-agent orchestration with human-in-the-loop"""

    def __init__(self, initial_state: Optional[SwarmState] = None, persistence: Optional[StatePersistence] = None):
        super().__init__(state=initial_state or SwarmState())
        self.persistence = persistence

    @persist
    @start()
    def begin_or_resume(self):
        """Start or resume the flow based on current state"""
        if not self.state.kanban:
            self.state.kanban = []

        # Generate new request ID if none active
        current_req = self.state.active_request_id or f"REQ-{uuid.uuid4().hex[:8]}"
        self.state.active_request_id = current_req

        return {
            "request": self.input.get("user_request", ""),
            "request_id": current_req,
            "user_feedback": self.input.get("user_feedback"),
            "approved": self.input.get("approved"),
        }

    @router(begin_or_resume)
    def route(self, inputs):
        """Route to appropriate phase based on state"""
        # Handle user feedback/approval
        if inputs.get("user_feedback"):
            self.state.last_user_feedback = inputs["user_feedback"]
            self.state.user_changes_pending = False
            return "handle_user_changes"

        # Check for approval
        if inputs.get("approved"):
            return "approve_deliverable"

        # Check if anything is in Review
        review_tasks = [t for t in self.state.kanban if t.status == "Review"]
        if review_tasks:
            return "validate_as_orchestrator"

        # Default: analyze and brainstorm
        return "analyze_and_brainstorm"

    @listen("analyze_and_brainstorm")
    @persist
    def analyze_request(self, inputs):
        """Phase 1: Analyze the user request and brainstorm"""
        user_request = inputs.get("request", "")
        request_id = inputs.get("request_id", "REQ-001")

        # Create a brainstorming task
        task_id = self._generate_task_id()
        brainstorm_task = KanbanTask(
            id=task_id,
            project_tag=request_id,
            description=f"Brainstorm: {user_request[:100]}...",
            assigned_to=["brainstormer"],
            status="In Progress",
            proof_of_work="",
        )
        self.state.kanban.append(brainstorm_task)

        # In a full implementation, this would invoke the Brainstormer agent
        # For now, we just create the task

        self.state.current_phase = "analyze_and_brainstorm"

        return {
            "brainstorm_result": f"Analyzed request: {user_request}",
            "task_id": task_id,
        }

    @listen("validate_as_orchestrator")
    @persist
    def validate_deliverable(self, inputs):
        """Phase: Review tasks in Review column"""
        review_tasks = [t for t in self.state.kanban if t.status == "Review"]

        for task in review_tasks:
            # Move to Done if approved, otherwise back to In Progress
            task.status = "Done"
            task.updated_at = self._get_timestamp()

        self.state.current_phase = "validated"

        return {"validated_count": len(review_tasks)}

    @listen("handle_user_changes")
    @persist
    def handle_user_changes(self, inputs):
        """Handle user feedback and changes"""
        feedback = inputs.get("user_feedback", "")

        # Process user feedback - could move tasks, add new ones, etc.
        self.state.user_changes_pending = False
        self.state.current_phase = "idle"

        return {"feedback_received": feedback}

    @listen("approve_deliverable")
    @persist
    def approve_deliverable(self, inputs):
        """Handle approval of deliverable"""
        self.state.current_phase = "idle"
        return {"status": "approved"}

    def _generate_task_id(self) -> str:
        """Generate a unique task ID"""
        if self.persistence:
            self.state.task_counter = self.persistence.load_state().task_counter
            task_id = f"T-{self.state.task_counter + 1:03d}"
            self.state.task_counter += 1
            return task_id
        else:
            self.state.task_counter += 1
            return f"T-{self.state.task_counter:03d}"

    def _get_timestamp(self) -> str:
        """Get current timestamp"""
        from datetime import datetime
        return datetime.utcnow().isoformat()

    def add_task(self, description: str, assigned_to: list[str], project_tag: Optional[str] = None) -> KanbanTask:
        """Add a new task to the Kanban"""
        task_id = self._generate_task_id()
        task = KanbanTask(
            id=task_id,
            project_tag=project_tag or self.state.active_request_id or "REQ-001",
            description=description,
            assigned_to=assigned_to,
            status="To Do",
        )
        self.state.kanban.append(task)
        return task

    def move_task(self, task_id: str, new_status: str) -> bool:
        """Move a task to a new status"""
        for task in self.state.kanban:
            if task.id == task_id:
                task.status = new_status
                task.updated_at = self._get_timestamp()
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
            if task.status in board:
                board[task.status].append(task)
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
