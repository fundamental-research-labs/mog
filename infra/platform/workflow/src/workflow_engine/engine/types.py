"""
Core types for the workflow engine.

This module defines the fundamental data types used throughout the workflow
engine. All types must be JSON-serializable to support durable execution
across restarts and runtime migrations (local -> cloud).

Design Principles:
- All state must be JSON-serializable (no pickle)
- Types use dataclasses with explicit serialization
- Enums for status values ensure type safety
- Abstract base classes for storage enable multiple backends
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta
from enum import Enum
from typing import (
    Any,
    Callable,
    Dict,
    Generic,
    List,
    Literal,
    Optional,
    Protocol,
    Sequence,
    TypeVar,
    Union,
)


# =============================================================================
# Enums
# =============================================================================


class InstanceStatus(str, Enum):
    """
    Status of a workflow instance.

    Lifecycle: PENDING -> RUNNING -> (WAITING|COMPLETED|FAILED|CANCELLED)

    WAITING can transition back to RUNNING when an event arrives or timeout fires.
    """
    PENDING = "pending"       # Created but not yet started
    RUNNING = "running"       # Actively executing a step
    WAITING = "waiting"       # Waiting for external event or timer
    COMPLETED = "completed"   # Successfully finished
    FAILED = "failed"         # Permanently failed (after retries exhausted)
    CANCELLED = "cancelled"   # Cancelled by user or system


class StepStatus(str, Enum):
    """Status of a single step execution."""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    RETRYING = "retrying"
    SKIPPED = "skipped"  # For compensation or conditional paths


class TriggerType(str, Enum):
    """Types of events that can trigger a workflow."""
    RECORD_CREATED = "record:created"
    RECORD_UPDATED = "record:updated"
    RECORD_DELETED = "record:deleted"
    CELL_CHANGED = "cell:changed"
    RELATION_LINKED = "relation:linked"
    RELATION_UNLINKED = "relation:unlinked"
    SCHEDULE = "schedule"
    WEBHOOK = "webhook"
    MANUAL = "manual"
    WORKFLOW_SPAWNED = "workflow:spawned"
    WORKFLOW_SIGNAL = "workflow:signal"


class RuntimeType(str, Enum):
    """Where the workflow is executing."""
    LOCAL = "local"   # Browser (Pyodide)
    CLOUD = "cloud"   # Server (Python)


class VersioningStrategy(str, Enum):
    """How to handle running instances when deploying new workflow version."""
    REPLACE = "replace"    # New instances use new code; running continue on old
    PARALLEL = "parallel"  # Both versions run independently
    MIGRATE = "migrate"    # Running instances migrated via migration function


class BackoffStrategy(str, Enum):
    """Retry backoff strategies."""
    FIXED = "fixed"           # Same delay each time
    LINEAR = "linear"         # delay * attempt_number
    EXPONENTIAL = "exponential"  # delay * 2^attempt_number


# =============================================================================
# Error Types
# =============================================================================


class WorkflowError(Exception):
    """Base exception for all workflow errors."""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}


class RetryableError(WorkflowError):
    """
    Error that should trigger a retry.

    Raise this from step code when a transient failure occurs that
    may succeed on retry (network timeout, rate limit, etc.).

    Example:
        if response.status == 429:
            raise RetryableError("Rate limited", {"retry_after": 60})
    """
    pass


class NonRetryableError(WorkflowError):
    """
    Error that should NOT be retried.

    Raise this from step code when failure is permanent and retrying
    would not help (auth failed, resource not found, invalid input).

    Example:
        if response.status == 401:
            raise NonRetryableError("Authentication failed - check credentials")
    """
    pass


class StepTransitionError(WorkflowError):
    """Error when transitioning between steps fails."""
    pass


class SerializationError(WorkflowError):
    """Error when workflow state cannot be serialized."""
    pass


class DeserializationError(WorkflowError):
    """Error when workflow state cannot be deserialized."""
    pass


class InstanceNotFoundError(WorkflowError):
    """Requested workflow instance does not exist."""
    pass


class WorkflowDefinitionError(WorkflowError):
    """Error in workflow definition (invalid decorators, etc.)."""
    pass


class CancellationError(WorkflowError):
    """Error during workflow cancellation."""
    pass


class VersionMismatchError(WorkflowError):
    """Workflow version incompatibility."""
    pass


# =============================================================================
# Data Classes
# =============================================================================


@dataclass
class StepDefinition:
    """
    Definition of a workflow step extracted from decorated method.

    Attributes:
        name: Step method name
        wait_for_events: Events this step waits for (from @wait_for)
        wait_timeout: Timeout duration for waiting
        retry_config: Retry configuration (from @retry)
        is_parallel: Whether step runs items in parallel (from @parallel)
        max_concurrency: Max parallel workers if is_parallel
    """
    name: str
    wait_for_events: Optional[List[str]] = None
    wait_timeout: Optional[timedelta] = None
    retry_config: Optional["RetryConfig"] = None
    is_parallel: bool = False
    max_concurrency: int = 10

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to JSON-compatible dict."""
        result = {"name": self.name}
        if self.wait_for_events:
            result["wait_for_events"] = self.wait_for_events
        if self.wait_timeout:
            result["wait_timeout_seconds"] = self.wait_timeout.total_seconds()
        if self.retry_config:
            result["retry_config"] = self.retry_config.to_dict()
        if self.is_parallel:
            result["is_parallel"] = True
            result["max_concurrency"] = self.max_concurrency
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "StepDefinition":
        """Deserialize from dict."""
        wait_timeout = None
        if "wait_timeout_seconds" in data:
            wait_timeout = timedelta(seconds=data["wait_timeout_seconds"])

        retry_config = None
        if "retry_config" in data:
            retry_config = RetryConfig.from_dict(data["retry_config"])

        return cls(
            name=data["name"],
            wait_for_events=data.get("wait_for_events"),
            wait_timeout=wait_timeout,
            retry_config=retry_config,
            is_parallel=data.get("is_parallel", False),
            max_concurrency=data.get("max_concurrency", 10),
        )


