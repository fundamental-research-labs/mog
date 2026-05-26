"""
SQLite Store Implementations

For local development and single-instance deployments.
Uses aiosqlite for async SQLite operations.

Schema:
- workflow_definitions: Stores workflow definitions
- workflow_instances: Stores running/completed instances
- timers: Stores pending timers
- workflow_events: Append-only audit log
- dead_letter: Failed instances for retry/inspection
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Any

try:
    import aiosqlite
except ImportError:
    aiosqlite = None  # type: ignore

from .base import (
    WorkflowDefinitionStore,
    InstanceStore,
    TimerStore,
    EventLogStore,
    DeadLetterStore,
    WorkflowDefinition,
    WorkflowInstance,
    Timer,
    WorkflowEvent,
    DeadLetterEntry,
    InstanceStatus,
    TriggerType,
    EventType,
    _generate_id,
    _now,
)


def _require_aiosqlite() -> None:
    """Raise error if aiosqlite is not installed."""
    if aiosqlite is None:
        raise ImportError(
            "aiosqlite is required for SQLite stores. "
            "Install it with: pip install aiosqlite"
        )


# =============================================================================
# Schema Definitions
# =============================================================================

SCHEMA_VERSION = 1

CREATE_TABLES_SQL = f"""
-- Workflow definitions (the code/schema)
CREATE TABLE IF NOT EXISTS workflow_definitions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    description TEXT,
    trigger_json TEXT NOT NULL,
    steps_json TEXT NOT NULL,
    runtime TEXT NOT NULL DEFAULT 'auto',
    versioning_strategy TEXT NOT NULL DEFAULT 'replace',
    code_hash TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    metadata_json TEXT DEFAULT '{{}}',
    UNIQUE(name, version)
);

CREATE INDEX IF NOT EXISTS idx_workflow_definitions_name ON workflow_definitions(name);
CREATE INDEX IF NOT EXISTS idx_workflow_definitions_trigger_type ON workflow_definitions(
    json_extract(trigger_json, '$.type')
);

