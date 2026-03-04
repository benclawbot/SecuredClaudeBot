"""API Server for orchestration - provides REST endpoints for the gateway"""
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from typing import Optional
from .state import StatePersistence, SwarmState, OrchestratorConfig
from .flows import create_flow


class OrchestrationHandler(BaseHTTPRequestHandler):
    """HTTP request handler for orchestration API"""

    # Class-level state
    persistence: Optional[StatePersistence] = None
    flow = None

    def _send_json(self, status: int, data: dict):
        """Send JSON response"""
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_GET(self):
        """Handle GET requests"""
        parsed = urlparse(self.path)
        path = parsed.path

        if path == '/health':
            self._send_json(200, {"status": "ok"})
        elif path == '/state':
            # Get current state
            state = self.persistence.load_state()
            self._send_json(200, state.model_dump())
        elif path == '/kanban':
            # Get Kanban board
            if not self.flow:
                self.flow = create_flow(self.persistence)
            board = self.flow.get_kanban_board()
            # Convert to serializable format
            board_serializable = {
                status: [task.model_dump() for task in tasks]
                for status, tasks in board.items()
            }
            self._send_json(200, board_serializable)
        elif path == '/status':
            # Get current flow status
            state = self.persistence.load_state()
            self._send_json(200, {
                "current_phase": state.current_phase,
                "user_changes_pending": state.user_changes_pending,
                "active_request_id": state.active_request_id,
                "task_count": len(state.kanban),
            })
        else:
            self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        """Handle POST requests"""
        parsed = urlparse(self.path)
        path = parsed.path

        # Read request body
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length) if content_length > 0 else b''
        try:
            data = json.loads(body) if body else {}
        except json.JSONDecodeError:
            self._send_json(400, {"error": "Invalid JSON"})
            return

        if path == '/start':
            # Start a new orchestration request
            user_request = data.get("request", "")

            self.flow = create_flow(self.persistence)
            result = self.flow.run(inputs={
                "user_request": user_request,
            })

            # Save state
            self.persistence.save_state(self.flow.state)

            self._send_json(200, {
                "status": "started",
                "request_id": self.flow.state.active_request_id,
                "phase": self.flow.state.current_phase,
            })

        elif path == '/feedback':
            # Submit user feedback
            feedback = data.get("feedback", "")
            approved = data.get("approved", False)

            if not self.flow:
                self.flow = create_flow(self.persistence)

            result = self.flow.run(inputs={
                "user_feedback": feedback,
                "approved": approved,
            })

            # Save state
            self.persistence.save_state(self.flow.state)

            self._send_json(200, {
                "status": "feedback_received",
                "phase": self.flow.state.current_phase,
            })

        elif path == '/task':
            # Add a new task
            description = data.get("description", "")
            assigned_to = data.get("assigned_to", [])

            if not self.flow:
                self.flow = create_flow(self.persistence)

            task = self.flow.add_task(description, assigned_to)
            self.persistence.save_state(self.flow.state)

            self._send_json(200, {
                "status": "task_created",
                "task": task.model_dump(),
            })

        elif path == '/task/move':
            # Move a task to a new status
            task_id = data.get("task_id", "")
            new_status = data.get("status", "")

            if not self.flow:
                self.flow = create_flow(self.persistence)

            success = self.flow.move_task(task_id, new_status)
            if success:
                self.persistence.save_state(self.flow.state)
                self._send_json(200, {"status": "task_moved"})
            else:
                self._send_json(404, {"error": "Task not found"})

        else:
            self._send_json(404, {"error": "Not found"})

    def log_message(self, format, *args):
        """Custom logging"""
        print(f"[Orchestration] {args[0]}")


def run_server(host: str = "127.0.0.1", port: int = 18790, db_path: str = "./data/orchestration.db"):
    """Run the orchestration API server"""
    # Initialize persistence
    OrchestrationHandler.persistence = StatePersistence(db_path=db_path)

    # Create initial flow
    OrchestrationHandler.flow = create_flow(OrchestrationHandler.persistence)

    server = HTTPServer((host, port), OrchestrationHandler)
    print(f"[Orchestration] Server running on http://{host}:{port}")
    print(f"[Orchestration] Endpoints:")
    print(f"  GET  /health - Health check")
    print(f"  GET  /state  - Get current state")
    print(f"  GET  /kanban - Get Kanban board")
    print(f"  GET  /status - Get flow status")
    print(f"  POST /start  - Start new request")
    print(f"  POST /feedback - Submit user feedback")
    print(f"  POST /task   - Add new task")
    print(f"  POST /task/move - Move task")

    server.serve_forever()


def main():
    """Main entry point"""
    run_server()


if __name__ == "__main__":
    main()