@dataclass
class RetryConfig:
    """
    Configuration for step retry behavior.

    Attributes:
        max_attempts: Maximum number of attempts (including initial)
        backoff: Backoff strategy
        initial_delay: Delay before first retry
        max_delay: Maximum delay cap
        retryable_errors: List of error types to retry (empty = all RetryableError)
    """
    max_attempts: int = 3
    backoff: BackoffStrategy = BackoffStrategy.EXPONENTIAL
    initial_delay: timedelta = field(default_factory=lambda: timedelta(seconds=1))
    max_delay: timedelta = field(default_factory=lambda: timedelta(minutes=5))
    retryable_errors: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "max_attempts": self.max_attempts,
            "backoff": self.backoff.value,
            "initial_delay_seconds": self.initial_delay.total_seconds(),
            "max_delay_seconds": self.max_delay.total_seconds(),
            "retryable_errors": self.retryable_errors,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "RetryConfig":
        return cls(
            max_attempts=data.get("max_attempts", 3),
            backoff=BackoffStrategy(data.get("backoff", "exponential")),
            initial_delay=timedelta(seconds=data.get("initial_delay_seconds", 1)),
            max_delay=timedelta(seconds=data.get("max_delay_seconds", 300)),
            retryable_errors=data.get("retryable_errors", []),
        )


@dataclass
class TriggerConfig:
    """
    Configuration for workflow trigger.

    Attributes:
        trigger_type: Type of trigger
        table: For record triggers, the table name
        field: For field-specific triggers, the field name
        value: For value-specific triggers, the expected value
        cron: For schedule triggers, the cron expression
        timezone: For schedule triggers, the timezone
        path: For webhook triggers, the URL path
        method: For webhook triggers, the HTTP method
        idempotency_key: Expression for generating idempotency key
    """
    trigger_type: TriggerType
    table: Optional[str] = None
    field: Optional[str] = None
    value: Optional[Any] = None
    cron: Optional[str] = None
    timezone: str = "UTC"
    path: Optional[str] = None
    method: str = "POST"
    idempotency_key: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        result = {"trigger_type": self.trigger_type.value}
        for attr in ["table", "field", "value", "cron", "timezone", "path", "method", "idempotency_key"]:
            val = getattr(self, attr)
            if val is not None:
                result[attr] = val
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "TriggerConfig":
        return cls(
            trigger_type=TriggerType(data["trigger_type"]),
            table=data.get("table"),
            field=data.get("field"),
            value=data.get("value"),
            cron=data.get("cron"),
            timezone=data.get("timezone", "UTC"),
            path=data.get("path"),
            method=data.get("method", "POST"),
            idempotency_key=data.get("idempotency_key"),
        )