-- Workflow instances (running/completed workflows)
CREATE TABLE IF NOT EXISTS workflow_instances (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    workflow_name TEXT NOT NULL,
    workflow_version TEXT NOT NULL,
    status TEXT NOT NULL,
    current_step TEXT,
    state_json TEXT NOT NULL DEFAULT '{{}}',
    trigger_event_json TEXT NOT NULL DEFAULT '{{}}',
    step_history_json TEXT NOT NULL DEFAULT '[]',
    waiting_json TEXT,
    runtime TEXT NOT NULL DEFAULT 'local',
    parent_instance_id TEXT,
    idempotency_key TEXT UNIQUE,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    metadata_json TEXT DEFAULT '{{}}',
    FOREIGN KEY (workflow_id) REFERENCES workflow_definitions(id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_instances_status ON workflow_instances(status);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_workflow_id ON workflow_instances(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_parent ON workflow_instances(parent_instance_id);
CREATE INDEX IF NOT EXISTS idx_workflow_instances_idempotency ON workflow_instances(idempotency_key);

-- Timers for scheduled wake-ups
CREATE TABLE IF NOT EXISTS timers (
    id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL,
    fire_at TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_data_json TEXT DEFAULT '{{}}',
    created_at TEXT NOT NULL,
    FOREIGN KEY (instance_id) REFERENCES workflow_instances(id)
);

CREATE INDEX IF NOT EXISTS idx_timers_fire_at ON timers(fire_at);
CREATE INDEX IF NOT EXISTS idx_timers_instance_id ON timers(instance_id);

-- Append-only event log for audit trail
CREATE TABLE IF NOT EXISTS workflow_events (
    id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    step_name TEXT,
    data_json TEXT DEFAULT '{{}}',
    timestamp TEXT NOT NULL,
    FOREIGN KEY (instance_id) REFERENCES workflow_instances(id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_events_instance_id ON workflow_events(instance_id);
CREATE INDEX IF NOT EXISTS idx_workflow_events_timestamp ON workflow_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_workflow_events_type ON workflow_events(event_type);

-- Dead letter queue for failed instances
CREATE TABLE IF NOT EXISTS dead_letter (
    id TEXT PRIMARY KEY,
    instance_json TEXT NOT NULL,
    reason TEXT NOT NULL,
    failed_at TEXT NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_retry_at TEXT,
    metadata_json TEXT DEFAULT '{{}}'
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_workflow_id ON dead_letter(
    json_extract(instance_json, '$.workflow_id')
);

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
);

INSERT OR IGNORE INTO schema_version (version) VALUES ({SCHEMA_VERSION});
"""


# =============================================================================
# SQLite Store Implementations
# =============================================================================


class SQLiteWorkflowDefinitionStore(WorkflowDefinitionStore):
    """SQLite implementation of WorkflowDefinitionStore."""

    def __init__(self, db_path: str | Path) -> None:
        _require_aiosqlite()
        self.db_path = str(db_path)
        self._initialized = False

    async def _get_connection(self) -> "aiosqlite.Connection":
        """Get a database connection, initializing schema if needed."""
        conn = await aiosqlite.connect(self.db_path)
        conn.row_factory = aiosqlite.Row

        if not self._initialized:
            await conn.executescript(CREATE_TABLES_SQL)
            await conn.commit()
            self._initialized = True

        return conn

    async def create(self, definition: WorkflowDefinition) -> str:
        """Create a new workflow definition."""
        if not definition.id:
            definition.id = _generate_id()

        conn = await self._get_connection()
        try:
            await conn.execute(
                """
                INSERT INTO workflow_definitions (
                    id, name, version, description, trigger_json, steps_json,
                    runtime, versioning_strategy, code_hash, created_at, updated_at,
                    metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    definition.id,
                    definition.name,
                    definition.version,
                    definition.description,
                    json.dumps(definition.trigger.to_dict()),
                    json.dumps([s.to_dict() for s in definition.steps]),
                    definition.runtime,
                    definition.versioning_strategy.value if isinstance(definition.versioning_strategy, VersioningStrategy) else definition.versioning_strategy,
                    definition.code_hash,
                    definition.created_at,
                    definition.updated_at,
                    json.dumps(definition.metadata),
                ),
            )
            await conn.commit()
            return definition.id
        finally:
            await conn.close()

    async def get(self, workflow_id: str) -> WorkflowDefinition | None:
        """Get a workflow definition by ID."""
        conn = await self._get_connection()
        try:
            cursor = await conn.execute(
                "SELECT * FROM workflow_definitions WHERE id = ?",
                (workflow_id,),
            )
            row = await cursor.fetchone()
            if not row:
                return None
            return self._row_to_definition(row)
        finally:
            await conn.close()

    async def get_by_name(self, name: str) -> WorkflowDefinition | None:
        """Get the latest version of a workflow definition by name."""
        conn = await self._get_connection()
        try:
            cursor = await conn.execute(
                """
                SELECT * FROM workflow_definitions
                WHERE name = ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (name,),
            )
            row = await cursor.fetchone()
            if not row:
                return None
            return self._row_to_definition(row)
        finally:
            await conn.close()

    async def get_by_name_and_version(
        self, name: str, version: str
    ) -> WorkflowDefinition | None:
        """Get a specific version of a workflow definition."""
        conn = await self._get_connection()
        try:
            cursor = await conn.execute(
                "SELECT * FROM workflow_definitions WHERE name = ? AND version = ?",
                (name, version),
            )
            row = await cursor.fetchone()
            if not row:
                return None
            return self._row_to_definition(row)
        finally:
            await conn.close()

    async def list_versions(self, name: str) -> list[WorkflowDefinition]:
        """List all versions of a workflow definition."""
        conn = await self._get_connection()
        try:
            cursor = await conn.execute(
                "SELECT * FROM workflow_definitions WHERE name = ? ORDER BY version",
                (name,),
            )
            rows = await cursor.fetchall()
            return [self._row_to_definition(row) for row in rows]
        finally:
            await conn.close()

    async def update(self, workflow_id: str, definition: WorkflowDefinition) -> None:
        """Update a workflow definition."""
        definition.updated_at = _now()
        conn = await self._get_connection()
        try:
            cursor = await conn.execute(
                """
                UPDATE workflow_definitions SET
                    name = ?, version = ?, description = ?, trigger_json = ?,
                    steps_json = ?, runtime = ?, versioning_strategy = ?,
                    code_hash = ?, updated_at = ?, metadata_json = ?
                WHERE id = ?
                """,
                (
                    definition.name,
                    definition.version,
                    definition.description,
                    json.dumps(definition.trigger.to_dict()),
                    json.dumps([s.to_dict() for s in definition.steps]),
                    definition.runtime,
                    definition.versioning_strategy.value if isinstance(definition.versioning_strategy, VersioningStrategy) else definition.versioning_strategy,
                    definition.code_hash,
                    definition.updated_at,
                    json.dumps(definition.metadata),
                    workflow_id,
                ),
            )
            if cursor.rowcount == 0:
                raise KeyError(f"Workflow definition {workflow_id} not found")
            await conn.commit()
        finally:
            await conn.close()

    async def delete(self, workflow_id: str) -> None:
        """Delete a workflow definition."""
        conn = await self._get_connection()
        try:
            cursor = await conn.execute(
                "DELETE FROM workflow_definitions WHERE id = ?",
                (workflow_id,),
            )
            if cursor.rowcount == 0:
                raise KeyError(f"Workflow definition {workflow_id} not found")
            await conn.commit()
        finally:
            await conn.close()

    async def list_all(self) -> list[WorkflowDefinition]:
        """List all workflow definitions."""
        conn = await self._get_connection()
        try:
            cursor = await conn.execute("SELECT * FROM workflow_definitions")
            rows = await cursor.fetchall()
            return [self._row_to_definition(row) for row in rows]
        finally:
            await conn.close()

    async def find_by_trigger(
        self, trigger_type: TriggerType, **kwargs: Any
    ) -> list[WorkflowDefinition]:
        """Find workflow definitions matching a trigger."""
        conn = await self._get_connection()
        try:
            # Start with trigger type filter
            trigger_type_value = trigger_type.value if isinstance(trigger_type, TriggerType) else trigger_type
            query = """
                SELECT * FROM workflow_definitions
                WHERE json_extract(trigger_json, '$.type') = ?
            """
            params: list[Any] = [trigger_type_value]

            # Add additional filters
            if "table" in kwargs:
                query += " AND json_extract(trigger_json, '$.table') = ?"
                params.append(kwargs["table"])
            if "field" in kwargs:
                query += " AND json_extract(trigger_json, '$.field') = ?"
                params.append(kwargs["field"])
            if "value" in kwargs:
                query += " AND json_extract(trigger_json, '$.value') = ?"
                params.append(kwargs["value"])
            if "sheet" in kwargs:
                query += " AND json_extract(trigger_json, '$.sheet') = ?"
                params.append(kwargs["sheet"])
            if "path" in kwargs:
                query += " AND json_extract(trigger_json, '$.path') = ?"
                params.append(kwargs["path"])

            cursor = await conn.execute(query, tuple(params))
            rows = await cursor.fetchall()
            return [self._row_to_definition(row) for row in rows]
        finally:
            await conn.close()

    def _row_to_definition(self, row: "aiosqlite.Row") -> WorkflowDefinition:
        """Convert a database row to a WorkflowDefinition."""
        from .base import TriggerConfig, StepDefinition, VersioningStrategy

        return WorkflowDefinition(
            id=row["id"],
            name=row["name"],
            version=row["version"],
            description=row["description"] or "",
            trigger=TriggerConfig.from_dict(json.loads(row["trigger_json"])),
            steps=[StepDefinition.from_dict(s) for s in json.loads(row["steps_json"])],
            runtime=row["runtime"],
            versioning_strategy=VersioningStrategy(row["versioning_strategy"]),
            code_hash=row["code_hash"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            metadata=json.loads(row["metadata_json"]),
        )


# Need to import for type hints
from .base import VersioningStrategy


class SQLiteInstanceStore(InstanceStore):
    """SQLite implementation of InstanceStore."""

    def __init__(self, db_path: str | Path) -> None:
        _require_aiosqlite()
        self.db_path = str(db_path)
        self._initialized = False

    async def _get_connection(self) -> "aiosqlite.Connection":
        """Get a database connection, initializing schema if needed."""
        conn = await aiosqlite.connect(self.db_path)
        conn.row_factory = aiosqlite.Row

        if not self._initialized:
            await conn.executescript(CREATE_TABLES_SQL)
            await conn.commit()
            self._initialized = True

        return conn

    async def create(self, instance: WorkflowInstance) -> str:
        """Create a new instance."""
        if not instance.id:
            instance.id = _generate_id()

        conn = await self._get_connection()
        try:
            await conn.execute(
                """
                INSERT INTO workflow_instances (
                    id, workflow_id, workflow_name, workflow_version, status,
                    current_step, state_json, trigger_event_json, step_history_json,
                    waiting_json, runtime, parent_instance_id, idempotency_key,
                    error, created_at, updated_at, started_at, completed_at,
                    metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    instance.id,
                    instance.workflow_id,
                    instance.workflow_name,
                    instance.workflow_version,
                    instance.status.value if isinstance(instance.status, InstanceStatus) else instance.status,
                    instance.current_step,
                    json.dumps(instance.state),
                    json.dumps(instance.trigger_event),
                    json.dumps([s.to_dict() for s in instance.step_history]),
                    json.dumps(instance.waiting.to_dict()) if instance.waiting else None,
                    instance.runtime.value if isinstance(instance.runtime, RuntimeType) else instance.runtime,
                    instance.parent_instance_id,
                    instance.idempotency_key,
                    instance.error,
                    instance.created_at,
                    instance.updated_at,
                    instance.started_at,
                    instance.completed_at,
                    json.dumps(instance.metadata),
                ),
            )
            await conn.commit()
            return instance.id
        finally:
            await conn.close()

    async def get(self, instance_id: str) -> WorkflowInstance | None:
        """Get an instance by ID."""
        conn = await self._get_connection()
        try:
            cursor = await conn.execute(
                "SELECT * FROM workflow_instances WHERE id = ?",
                (instance_id,),
            )
            row = await cursor.fetchone()
            if not row:
                return None
            return self._row_to_instance(row)
        finally:
            await conn.close()

    async def update(self, instance_id: str, instance: WorkflowInstance) -> None:
        """Update an existing instance."""
        instance.updated_at = _now()
        conn = await self._get_connection()
        try:
            cursor = await conn.execute(
                """
                UPDATE workflow_instances SET
                    workflow_id = ?, workflow_name = ?, workflow_version = ?,
                    status = ?, current_step = ?, state_json = ?,
                    trigger_event_json = ?, step_history_json = ?, waiting_json = ?,
                    runtime = ?, parent_instance_id = ?, idempotency_key = ?,
                    error = ?, updated_at = ?, started_at = ?, completed_at = ?,
                    metadata_json = ?
                WHERE id = ?
                """,
                (
                    instance.workflow_id,
                    instance.workflow_name,
                    instance.workflow_version,
                    instance.status.value if isinstance(instance.status, InstanceStatus) else instance.status,
                    instance.current_step,
                    json.dumps(instance.state),
                    json.dumps(instance.trigger_event),
                    json.dumps([s.to_dict() for s in instance.step_history]),
                    json.dumps(instance.waiting.to_dict()) if instance.waiting else None,
                    instance.runtime.value if isinstance(instance.runtime, RuntimeType) else instance.runtime,
                    instance.parent_instance_id,
                    instance.idempotency_key,
                    instance.error,
                    instance.updated_at,
                    instance.started_at,
                    instance.completed_at,
                    json.dumps(instance.metadata),
                    instance_id,
                ),
            )
            if cursor.rowcount == 0:
                raise KeyError(f"Instance {instance_id} not found")
            await conn.commit()
        finally:
            await conn.close()

    async def delete(self, instance_id: str) -> None:
        """Delete an instance."""
        conn = await self._get_connection()
        try:
            cursor = await conn.execute(
                "DELETE FROM workflow_instances WHERE id = ?",
                (instance_id,),
            )
            if cursor.rowcount == 0:
                raise KeyError(f"Instance {instance_id} not found")
            await conn.commit()
        finally:
            await conn.close()

    async def list_by_status(self, status: InstanceStatus) -> list[WorkflowInstance]:
        """List all instances with a given status."""
        conn = await self._get_connection()
        try:
            status_value = status.value if isinstance(status, InstanceStatus) else status
            cursor = await conn.execute(
                "SELECT * FROM workflow_instances WHERE status = ?",
                (status_value,),
            )
            rows = await cursor.fetchall()
            return [self._row_to_instance(row) for row in rows]
        finally:
            await conn.close()

    async def list_by_workflow(self, workflow_id: str) -> list[WorkflowInstance]:
        """List all instances of a specific workflow."""
        conn = await self._get_connection()
        try:
            cursor = await conn.execute(
                "SELECT * FROM workflow_instances WHERE workflow_id = ?",
                (workflow_id,),
            )
            rows = await cursor.fetchall()
            return [self._row_to_instance(row) for row in rows]
        finally:
            await conn.close()

    async def find_waiting_for_event(self, event_type: str) -> list[WorkflowInstance]:
        """Find instances waiting for a specific event type."""
        conn = await self._get_connection()
        try:
            # SQLite JSON query to find instances where waiting.events contains event_type
            cursor = await conn.execute(
                """
                SELECT * FROM workflow_instances
                WHERE status = 'waiting'
                AND waiting_json IS NOT NULL
                AND (
                    waiting_json LIKE ?
                    OR json_extract(waiting_json, '$.events') LIKE ?
                )
                """,
                (f'%"{event_type}"%', f'%"{event_type}"%'),
            )
            rows = await cursor.fetchall()
            # Filter in Python for exact match
            results = []
            for row in rows:
                instance = self._row_to_instance(row)
                if instance.waiting and event_type in instance.waiting.events:
                    results.append(instance)
            return results
        finally:
            await conn.close()

    async def find_by_idempotency_key(
        self, idempotency_key: str
    ) -> WorkflowInstance | None:
        """Find an instance by its idempotency key."""
        conn = await self._get_connection()
        try:
            cursor = await conn.execute(
                "SELECT * FROM workflow_instances WHERE idempotency_key = ?",
                (idempotency_key,),
            )
            row = await cursor.fetchone()
            if not row:
                return None
            return self._row_to_instance(row)
        finally:
            await conn.close()

    async def list_by_parent(self, parent_instance_id: str) -> list[WorkflowInstance]:
        """List child instances of a parent workflow."""
        conn = await self._get_connection()
        try:
            cursor = await conn.execute(
                "SELECT * FROM workflow_instances WHERE parent_instance_id = ?",
                (parent_instance_id,),
            )
            rows = await cursor.fetchall()
            return [self._row_to_instance(row) for row in rows]
        finally:
            await conn.close()

    async def list_all(self) -> list[WorkflowInstance]:
        """List all instances."""
        conn = await self._get_connection()
        try:
            cursor = await conn.execute("SELECT * FROM workflow_instances")
            rows = await cursor.fetchall()
            return [self._row_to_instance(row) for row in rows]
        finally:
            await conn.close()

    def _row_to_instance(self, row: "aiosqlite.Row") -> WorkflowInstance:
        """Convert a database row to a WorkflowInstance."""
        from .base import StepHistory, WaitingState, RuntimeType

        waiting_data = row["waiting_json"]
        waiting = WaitingState.from_dict(json.loads(waiting_data)) if waiting_data else None

        return WorkflowInstance(
            id=row["id"],
            workflow_id=row["workflow_id"],
            workflow_name=row["workflow_name"],
            workflow_version=row["workflow_version"],
            status=InstanceStatus(row["status"]),
            current_step=row["current_step"],
            state=json.loads(row["state_json"]),
            trigger_event=json.loads(row["trigger_event_json"]),
            step_history=[StepHistory.from_dict(s) for s in json.loads(row["step_history_json"])],
            waiting=waiting,
            runtime=RuntimeType(row["runtime"]),
            parent_instance_id=row["parent_instance_id"],
            idempotency_key=row["idempotency_key"],
            error=row["error"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            started_at=row["started_at"],
            completed_at=row["completed_at"],
            metadata=json.loads(row["metadata_json"]),
        )


# Import RuntimeType for type hints
from .base import RuntimeType


class SQLiteTimerStore(TimerStore):
    """SQLite implementation of TimerStore."""

    def __init__(self, db_path: str | Path) -> None:
        _require_aiosqlite()
        self.db_path = str(db_path)
        self._initialized = False

    async def _get_connection(self) -> "aiosqlite.Connection":
        """Get a database connection, initializing schema if needed."""
        conn = await aiosqlite.connect(self.db_path)
        conn.row_factory = aiosqlite.Row

        if not self._initialized:
            await conn.executescript(CREATE_TABLES_SQL)
            await conn.commit()
            self._initialized = True

        return conn

    async def create(self, timer: Timer) -> str:
        """Create a new timer."""
        if not timer.id:
            timer.id = _generate_id()

        conn = await self._get_connection()
        try:
            await conn.execute(
                """
                INSERT INTO timers (id, instance_id, fire_at, event_type, event_data_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    timer.id,
                    timer.instance_id,
                    timer.fire_at,
                    timer.event_type,
                    json.dumps(timer.event_data),
                    timer.created_at,
                ),
            )
            await conn.commit()
            return timer.id
        finally:
            await conn.close()

    async def get(self, timer_id: str) -> Timer | None:
        """Get a timer by ID."""
        conn = await self._get_connection()
        try:
            cursor = await conn.execute(
                "SELECT * FROM timers WHERE id = ?",
                (timer_id,),
            )
            row = await cursor.fetchone()
            if not row:
                return None
            return self._row_to_timer(row)
        finally:
            await conn.close()

    async def get_due(self, now: datetime) -> list[Timer]:
        """Get all timers that should fire at or before the given time."""
        now_str = now.isoformat() + "Z" if not now.isoformat().endswith("Z") else now.isoformat()
        conn = await self._get_connection()
        try:
            cursor = await conn.execute(
                "SELECT * FROM timers WHERE fire_at <= ? ORDER BY fire_at",
                (now_str,),
            )
            rows = await cursor.fetchall()
            return [self._row_to_timer(row) for row in rows]
        finally:
            await conn.close()

    async def delete(self, timer_id: str) -> None:
        """Delete a timer."""
        conn = await self._get_connection()
        try:
            cursor = await conn.execute(
                "DELETE FROM timers WHERE id = ?",
                (timer_id,),
            )
            if cursor.rowcount == 0:
                raise KeyError(f"Timer {timer_id} not found")
            await conn.commit()
        finally:
            await conn.close()

    async def get_by_instance(self, instance_id: str) -> list[Timer]:
        """Get all timers for a specific workflow instance."""
        conn = await self._get_connection()
        try:
            cursor = await conn.execute(
                "SELECT * FROM timers WHERE instance_id = ?",
                (instance_id,),
            )
            rows = await cursor.fetchall()
            return [self._row_to_timer(row) for row in rows]
        finally:
            await conn.close()

    async def delete_by_instance(self, instance_id: str) -> None:
        """Delete all timers for a specific workflow instance."""
        conn = await self._get_connection()
        try:
            await conn.execute(
                "DELETE FROM timers WHERE instance_id = ?",
                (instance_id,),
            )
            await conn.commit()
        finally:
            await conn.close()

    def _row_to_timer(self, row: "aiosqlite.Row") -> Timer:
        """Convert a database row to a Timer."""
        return Timer(
            id=row["id"],
            instance_id=row["instance_id"],
            fire_at=row["fire_at"],
            event_type=row["event_type"],
            event_data=json.loads(row["event_data_json"]),
            created_at=row["created_at"],
        )


class SQLiteEventLogStore(EventLogStore):
    """SQLite implementation of EventLogStore."""

    def __init__(self, db_path: str | Path) -> None:
        _require_aiosqlite()
        self.db_path = str(db_path)
        self._initialized = False

    async def _get_connection(self) -> "aiosqlite.Connection":
        """Get a database connection, initializing schema if needed."""
        conn = await aiosqlite.connect(self.db_path)
        conn.row_factory = aiosqlite.Row

        if not self._initialized:
            await conn.executescript(CREATE_TABLES_SQL)
            await conn.commit()
            self._initialized = True

        return conn

    async def append(self, event: WorkflowEvent) -> None:
        """Append an event to the log (append-only)."""
        if not event.id:
            event.id = _generate_id()

        conn = await self._get_connection()
        try:
            await conn.execute(
                """
                INSERT INTO workflow_events (id, instance_id, event_type, step_name, data_json, timestamp)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    event.id,
                    event.instance_id,
                    event.event_type.value if isinstance(event.event_type, EventType) else event.event_type,
                    event.step_name,
                    json.dumps(event.data),
                    event.timestamp,
                ),
            )
            await conn.commit()
        finally:
            await conn.close()

    async def get_by_instance(self, instance_id: str) -> list[WorkflowEvent]:
        """Get all events for a specific workflow instance."""
        conn = await self._get_connection()
        try:
            cursor = await conn.execute(
                "SELECT * FROM workflow_events WHERE instance_id = ? ORDER BY timestamp",
                (instance_id,),
            )
            rows = await cursor.fetchall()
            return [self._row_to_event(row) for row in rows]
        finally:
            await conn.close()

    async def get_by_time_range(
        self, start: datetime, end: datetime
    ) -> list[WorkflowEvent]:
        """Get events within a time range."""
        start_str = start.isoformat() + "Z" if not start.isoformat().endswith("Z") else start.isoformat()
        end_str = end.isoformat() + "Z" if not end.isoformat().endswith("Z") else end.isoformat()

        conn = await self._get_connection()
        try:
            cursor = await conn.execute(
                """
                SELECT * FROM workflow_events
                WHERE timestamp >= ? AND timestamp <= ?
                ORDER BY timestamp
                """,
                (start_str, end_str),
            )
            rows = await cursor.fetchall()
            return [self._row_to_event(row) for row in rows]
        finally:
            await conn.close()

    async def get_by_type(self, event_type: EventType) -> list[WorkflowEvent]:
        """Get all events of a specific type."""
        event_type_value = event_type.value if isinstance(event_type, EventType) else event_type
        conn = await self._get_connection()
        try:
            cursor = await conn.execute(
                "SELECT * FROM workflow_events WHERE event_type = ? ORDER BY timestamp",
                (event_type_value,),
            )
            rows = await cursor.fetchall()
            return [self._row_to_event(row) for row in rows]
        finally:
            await conn.close()

    async def count_by_instance(self, instance_id: str) -> int:
        """Count events for a specific instance."""
        conn = await self._get_connection()
        try:
            cursor = await conn.execute(
                "SELECT COUNT(*) FROM workflow_events WHERE instance_id = ?",
                (instance_id,),
            )
            row = await cursor.fetchone()
            return row[0] if row else 0
        finally:
            await conn.close()

    def _row_to_event(self, row: "aiosqlite.Row") -> WorkflowEvent:
        """Convert a database row to a WorkflowEvent."""
        return WorkflowEvent(
            id=row["id"],
            instance_id=row["instance_id"],
            event_type=EventType(row["event_type"]),
            step_name=row["step_name"],
            data=json.loads(row["data_json"]),
            timestamp=row["timestamp"],
        )


class SQLiteDeadLetterStore(DeadLetterStore):
    """SQLite implementation of DeadLetterStore."""

    def __init__(self, db_path: str | Path) -> None:
        _require_aiosqlite()
        self.db_path = str(db_path)
        self._initialized = False

    async def _get_connection(self) -> "aiosqlite.Connection":
        """Get a database connection, initializing schema if needed."""
        conn = await aiosqlite.connect(self.db_path)
        conn.row_factory = aiosqlite.Row

        if not self._initialized:
            await conn.executescript(CREATE_TABLES_SQL)
            await conn.commit()
            self._initialized = True

        return conn

    async def add(self, entry: DeadLetterEntry) -> str:
        """Add an entry to the dead letter queue."""
        if not entry.id:
            entry.id = _generate_id()

        conn = await self._get_connection()
        try:
            await conn.execute(
                """
                INSERT INTO dead_letter (id, instance_json, reason, failed_at, retry_count, last_retry_at, metadata_json)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    entry.id,
                    entry.instance.to_json(),
                    entry.reason,
                    entry.failed_at,
                    entry.retry_count,
                    entry.last_retry_at,
                    json.dumps(entry.metadata),
                ),
            )
            await conn.commit()
            return entry.id
        finally:
            await conn.close()

    async def get(self, entry_id: str) -> DeadLetterEntry | None:
        """Get a dead letter entry by ID."""
        conn = await self._get_connection()
        try:
            cursor = await conn.execute(
                "SELECT * FROM dead_letter WHERE id = ?",
                (entry_id,),
            )
            row = await cursor.fetchone()
            if not row:
                return None
            return self._row_to_entry(row)
        finally:
            await conn.close()

    async def get_by_instance(self, instance_id: str) -> DeadLetterEntry | None:
        """Get dead letter entry for a specific instance."""
        conn = await self._get_connection()
        try:
            cursor = await conn.execute(
                """
                SELECT * FROM dead_letter
                WHERE json_extract(instance_json, '$.id') = ?
                """,
                (instance_id,),
            )
            row = await cursor.fetchone()
            if not row:
                return None
            return self._row_to_entry(row)
        finally:
            await conn.close()

    async def remove(self, entry_id: str) -> None:
        """Remove an entry from the dead letter queue."""
        conn = await self._get_connection()
        try:
            cursor = await conn.execute(
                "DELETE FROM dead_letter WHERE id = ?",
                (entry_id,),
            )
            if cursor.rowcount == 0:
                raise KeyError(f"Dead letter entry {entry_id} not found")
            await conn.commit()
        finally:
            await conn.close()

    async def list_all(self) -> list[DeadLetterEntry]:
        """List all entries in the dead letter queue."""
        conn = await self._get_connection()
        try:
            cursor = await conn.execute("SELECT * FROM dead_letter")
            rows = await cursor.fetchall()
            return [self._row_to_entry(row) for row in rows]
        finally:
            await conn.close()

    async def list_by_workflow(self, workflow_id: str) -> list[DeadLetterEntry]:
        """List dead letter entries for a specific workflow."""
        conn = await self._get_connection()
        try:
            cursor = await conn.execute(
                """
                SELECT * FROM dead_letter
                WHERE json_extract(instance_json, '$.workflow_id') = ?
                """,
                (workflow_id,),
            )
            rows = await cursor.fetchall()
            return [self._row_to_entry(row) for row in rows]
        finally:
            await conn.close()

    async def update_retry_count(
        self, entry_id: str, retry_count: int, last_retry_at: str
    ) -> None:
        """Update retry count for an entry."""
        conn = await self._get_connection()
        try:
            cursor = await conn.execute(
                """
                UPDATE dead_letter SET retry_count = ?, last_retry_at = ?
                WHERE id = ?
                """,
                (retry_count, last_retry_at, entry_id),
            )
            if cursor.rowcount == 0:
                raise KeyError(f"Dead letter entry {entry_id} not found")
            await conn.commit()
        finally:
            await conn.close()

    def _row_to_entry(self, row: "aiosqlite.Row") -> DeadLetterEntry:
        """Convert a database row to a DeadLetterEntry."""
        return DeadLetterEntry(
            id=row["id"],
            instance=WorkflowInstance.from_json(row["instance_json"]),
            reason=row["reason"],
            failed_at=row["failed_at"],
            retry_count=row["retry_count"],
            last_retry_at=row["last_retry_at"],
            metadata=json.loads(row["metadata_json"]),
        )


class SQLiteStores:
    """
    Convenience class that creates all SQLite stores with a shared database.

    Usage:
        stores = SQLiteStores("workflows.db")
        await stores.workflows.create(definition)
        await stores.instances.create(instance)
    """

    def __init__(self, db_path: str | Path) -> None:
        self.db_path = db_path
        self.workflows = SQLiteWorkflowDefinitionStore(db_path)
        self.instances = SQLiteInstanceStore(db_path)
        self.timers = SQLiteTimerStore(db_path)
        self.events = SQLiteEventLogStore(db_path)
        self.dead_letters = SQLiteDeadLetterStore(db_path)

    async def initialize(self) -> None:
        """
        Initialize all stores (creates tables if needed).

        Call this once at startup.
        """
        # Just getting a connection will trigger initialization
        conn = await self.workflows._get_connection()
        await conn.close()
