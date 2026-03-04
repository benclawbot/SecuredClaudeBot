"""State persistence using SQLite"""
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Optional
from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from .models import SwarmState, KanbanTask

Base = declarative_base()


class StateDB(Base):
    """SQLAlchemy model for persisting SwarmState"""
    __tablename__ = 'orchestration_state'

    id = Column(Integer, primary_key=True)
    state_key = Column(String(50), unique=True, default='default')
    kanban_json = Column(Text, default='[]')
    active_request_id = Column(String(100), nullable=True)
    user_changes_pending = Column(Integer, default=0)
    last_user_feedback = Column(Text, nullable=True)
    current_phase = Column(String(50), default='idle')
    task_counter = Column(Integer, default=0)
    updated_at = Column(DateTime, default=datetime.utcnow)


class StatePersistence:
    """Handles persistence of SwarmState to SQLite"""

    def __init__(self, db_path: str = "./data/orchestration.db"):
        self.db_path = db_path
        # Ensure directory exists
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)

        self.engine = create_engine(f"sqlite:///{db_path}")
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)

    def save_state(self, state: SwarmState) -> None:
        """Save state to database"""
        session = self.Session()
        try:
            # Find existing state
            db_state = session.query(StateDB).filter_by(state_key='default').first()

            if db_state:
                # Update existing
                db_state.kanban_json = json.dumps([task.model_dump() for task in state.kanban])
                db_state.active_request_id = state.active_request_id
                db_state.user_changes_pending = int(state.user_changes_pending)
                db_state.last_user_feedback = state.last_user_feedback
                db_state.current_phase = state.current_phase
                db_state.task_counter = state.task_counter
                db_state.updated_at = datetime.utcnow()
            else:
                # Create new
                db_state = StateDB(
                    state_key='default',
                    kanban_json=json.dumps([task.model_dump() for task in state.kanban]),
                    active_request_id=state.active_request_id,
                    user_changes_pending=int(state.user_changes_pending),
                    last_user_feedback=state.last_user_feedback,
                    current_phase=state.current_phase,
                    task_counter=state.task_counter,
                )
                session.add(db_state)

            session.commit()
        finally:
            session.close()

    def load_state(self) -> SwarmState:
        """Load state from database"""
        session = self.Session()
        try:
            db_state = session.query(StateDB).filter_by(state_key='default').first()

            if not db_state:
                return SwarmState()

            kanban = [KanbanTask(**task) for task in json.loads(db_state.kanban_json or '[]')]

            return SwarmState(
                kanban=kanban,
                active_request_id=db_state.active_request_id,
                user_changes_pending=bool(db_state.user_changes_pending),
                last_user_feedback=db_state.last_user_feedback,
                current_phase=db_state.current_phase,
                task_counter=db_state.task_counter,
            )
        finally:
            session.close()

    def generate_task_id(self, state: SwarmState) -> str:
        """Generate a new unique task ID"""
        state.task_counter += 1
        return f"T-{state.task_counter:03d}"