@dataclass
class WorkflowDefinition:
    """
    Complete definition of a workflow extracted from decorated class.

    Attributes:
        workflow_id: Unique identifier for workflow type
        name: Human-readable name
        version: Semantic version string
        versioning_strategy: How to handle version upgrades
        runtime: Preferred runtime (local/cloud/auto)
        trigger: Trigger configuration
        steps: Map of step name -> StepDefinition
        entry_step: Name of first step to execute
        class_name: Fully qualified Python class name
    """
    workflow_id: str
    name: str
    version: str
    versioning_strategy: VersioningStrategy
    runtime: Literal["local", "cloud", "auto"]
    trigger: TriggerConfig
    steps: Dict[str, StepDefinition]
    entry_step: str
    class_name: str
    description: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "workflow_id": self.workflow_id,
            "name": self.name,
            "version": self.version,
            "versioning_strategy": self.versioning_strategy.value,
            "runtime": self.runtime,
            "trigger": self.trigger.to_dict(),
            "steps": {k: v.to_dict() for k, v in self.steps.items()},
            "entry_step": self.entry_step,
            "class_name": self.class_name,
            "description": self.description,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "WorkflowDefinition":
        return cls(
            workflow_id=data["workflow_id"],
            name=data["name"],
            version=data["version"],
            versioning_strategy=VersioningStrategy(data["versioning_strategy"]),
            runtime=data["runtime"],
            trigger=TriggerConfig.from_dict(data["trigger"]),
            steps={k: StepDefinition.from_dict(v) for k, v in data["steps"].items()},
            entry_step=data["entry_step"],
            class_name=data["class_name"],
            description=data.get("description", ""),
        )


@dataclass
class StepExecution:
    """
    Record of a single step execution within an instance.

    Attributes:
        step_name: Name of the step
        status: Current status
        attempt: Current attempt number (1-indexed)
        started_at: When step started
        completed_at: When step completed (if finished)
        result: Return value from step (for transitions)
        error: Error message if failed
        error_type: Type of error (RetryableError, NonRetryableError, etc.)
    """
    step_name: str
    status: StepStatus
    attempt: int = 1
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    result: Optional[Any] = None
    error: Optional[str] = None
    error_type: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        result = {
            "step_name": self.step_name,
            "status": self.status.value,
            "attempt": self.attempt,
        }
        if self.started_at:
            result["started_at"] = self.started_at.isoformat()
        if self.completed_at:
            result["completed_at"] = self.completed_at.isoformat()
        if self.result is not None:
            result["result"] = self.result
        if self.error:
            result["error"] = self.error
        if self.error_type:
            result["error_type"] = self.error_type
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "StepExecution":
        started_at = None
        if "started_at" in data:
            started_at = datetime.fromisoformat(data["started_at"])
        completed_at = None
        if "completed_at" in data:
            completed_at = datetime.fromisoformat(data["completed_at"])

        return cls(
            step_name=data["step_name"],
            status=StepStatus(data["status"]),
            attempt=data.get("attempt", 1),
            started_at=started_at,
            completed_at=completed_at,
            result=data.get("result"),
            error=data.get("error"),
            error_type=data.get("error_type"),
        )


