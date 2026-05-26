"""
Abstract base classes for all workflow stores.

All stores use async operations for consistency and to support
both in-memory (testing) and database (production) implementations.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field, asdict
from datetime import datetime
from enum import Enum
from typing import Any, Generic, TypeVar
import json
import uuid


# =============================================================================
# Enums
# =============================================================================


class InstanceStatus(str, Enum):
    """Status of a workflow instance."""

    PENDING = "pending"  # Created but not started
    RUNNING = "running"  # Currently executing
    WAITING = "waiting"  # Waiting for event/timer
    COMPLETED = "completed"  # Successfully finished
    FAILED = "failed"  # Failed with error
    CANCELLED = "cancelled"  # Manually cancelled
    DEAD_LETTERED = "dead_lettered"  # Moved to dead letter queue


class RuntimeType(str, Enum):
    """Where the workflow is executing."""

    LOCAL = "local"  # Browser (Pyodide)
    CLOUD = "cloud"  # Server (Python)


class TriggerType(str, Enum):
    """Types of workflow triggers."""

    RECORD_CREATED = "record:created"
    RECORD_UPDATED = "record:updated"
    RECORD_DELETED = "record:deleted"
    CELL_CHANGED = "cell:changed"
    RELATION_LINKED = "relation:linked"
    SCHEDULE = "schedule"
    WEBHOOK = "webhook"
    MANUAL = "manual"
    WORKFLOW_SPAWNED = "workflow:spawned"


class VersioningStrategy(str, Enum):
    """How to handle workflow version upgrades."""

    REPLACE = "replace"  # New instances use new code
    PARALLEL = "parallel"  # Both versions run independently
    MIGRATE = "migrate"  # Running instances migrated


class EventType(str, Enum):
    """Types of workflow events for audit log."""

    INSTANCE_CREATED = "instance.created"
    INSTANCE_STARTED = "instance.started"
    STEP_STARTED = "step.started"
    STEP_COMPLETED = "step.completed"
    STEP_FAILED = "step.failed"
    STEP_RETRIED = "step.retried"
    WAITING_FOR_EVENT = "waiting.for_event"
    EVENT_RECEIVED = "event.received"
    TIMER_CREATED = "timer.created"
    TIMER_FIRED = "timer.fired"
    PROMOTED_TO_CLOUD = "promoted.to_cloud"
    INSTANCE_COMPLETED = "instance.completed"
    INSTANCE_FAILED = "instance.failed"
    INSTANCE_CANCELLED = "instance.cancelled"
    INSTANCE_DEAD_LETTERED = "instance.dead_lettered"


# =============================================================================
# Data Classes - JSON Serializable
# =============================================================================


def _generate_id() -> str:
    """Generate a unique ID."""
    return str(uuid.uuid4())


def _now() -> str:
    """Get current timestamp as ISO string."""
    return datetime.utcnow().isoformat() + "Z"


@dataclass
class TriggerConfig:
    """Configuration for a workflow trigger."""

    type: TriggerType
    table: str | None = None
    field: str | None = None
    value: Any = None
    sheet: str | None = None
    range: str | None = None
    cron: str | None = None
    timezone: str = "UTC"
    path: str | None = None  # For webhooks
    method: str = "POST"  # For webhooks
    idempotency_key: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to JSON-serializable dict."""
        return {
            "type": self.type.value if isinstance(self.type, TriggerType) else self.type,
            "table": self.table,
            "field": self.field,
            "value": self.value,
            "sheet": self.sheet,
            "range": self.range,
            "cron": self.cron,
            "timezone": self.timezone,
            "path": self.path,
            "method": self.method,
            "idempotency_key": self.idempotency_key,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "TriggerConfig":
        """Create from dict."""
        return cls(
            type=TriggerType(data["type"]),
            table=data.get("table"),
            field=data.get("field"),
            value=data.get("value"),
            sheet=data.get("sheet"),
            range=data.get("range"),
            cron=data.get("cron"),
            timezone=data.get("timezone", "UTC"),
            path=data.get("path"),
            method=data.get("method", "POST"),
            idempotency_key=data.get("idempotency_key"),
        )


@dataclass
class StepDefinition:
    """Definition of a workflow step."""

    name: str
    wait_for_events: list[str] | None = None
    timeout: str | None = None  # e.g., "7d", "1h"
    retry_max_attempts: int | None = None
    retry_backoff: str | None = None  # "fixed", "linear", "exponential"
    retry_initial_delay: str | None = None
    retry_max_delay: str | None = None
    parallel_max_concurrency: int | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to JSON-serializable dict."""
        return {
            "name": self.name,
            "wait_for_events": self.wait_for_events,
            "timeout": self.timeout,
            "retry_max_attempts": self.retry_max_attempts,
            "retry_backoff": self.retry_backoff,
            "retry_initial_delay": self.retry_initial_delay,
            "retry_max_delay": self.retry_max_delay,
            "parallel_max_concurrency": self.parallel_max_concurrency,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "StepDefinition":
        """Create from dict."""
        return cls(
            name=data["name"],
            wait_for_events=data.get("wait_for_events"),
            timeout=data.get("timeout"),
            retry_max_attempts=data.get("retry_max_attempts"),
            retry_backoff=data.get("retry_backoff"),
            retry_initial_delay=data.get("retry_initial_delay"),
            retry_max_delay=data.get("retry_max_delay"),
            parallel_max_concurrency=data.get("parallel_max_concurrency"),
        )


@dataclass
class WorkflowDefinition:
    """
    Definition of a workflow (the code/class, not a running instance).

    This is stored once per workflow class and referenced by instances.
    """

    id: str
    name: str
    description: str
    version: str
    trigger: TriggerConfig
    steps: list[StepDefinition]
    runtime: str = "auto"  # "local", "cloud", or "auto"
    versioning_strategy: VersioningStrategy = VersioningStrategy.REPLACE
    code_hash: str | None = None  # Hash of Python code for change detection
    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Convert to JSON-serializable dict."""
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "version": self.version,
            "trigger": self.trigger.to_dict(),
            "steps": [s.to_dict() for s in self.steps],
            "runtime": self.runtime,
            "versioning_strategy": (
                self.versioning_strategy.value
                if isinstance(self.versioning_strategy, VersioningStrategy)
                else self.versioning_strategy
            ),
            "code_hash": self.code_hash,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "WorkflowDefinition":
        """Create from dict."""
        return cls(
            id=data["id"],
            name=data["name"],
            description=data.get("description", ""),
            version=data["version"],
            trigger=TriggerConfig.from_dict(data["trigger"]),
            steps=[StepDefinition.from_dict(s) for s in data.get("steps", [])],
            runtime=data.get("runtime", "auto"),
            versioning_strategy=VersioningStrategy(
                data.get("versioning_strategy", "replace")
            ),
            code_hash=data.get("code_hash"),
            created_at=data.get("created_at", _now()),
            updated_at=data.get("updated_at", _now()),
            metadata=data.get("metadata", {}),
        )

    def to_json(self) -> str:
        """Serialize to JSON string."""
        return json.dumps(self.to_dict())

    @classmethod
    def from_json(cls, json_str: str) -> "WorkflowDefinition":
        """Deserialize from JSON string."""
        return cls.from_dict(json.loads(json_str))


@dataclass
class StepHistory:
    """Record of a step execution."""

    step_name: str
    started_at: str
    completed_at: str | None = None
    status: str = "running"  # "running", "completed", "failed", "retrying"
    attempt: int = 1
    error: str | None = None
    output: Any = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to JSON-serializable dict."""
        return {
            "step_name": self.step_name,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "status": self.status,
            "attempt": self.attempt,
            "error": self.error,
            "output": self.output,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "StepHistory":
        """Create from dict."""
        return cls(
            step_name=data["step_name"],
            started_at=data["started_at"],
            completed_at=data.get("completed_at"),
            status=data.get("status", "running"),
            attempt=data.get("attempt", 1),
            error=data.get("error"),
            output=data.get("output"),
        )


@dataclass
class WaitingState:
    """State when waiting for an event."""

    events: list[str]  # Event types we're waiting for
    timeout_at: str | None = None  # ISO timestamp
    timer_id: str | None = None  # Reference to timer if timeout set

    def to_dict(self) -> dict[str, Any]:
        """Convert to JSON-serializable dict."""
        return {
            "events": self.events,
            "timeout_at": self.timeout_at,
            "timer_id": self.timer_id,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "WaitingState":
        """Create from dict."""
        return cls(
            events=data["events"],
            timeout_at=data.get("timeout_at"),
            timer_id=data.get("timer_id"),
        )


@dataclass
class WorkflowInstance:
    """
    A running instance of a workflow.

    All state must be JSON-serializable for cross-runtime portability.
    """

    id: str
    workflow_id: str  # Reference to WorkflowDefinition.id
    workflow_name: str  # Denormalized for convenience
    workflow_version: str  # Version at time of creation
    status: InstanceStatus
    current_step: str | None
    state: dict[str, Any]  # User's workflow instance variables (JSON only!)
    trigger_event: dict[str, Any]  # The event that triggered this instance
    step_history: list[StepHistory] = field(default_factory=list)
    waiting: WaitingState | None = None  # Set when status is WAITING
    runtime: RuntimeType = RuntimeType.LOCAL
    parent_instance_id: str | None = None  # For child workflows
    idempotency_key: str | None = None  # Prevent duplicate instances
    error: str | None = None  # Set when status is FAILED
    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)
    started_at: str | None = None
    completed_at: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Convert to JSON-serializable dict."""
        return {
            "id": self.id,
            "workflow_id": self.workflow_id,
            "workflow_name": self.workflow_name,
            "workflow_version": self.workflow_version,
            "status": (
                self.status.value
                if isinstance(self.status, InstanceStatus)
                else self.status
            ),
            "current_step": self.current_step,
            "state": self.state,
            "trigger_event": self.trigger_event,
            "step_history": [s.to_dict() for s in self.step_history],
            "waiting": self.waiting.to_dict() if self.waiting else None,
            "runtime": (
                self.runtime.value
                if isinstance(self.runtime, RuntimeType)
                else self.runtime
            ),
            "parent_instance_id": self.parent_instance_id,
            "idempotency_key": self.idempotency_key,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "WorkflowInstance":
        """Create from dict."""
        return cls(
            id=data["id"],
            workflow_id=data["workflow_id"],
            workflow_name=data["workflow_name"],
            workflow_version=data["workflow_version"],
            status=InstanceStatus(data["status"]),
            current_step=data.get("current_step"),
            state=data.get("state", {}),
            trigger_event=data.get("trigger_event", {}),
            step_history=[
                StepHistory.from_dict(s) for s in data.get("step_history", [])
            ],
            waiting=(
                WaitingState.from_dict(data["waiting"]) if data.get("waiting") else None
            ),
            runtime=RuntimeType(data.get("runtime", "local")),
            parent_instance_id=data.get("parent_instance_id"),
            idempotency_key=data.get("idempotency_key"),
            error=data.get("error"),
            created_at=data.get("created_at", _now()),
            updated_at=data.get("updated_at", _now()),
            started_at=data.get("started_at"),
            completed_at=data.get("completed_at"),
            metadata=data.get("metadata", {}),
        )

    def to_json(self) -> str:
        """Serialize to JSON string."""
        return json.dumps(self.to_dict())

    @classmethod
    def from_json(cls, json_str: str) -> "WorkflowInstance":
        """Deserialize from JSON string."""
        return cls.from_dict(json.loads(json_str))


@dataclass
class Timer:
    """A scheduled timer for a workflow."""

    id: str
    instance_id: str  # Workflow instance this timer belongs to
    fire_at: str  # ISO timestamp when timer should fire
    event_type: str  # Event to emit when timer fires (e.g., "timeout")
    event_data: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=_now)

    def to_dict(self) -> dict[str, Any]:
        """Convert to JSON-serializable dict."""
        return {
            "id": self.id,
            "instance_id": self.instance_id,
            "fire_at": self.fire_at,
            "event_type": self.event_type,
            "event_data": self.event_data,
            "created_at": self.created_at,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Timer":
        """Create from dict."""
        return cls(
            id=data["id"],
            instance_id=data["instance_id"],
            fire_at=data["fire_at"],
            event_type=data["event_type"],
            event_data=data.get("event_data", {}),
            created_at=data.get("created_at", _now()),
        )

    def to_json(self) -> str:
        """Serialize to JSON string."""
        return json.dumps(self.to_dict())

    @classmethod
    def from_json(cls, json_str: str) -> "Timer":
        """Deserialize from JSON string."""
        return cls.from_dict(json.loads(json_str))


@dataclass
class WorkflowEvent:
    """An event in the workflow audit log."""

    id: str
    instance_id: str
    event_type: EventType
    step_name: str | None = None
    data: dict[str, Any] = field(default_factory=dict)
    timestamp: str = field(default_factory=_now)

    def to_dict(self) -> dict[str, Any]:
        """Convert to JSON-serializable dict."""
        return {
            "id": self.id,
            "instance_id": self.instance_id,
            "event_type": (
                self.event_type.value
                if isinstance(self.event_type, EventType)
                else self.event_type
            ),
            "step_name": self.step_name,
            "data": self.data,
            "timestamp": self.timestamp,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "WorkflowEvent":
        """Create from dict."""
        return cls(
            id=data["id"],
            instance_id=data["instance_id"],
            event_type=EventType(data["event_type"]),
            step_name=data.get("step_name"),
            data=data.get("data", {}),
            timestamp=data.get("timestamp", _now()),
        )

    def to_json(self) -> str:
        """Serialize to JSON string."""
        return json.dumps(self.to_dict())

    @classmethod
    def from_json(cls, json_str: str) -> "WorkflowEvent":
        """Deserialize from JSON string."""
        return cls.from_dict(json.loads(json_str))


@dataclass
class DeadLetterEntry:
    """A workflow instance that has been moved to the dead letter queue."""

    id: str
    instance: WorkflowInstance
    reason: str
    failed_at: str = field(default_factory=_now)
    retry_count: int = 0
    last_retry_at: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Convert to JSON-serializable dict."""
        return {
            "id": self.id,
            "instance": self.instance.to_dict(),
            "reason": self.reason,
            "failed_at": self.failed_at,
            "retry_count": self.retry_count,
            "last_retry_at": self.last_retry_at,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "DeadLetterEntry":
        """Create from dict."""
        return cls(
            id=data["id"],
            instance=WorkflowInstance.from_dict(data["instance"]),
            reason=data["reason"],
            failed_at=data.get("failed_at", _now()),
            retry_count=data.get("retry_count", 0),
            last_retry_at=data.get("last_retry_at"),
            metadata=data.get("metadata", {}),
        )

    def to_json(self) -> str:
        """Serialize to JSON string."""
        return json.dumps(self.to_dict())

    @classmethod
    def from_json(cls, json_str: str) -> "DeadLetterEntry":
        """Deserialize from JSON string."""
        return cls.from_dict(json.loads(json_str))


# =============================================================================
# Abstract Base Classes
# =============================================================================


T = TypeVar("T")


class BaseStore(ABC, Generic[T]):
    """
    Abstract base class for all stores.

    All operations are async to support both sync (in-memory)
    and async (database) implementations consistently.
    """

    @abstractmethod
    async def create(self, item: T) -> str:
        """
        Create a new item.

        Returns:
            The ID of the created item.
        """
        pass

    @abstractmethod
    async def get(self, item_id: str) -> T | None:
        """
        Get an item by ID.

        Returns:
            The item, or None if not found.
        """
        pass

    @abstractmethod
    async def update(self, item_id: str, item: T) -> None:
        """
        Update an existing item.

        Raises:
            KeyError: If item not found.
        """
        pass

    @abstractmethod
    async def delete(self, item_id: str) -> None:
        """
        Delete an item.

        Raises:
            KeyError: If item not found.
        """
        pass

    @abstractmethod
    async def list_all(self) -> list[T]:
        """
        List all items.

        Returns:
            List of all items.
        """
        pass


class WorkflowDefinitionStore(ABC):
    """Abstract store for workflow definitions."""

    @abstractmethod
    async def create(self, definition: WorkflowDefinition) -> str:
        """Create a new workflow definition."""
        pass

    @abstractmethod
    async def get(self, workflow_id: str) -> WorkflowDefinition | None:
        """Get a workflow definition by ID."""
        pass

    @abstractmethod
    async def get_by_name(self, name: str) -> WorkflowDefinition | None:
        """Get a workflow definition by name."""
        pass

    @abstractmethod
    async def get_by_name_and_version(
        self, name: str, version: str
    ) -> WorkflowDefinition | None:
        """Get a specific version of a workflow definition."""
        pass

    @abstractmethod
    async def list_versions(self, name: str) -> list[WorkflowDefinition]:
        """List all versions of a workflow definition."""
        pass

    @abstractmethod
    async def update(self, workflow_id: str, definition: WorkflowDefinition) -> None:
        """Update a workflow definition."""
        pass

    @abstractmethod
    async def delete(self, workflow_id: str) -> None:
        """Delete a workflow definition."""
        pass

    @abstractmethod
    async def list_all(self) -> list[WorkflowDefinition]:
        """List all workflow definitions."""
        pass

    @abstractmethod
    async def find_by_trigger(
        self, trigger_type: TriggerType, **kwargs: Any
    ) -> list[WorkflowDefinition]:
        """
        Find workflow definitions matching a trigger.

        Args:
            trigger_type: The type of trigger
            **kwargs: Trigger-specific filters (table, field, value, etc.)
        """
        pass


class InstanceStore(ABC):
    """Abstract store for workflow instances."""

    @abstractmethod
    async def create(self, instance: WorkflowInstance) -> str:
        """Create a new instance. Returns instance_id."""
        pass

    @abstractmethod
    async def get(self, instance_id: str) -> WorkflowInstance | None:
        """Get an instance by ID."""
        pass

    @abstractmethod
    async def update(self, instance_id: str, instance: WorkflowInstance) -> None:
        """Update an existing instance."""
        pass

    @abstractmethod
    async def delete(self, instance_id: str) -> None:
        """Delete an instance."""
        pass

    @abstractmethod
    async def list_by_status(self, status: InstanceStatus) -> list[WorkflowInstance]:
        """List all instances with a given status."""
        pass

    @abstractmethod
    async def list_by_workflow(self, workflow_id: str) -> list[WorkflowInstance]:
        """List all instances of a specific workflow."""
        pass

    @abstractmethod
    async def find_waiting_for_event(
        self, event_type: str
    ) -> list[WorkflowInstance]:
        """Find instances waiting for a specific event type."""
        pass

    @abstractmethod
    async def find_by_idempotency_key(
        self, idempotency_key: str
    ) -> WorkflowInstance | None:
        """Find an instance by its idempotency key."""
        pass

    @abstractmethod
    async def list_by_parent(self, parent_instance_id: str) -> list[WorkflowInstance]:
        """List child instances of a parent workflow."""
        pass

    @abstractmethod
    async def list_all(self) -> list[WorkflowInstance]:
        """List all instances."""
        pass


class TimerStore(ABC):
    """Abstract store for pending timers."""

    @abstractmethod
    async def create(self, timer: Timer) -> str:
        """Create a new timer. Returns timer_id."""
        pass

    @abstractmethod
    async def get(self, timer_id: str) -> Timer | None:
        """Get a timer by ID."""
        pass

    @abstractmethod
    async def get_due(self, now: datetime) -> list[Timer]:
        """Get all timers that should fire at or before the given time."""
        pass

    @abstractmethod
    async def delete(self, timer_id: str) -> None:
        """Delete a timer."""
        pass

    @abstractmethod
    async def get_by_instance(self, instance_id: str) -> list[Timer]:
        """Get all timers for a specific workflow instance."""
        pass

    @abstractmethod
    async def delete_by_instance(self, instance_id: str) -> None:
        """Delete all timers for a specific workflow instance."""
        pass


class EventLogStore(ABC):
    """Abstract store for workflow event audit trail."""

    @abstractmethod
    async def append(self, event: WorkflowEvent) -> None:
        """Append an event to the log (append-only)."""
        pass

    @abstractmethod
    async def get_by_instance(self, instance_id: str) -> list[WorkflowEvent]:
        """Get all events for a specific workflow instance."""
        pass

    @abstractmethod
    async def get_by_time_range(
        self, start: datetime, end: datetime
    ) -> list[WorkflowEvent]:
        """Get events within a time range."""
        pass

    @abstractmethod
    async def get_by_type(self, event_type: EventType) -> list[WorkflowEvent]:
        """Get all events of a specific type."""
        pass

    @abstractmethod
    async def count_by_instance(self, instance_id: str) -> int:
        """Count events for a specific instance."""
        pass


class DeadLetterStore(ABC):
    """Abstract store for dead-lettered workflow instances."""

    @abstractmethod
    async def add(self, entry: DeadLetterEntry) -> str:
        """Add an entry to the dead letter queue."""
        pass

    @abstractmethod
    async def get(self, entry_id: str) -> DeadLetterEntry | None:
        """Get a dead letter entry by ID."""
        pass

    @abstractmethod
    async def get_by_instance(self, instance_id: str) -> DeadLetterEntry | None:
        """Get dead letter entry for a specific instance."""
        pass

    @abstractmethod
    async def remove(self, entry_id: str) -> None:
        """Remove an entry from the dead letter queue (e.g., after retry)."""
        pass

    @abstractmethod
    async def list_all(self) -> list[DeadLetterEntry]:
        """List all entries in the dead letter queue."""
        pass

    @abstractmethod
    async def list_by_workflow(self, workflow_id: str) -> list[DeadLetterEntry]:
        """List dead letter entries for a specific workflow."""
        pass

    @abstractmethod
    async def update_retry_count(
        self, entry_id: str, retry_count: int, last_retry_at: str
    ) -> None:
        """Update retry count for an entry."""
        pass