@dataclass
class WorkflowInstance:
    """
    State of a running workflow instance.

    This is the core data structure that gets persisted after each step.
    All fields must be JSON-serializable.

    Attributes:
        instance_id: Unique identifier for this execution
        workflow_id: ID of the workflow definition
        workflow_version: Version of workflow definition used
        status: Current instance status
        runtime: Where instance is currently running
        current_step: Name of current/next step to execute
        step_history: Ordered list of step executions
        instance_state: User's workflow instance variables (JSON dict)
        trigger_event: Event that triggered this instance
        waiting_for: Events we're waiting for (if WAITING)
        wait_timeout_at: When wait times out (if WAITING)
        created_at: When instance was created
        started_at: When execution started
        completed_at: When instance finished
        parent_instance_id: If spawned by another workflow
        correlation_id: For grouping related instances
        metadata: Additional metadata (user_id, etc.)
    """
    instance_id: str
    workflow_id: str
    workflow_version: str
    status: InstanceStatus
    runtime: RuntimeType
    current_step: str
    step_history: List[StepExecution] = field(default_factory=list)
    instance_state: Dict[str, Any] = field(default_factory=dict)
    trigger_event: Dict[str, Any] = field(default_factory=dict)
    waiting_for: Optional[List[str]] = None
    wait_timeout_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    parent_instance_id: Optional[str] = None
    correlation_id: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to JSON-compatible dict for persistence."""
        result = {
            "instance_id": self.instance_id,
            "workflow_id": self.workflow_id,
            "workflow_version": self.workflow_version,
            "status": self.status.value,
            "runtime": self.runtime.value,
            "current_step": self.current_step,
            "step_history": [s.to_dict() for s in self.step_history],
            "instance_state": self.instance_state,
            "trigger_event": self.trigger_event,
            "metadata": self.metadata,
        }
        if self.waiting_for:
            result["waiting_for"] = self.waiting_for
        if self.wait_timeout_at:
            result["wait_timeout_at"] = self.wait_timeout_at.isoformat()
        if self.created_at:
            result["created_at"] = self.created_at.isoformat()
        if self.started_at:
            result["started_at"] = self.started_at.isoformat()
        if self.completed_at:
            result["completed_at"] = self.completed_at.isoformat()
        if self.parent_instance_id:
            result["parent_instance_id"] = self.parent_instance_id
        if self.correlation_id:
            result["correlation_id"] = self.correlation_id
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "WorkflowInstance":
        """Deserialize from dict."""
        def parse_datetime(key: str) -> Optional[datetime]:
            if key in data and data[key]:
                return datetime.fromisoformat(data[key])
            return None

        return cls(
            instance_id=data["instance_id"],
            workflow_id=data["workflow_id"],
            workflow_version=data["workflow_version"],
            status=InstanceStatus(data["status"]),
            runtime=RuntimeType(data["runtime"]),
            current_step=data["current_step"],
            step_history=[StepExecution.from_dict(s) for s in data.get("step_history", [])],
            instance_state=data.get("instance_state", {}),
            trigger_event=data.get("trigger_event", {}),
            waiting_for=data.get("waiting_for"),
            wait_timeout_at=parse_datetime("wait_timeout_at"),
            created_at=parse_datetime("created_at"),
            started_at=parse_datetime("started_at"),
            completed_at=parse_datetime("completed_at"),
            parent_instance_id=data.get("parent_instance_id"),
            correlation_id=data.get("correlation_id"),
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
class PendingTimer:
    """
    Timer waiting to fire.

    Attributes:
        timer_id: Unique identifier
        instance_id: Workflow instance waiting on this timer
        fire_at: When timer should fire
        timer_type: "timeout" (wait_for), "sleep", or "schedule"
        payload: Additional data to pass when timer fires
    """
    timer_id: str
    instance_id: str
    fire_at: datetime
    timer_type: Literal["timeout", "sleep", "schedule"]
    payload: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "timer_id": self.timer_id,
            "instance_id": self.instance_id,
            "fire_at": self.fire_at.isoformat(),
            "timer_type": self.timer_type,
            "payload": self.payload,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PendingTimer":
        return cls(
            timer_id=data["timer_id"],
            instance_id=data["instance_id"],
            fire_at=datetime.fromisoformat(data["fire_at"]),
            timer_type=data["timer_type"],
            payload=data.get("payload", {}),
        )


@dataclass
class WaitingInstance:
    """
    Record of an instance waiting for events.

    Attributes:
        instance_id: The waiting instance
        workflow_id: Workflow type
        waiting_for: List of event types being waited on
        timeout_at: When wait expires (if any)
        filter: Optional filter for event matching
    """
    instance_id: str
    workflow_id: str
    waiting_for: List[str]
    timeout_at: Optional[datetime] = None
    filter: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        result = {
            "instance_id": self.instance_id,
            "workflow_id": self.workflow_id,
            "waiting_for": self.waiting_for,
        }
        if self.timeout_at:
            result["timeout_at"] = self.timeout_at.isoformat()
        if self.filter:
            result["filter"] = self.filter
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "WaitingInstance":
        timeout_at = None
        if "timeout_at" in data and data["timeout_at"]:
            timeout_at = datetime.fromisoformat(data["timeout_at"])
        return cls(
            instance_id=data["instance_id"],
            workflow_id=data["workflow_id"],
            waiting_for=data["waiting_for"],
            timeout_at=timeout_at,
            filter=data.get("filter"),
        )


@dataclass
class DeadLetterEntry:
    """
    Failed workflow instance in the dead letter queue.

    Attributes:
        entry_id: Unique identifier for this entry
        instance_id: Original instance ID
        workflow_id: Workflow type
        workflow_version: Version when failed
        final_state: Instance state at failure
        failure_reason: Why it failed
        failure_type: Type of final error
        step_name: Step where failure occurred
        attempts: Total retry attempts made
        failed_at: When it was moved to DLQ
        can_retry: Whether manual retry is possible
    """
    entry_id: str
    instance_id: str
    workflow_id: str
    workflow_version: str
    final_state: Dict[str, Any]
    failure_reason: str
    failure_type: str
    step_name: str
    attempts: int
    failed_at: datetime
    can_retry: bool = True
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "entry_id": self.entry_id,
            "instance_id": self.instance_id,
            "workflow_id": self.workflow_id,
            "workflow_version": self.workflow_version,
            "final_state": self.final_state,
            "failure_reason": self.failure_reason,
            "failure_type": self.failure_type,
            "step_name": self.step_name,
            "attempts": self.attempts,
            "failed_at": self.failed_at.isoformat(),
            "can_retry": self.can_retry,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "DeadLetterEntry":
        return cls(
            entry_id=data["entry_id"],
            instance_id=data["instance_id"],
            workflow_id=data["workflow_id"],
            workflow_version=data["workflow_version"],
            final_state=data["final_state"],
            failure_reason=data["failure_reason"],
            failure_type=data["failure_type"],
            step_name=data["step_name"],
            attempts=data["attempts"],
            failed_at=datetime.fromisoformat(data["failed_at"]),
            can_retry=data.get("can_retry", True),
            metadata=data.get("metadata", {}),
        )


@dataclass
class StepResult:
    """
    Result of executing a step.

    This is returned by the StepExecutor to indicate what happened
    and what should happen next.

    Attributes:
        success: Whether step completed successfully
        next_step: Name of next step to transition to (if success)
        wait_for_events: Events to wait for before continuing
        wait_timeout: How long to wait before timeout
        error: Error if failed
        error_type: Type of error
        should_retry: Whether to retry (based on error type and retry config)
        retry_delay: How long to wait before retry
    """
    success: bool
    next_step: Optional[str] = None
    wait_for_events: Optional[List[str]] = None
    wait_timeout: Optional[timedelta] = None
    error: Optional[str] = None
    error_type: Optional[str] = None
    should_retry: bool = False
    retry_delay: Optional[timedelta] = None
    output: Optional[Any] = None  # Step return value for parallel results


@dataclass
class EventPayload:
    """
    Event that can trigger or resume workflows.

    Attributes:
        event_type: Type of event (e.g., "record:created", "expense:approved")
        source_id: ID of the source (table, webhook path, etc.)
        record_id: For record events, the record ID
        data: Event data payload
        timestamp: When event occurred
        correlation_id: For correlating related events
    """
    event_type: str
    source_id: Optional[str] = None
    record_id: Optional[str] = None
    data: Dict[str, Any] = field(default_factory=dict)
    timestamp: Optional[datetime] = None
    correlation_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        result = {
            "event_type": self.event_type,
            "data": self.data,
        }
        if self.source_id:
            result["source_id"] = self.source_id
        if self.record_id:
            result["record_id"] = self.record_id
        if self.timestamp:
            result["timestamp"] = self.timestamp.isoformat()
        if self.correlation_id:
            result["correlation_id"] = self.correlation_id
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "EventPayload":
        timestamp = None
        if "timestamp" in data and data["timestamp"]:
            timestamp = datetime.fromisoformat(data["timestamp"])
        return cls(
            event_type=data["event_type"],
            source_id=data.get("source_id"),
            record_id=data.get("record_id"),
            data=data.get("data", {}),
            timestamp=timestamp,
            correlation_id=data.get("correlation_id"),
        )


# =============================================================================
# Abstract Storage Interfaces
# =============================================================================


class InstanceStore(ABC):
    """
    Abstract interface for workflow instance storage.

    Implementations may use SQLite, PostgreSQL, Redis, etc.
    """

    @abstractmethod
    async def save(self, instance: WorkflowInstance) -> None:
        """
        Save/update a workflow instance.

        Must be atomic - either fully saves or not at all.
        """
        pass

    @abstractmethod
    async def get(self, instance_id: str) -> Optional[WorkflowInstance]:
        """Get instance by ID, or None if not found."""
        pass

    @abstractmethod
    async def get_by_status(
        self,
        status: InstanceStatus,
        limit: int = 100,
        workflow_id: Optional[str] = None,
    ) -> List[WorkflowInstance]:
        """Get instances with given status."""
        pass

    @abstractmethod
    async def get_waiting_for_event(
        self,
        event_type: str,
    ) -> List[WaitingInstance]:
        """Get instances waiting for a specific event type."""
        pass

    @abstractmethod
    async def delete(self, instance_id: str) -> bool:
        """Delete an instance. Returns True if existed."""
        pass

    @abstractmethod
    async def exists(self, instance_id: str) -> bool:
        """Check if instance exists."""
        pass


class WorkflowStore(ABC):
    """Abstract interface for workflow definition storage."""

    @abstractmethod
    async def save(self, definition: WorkflowDefinition) -> None:
        """Save/update a workflow definition."""
        pass

    @abstractmethod
    async def get(
        self,
        workflow_id: str,
        version: Optional[str] = None,
    ) -> Optional[WorkflowDefinition]:
        """Get workflow definition. If version is None, get latest."""
        pass

    @abstractmethod
    async def get_all_versions(self, workflow_id: str) -> List[WorkflowDefinition]:
        """Get all versions of a workflow."""
        pass

    @abstractmethod
    async def list_workflows(self) -> List[WorkflowDefinition]:
        """List all workflow definitions (latest versions)."""
        pass

    @abstractmethod
    async def delete(self, workflow_id: str, version: Optional[str] = None) -> bool:
        """Delete workflow. If version is None, delete all versions."""
        pass


class TimerStore(ABC):
    """Abstract interface for timer storage."""

    @abstractmethod
    async def save(self, timer: PendingTimer) -> None:
        """Save a pending timer."""
        pass

    @abstractmethod
    async def get_due_timers(self, before: datetime) -> List[PendingTimer]:
        """Get all timers due to fire before given time."""
        pass

    @abstractmethod
    async def get_by_instance(self, instance_id: str) -> List[PendingTimer]:
        """Get all timers for an instance."""
        pass

    @abstractmethod
    async def delete(self, timer_id: str) -> bool:
        """Delete a timer. Returns True if existed."""
        pass

    @abstractmethod
    async def delete_by_instance(self, instance_id: str) -> int:
        """Delete all timers for an instance. Returns count deleted."""
        pass


class DeadLetterStore(ABC):
    """Abstract interface for dead letter queue storage."""

    @abstractmethod
    async def save(self, entry: DeadLetterEntry) -> None:
        """Save entry to dead letter queue."""
        pass

    @abstractmethod
    async def get(self, entry_id: str) -> Optional[DeadLetterEntry]:
        """Get entry by ID."""
        pass

    @abstractmethod
    async def list_entries(
        self,
        workflow_id: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[DeadLetterEntry]:
        """List dead letter entries."""
        pass

    @abstractmethod
    async def delete(self, entry_id: str) -> bool:
        """Delete entry. Returns True if existed."""
        pass

    @abstractmethod
    async def count(self, workflow_id: Optional[str] = None) -> int:
        """Count entries in dead letter queue."""
        pass


class EventLogStore(ABC):
    """Abstract interface for event/audit log storage."""

    @abstractmethod
    async def log_event(
        self,
        instance_id: str,
        event_type: str,
        data: Dict[str, Any],
        timestamp: Optional[datetime] = None,
    ) -> None:
        """Log an event for auditing."""
        pass

    @abstractmethod
    async def get_instance_events(
        self,
        instance_id: str,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """Get event log for an instance."""
        pass


# =============================================================================
# Context Protocol (for type hints in step methods)
# =============================================================================


class WorkflowContextProtocol(Protocol):
    """
    Protocol defining the context API available within workflow steps.

    This is what users interact with in their step methods:

        @step
        def my_step(self, ctx):
            ctx.records.get("expenses", record_id)
            ctx.apps.crm.create_deal(...)
            ctx.sleep(timedelta(hours=24))
    """

    @property
    def instance_id(self) -> str:
        """Current workflow instance ID."""
        ...

    @property
    def current_step(self) -> str:
        """Name of current step."""
        ...

    @property
    def runtime(self) -> RuntimeType:
        """Current runtime (local or cloud)."""
        ...

    def now(self) -> datetime:
        """Current time (consistent within execution)."""
        ...

    def sleep(self, duration: timedelta) -> None:
        """Pause workflow for duration."""
        ...

    def emit(self, event_type: str, data: Dict[str, Any]) -> None:
        """Emit an event."""
        ...

    def spawn(self, workflow_class: type, input_data: Dict[str, Any]) -> str:
        """Spawn a child workflow. Returns instance ID."""
        ...

    def promote_to_cloud(self) -> None:
        """Explicitly promote to cloud runtime."""
        ...
