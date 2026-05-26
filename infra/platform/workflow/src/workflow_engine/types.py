"""
Shared types for the workflow engine.

This module defines all the core types used throughout the workflow system,
including enums for status, runtime modes, trigger types, and versioning strategies.
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Dict, List, Literal, Optional, TypedDict, Union


# =============================================================================
# Enums
# =============================================================================


class InstanceStatus(Enum):
    """Status of a workflow instance."""

    PENDING = "pending"
    """Instance created but not yet started."""

    RUNNING = "running"
    """Instance is actively executing steps."""

    WAITING = "waiting"
    """Instance is waiting for an external event or timer."""

    COMPLETED = "completed"
    """Instance finished successfully."""

    FAILED = "failed"
    """Instance failed with an error."""

    CANCELLED = "cancelled"
    """Instance was explicitly cancelled."""

    DEAD_LETTERED = "dead_lettered"
    """Instance failed permanently and was moved to dead letter queue."""


class RuntimeType(Enum):
    """Where the workflow executes."""

    LOCAL = "local"
    """Runs in browser (Pyodide). Pauses when browser closes."""

    CLOUD = "cloud"
    """Runs on server. Works even if user is offline."""

    AUTO = "auto"
    """Starts local, promotes to cloud on wait_for/sleep/schedule."""


class TriggerType(Enum):
    """Types of workflow triggers."""

    # Record triggers
    RECORD_CREATED = "record:created"
    RECORD_UPDATED = "record:updated"
    RECORD_DELETED = "record:deleted"

    # Cell triggers (spreadsheet)
    CELL_CHANGED = "cell:changed"

    # Relation triggers
    RELATION_LINKED = "relation:linked"
    RELATION_UNLINKED = "relation:unlinked"

    # Schedule triggers (cloud-only)
    SCHEDULE = "schedule"

    # Webhook triggers (cloud-only)
    WEBHOOK = "webhook"

    # Manual triggers
    MANUAL = "manual"

    # Workflow-to-workflow
    WORKFLOW_SPAWNED = "workflow:spawned"
    WORKFLOW_SIGNAL = "workflow:signal"


class BackoffStrategy(Enum):
    """Retry backoff strategies."""

    FIXED = "fixed"
    """Same delay between each retry."""

    LINEAR = "linear"
    """Delay increases linearly: initial_delay * attempt_number."""

    EXPONENTIAL = "exponential"
    """Delay doubles each retry: initial_delay * 2^(attempt_number - 1)."""


class VersioningStrategy(Enum):
    """How to handle workflow version changes."""

    REPLACE = "replace"
    """New instances use new code. Running instances continue on old code."""

    PARALLEL = "parallel"
    """Both versions run independently. User chooses which to use."""

    MIGRATE = "migrate"
    """Running instances migrated to new version via migration function."""


# =============================================================================
# Duration Parsing
# =============================================================================


def parse_duration(duration_str: str) -> timedelta:
    """
    Parse a human-readable duration string into a timedelta.

    Supported formats:
    - "30s" -> 30 seconds
    - "5m" -> 5 minutes
    - "2h" -> 2 hours
    - "7d" -> 7 days
    - "1w" -> 1 week
    - Combinations: "1h30m", "2d12h"

    Args:
        duration_str: Duration string to parse

    Returns:
        timedelta representing the duration

    Raises:
        ValueError: If the duration string is invalid

    Examples:
        >>> parse_duration("30s")
        timedelta(seconds=30)
        >>> parse_duration("7d")
        timedelta(days=7)
        >>> parse_duration("1h30m")
        timedelta(hours=1, minutes=30)
    """
    if not duration_str:
        raise ValueError("Duration string cannot be empty")

    total_seconds = 0
    current_number = ""

    units = {
        's': 1,
        'm': 60,
        'h': 3600,
        'd': 86400,
        'w': 604800,
    }

    for char in duration_str.lower():
        if char.isdigit() or char == '.':
            current_number += char
        elif char in units:
            if not current_number:
                raise ValueError(f"Missing number before unit '{char}' in '{duration_str}'")
            total_seconds += float(current_number) * units[char]
            current_number = ""
        elif char.isspace():
            continue
        else:
            raise ValueError(f"Unknown character '{char}' in duration '{duration_str}'")

    if current_number:
        raise ValueError(f"Trailing number '{current_number}' without unit in '{duration_str}'")

    if total_seconds == 0:
        raise ValueError(f"Duration '{duration_str}' evaluates to zero")

    return timedelta(seconds=total_seconds)


# =============================================================================
# Trigger Configuration Types
# =============================================================================


@dataclass
class RecordTriggerConfig:
    """Configuration for record-based triggers."""

    table: str
    """Table name to watch."""

    field: Optional[str] = None
    """Specific field to watch (for update triggers)."""

    value: Optional[Any] = None
    """Specific value to match (for update triggers)."""


@dataclass
class CellTriggerConfig:
    """Configuration for cell change triggers (spreadsheet)."""

    sheet: str
    """Sheet name to watch."""

    range: Optional[str] = None
    """Cell range to watch (e.g., "A1:B10"). If None, watches entire sheet."""


@dataclass
class ScheduleTriggerConfig:
    """Configuration for schedule-based triggers (cloud-only)."""

    cron: str
    """Cron expression (e.g., "0 9 * * 1" for Monday 9am)."""

    timezone: str = "UTC"
    """Timezone for the schedule."""


@dataclass
class WebhookTriggerConfig:
    """Configuration for webhook triggers (cloud-only)."""

    path: str
    """Webhook path (e.g., "/stripe-payment")."""

    method: str = "POST"
    """HTTP method to accept."""

    secret: Optional[str] = None
    """Secret for validating webhook signatures."""


TriggerConfig = Union[
    RecordTriggerConfig,
    CellTriggerConfig,
    ScheduleTriggerConfig,
    WebhookTriggerConfig,
    None,  # For manual and workflow:spawned triggers
]


# =============================================================================
# Retry Configuration
# =============================================================================


@dataclass
class RetryConfig:
    """Configuration for step retry behavior."""

    max_attempts: int = 3
    """Maximum number of attempts (including initial attempt)."""

    backoff: BackoffStrategy = BackoffStrategy.EXPONENTIAL
    """Backoff strategy between retries."""

    initial_delay: timedelta = field(default_factory=lambda: timedelta(seconds=1))
    """Initial delay before first retry."""

    max_delay: timedelta = field(default_factory=lambda: timedelta(minutes=1))
    """Maximum delay between retries (caps exponential growth)."""

    retryable_exceptions: Optional[List[type]] = None
    """Exception types to retry. If None, only RetryableError is retried."""

    def calculate_delay(self, attempt: int) -> timedelta:
        """
        Calculate delay before the given retry attempt.

        Args:
            attempt: Retry attempt number (1 for first retry, 2 for second, etc.)

        Returns:
            Delay before this retry attempt
        """
        if attempt <= 0:
            return timedelta(0)

        if self.backoff == BackoffStrategy.FIXED:
            delay = self.initial_delay
        elif self.backoff == BackoffStrategy.LINEAR:
            delay = self.initial_delay * attempt
        elif self.backoff == BackoffStrategy.EXPONENTIAL:
            delay = self.initial_delay * (2 ** (attempt - 1))
        else:
            delay = self.initial_delay

        # Cap at max_delay
        if delay > self.max_delay:
            delay = self.max_delay

        return delay


# =============================================================================
# Wait For Configuration
# =============================================================================


@dataclass
class WaitForConfig:
    """Configuration for @wait_for decorator."""

    events: List[str]
    """Event types to wait for."""

    timeout: Optional[timedelta] = None
    """Maximum time to wait. None means wait forever."""

    timeout_event: Optional[str] = None
    """Event type emitted on timeout. If None, event=None is passed to handler."""


# =============================================================================
# Parallel Configuration
# =============================================================================


@dataclass
class ParallelConfig:
    """Configuration for @parallel decorator."""

    max_concurrency: int = 10
    """Maximum number of concurrent executions."""

    fail_fast: bool = False
    """If True, cancel remaining items on first failure."""

    collect_results: bool = True
    """If True, collect results from all parallel executions."""


# =============================================================================
# Step Metadata
# =============================================================================


@dataclass
class StepMetadata:
    """
    Metadata stored on step methods.

    This is attached to methods decorated with @step and contains
    all configuration from @step, @wait_for, @retry, and @parallel decorators.
    """

    name: str
    """Step name (method name by default)."""

    wait_for: Optional[WaitForConfig] = None
    """Wait for configuration, if @wait_for is applied."""

    retry: Optional[RetryConfig] = None
    """Retry configuration, if @retry is applied."""

    parallel: Optional[ParallelConfig] = None
    """Parallel configuration, if @parallel is applied."""

    is_entry_point: bool = False
    """If True, this step can be the first step in the workflow."""

    description: Optional[str] = None
    """Human-readable description of what this step does."""


# =============================================================================
# Workflow Metadata
# =============================================================================


@dataclass
class WorkflowMetadata:
    """
    Metadata stored on workflow classes.

    This is attached to classes decorated with @workflow and contains
    all trigger and runtime configuration.
    """

    trigger_type: TriggerType
    """Type of trigger that starts this workflow."""

    trigger_config: TriggerConfig
    """Configuration specific to the trigger type."""

    runtime: RuntimeType = RuntimeType.AUTO
    """Where the workflow executes (local, cloud, or auto)."""

    idempotency_key: Optional[str] = None
    """
    Expression to compute idempotency key from event.
    E.g., "event.recordId" means one instance per record.
    """

    version: str = "1.0.0"
    """Semantic version of this workflow."""

    versioning_strategy: VersioningStrategy = VersioningStrategy.REPLACE
    """How to handle version changes for running instances."""

    name: Optional[str] = None
    """Human-readable name. Defaults to class name."""

    description: Optional[str] = None
    """Human-readable description of what this workflow does."""


# =============================================================================
# Event Types
# =============================================================================


class WorkflowEvent(TypedDict, total=False):
    """Event that triggers or signals a workflow."""

    type: str
    """Event type (e.g., "record:created", "expense:approved")."""

    # For record events
    table: str
    recordId: str
    field: str
    value: Any
    previous_value: Any

    # For cell events
    sheet: str
    cell: str
    range: str

    # For webhook events
    path: str
    method: str
    headers: Dict[str, str]
    body: Any

    # For schedule events
    scheduled_time: str

    # For workflow events
    workflow_id: str
    instance_id: str
    input: Dict[str, Any]

    # Common
    timestamp: str
    user_id: Optional[str]


# =============================================================================
# Instance History
# =============================================================================


@dataclass
class StepExecution:
    """Record of a single step execution."""

    step_name: str
    """Name of the step."""

    started_at: datetime
    """When the step started."""

    completed_at: Optional[datetime] = None
    """When the step completed (None if still running)."""

    status: Literal["running", "completed", "failed", "waiting"] = "running"
    """Current status of this step execution."""

    result: Optional[Any] = None
    """Return value from the step (JSON-serializable)."""

    error: Optional[str] = None
    """Error message if step failed."""

    attempt: int = 1
    """Attempt number (1 for first attempt, 2 for first retry, etc.)."""

    next_step: Optional[str] = None
    """Name of the next step to execute."""


@dataclass
class InstanceHistory:
    """Complete execution history of a workflow instance."""

    steps: List[StepExecution] = field(default_factory=list)
    """List of step executions in order."""

    events_received: List[WorkflowEvent] = field(default_factory=list)
    """External events received by this instance."""

    def add_step(self, execution: StepExecution) -> None:
        """Add a step execution to the history."""
        self.steps.append(execution)

    def get_current_step(self) -> Optional[StepExecution]:
        """Get the most recent step execution."""
        return self.steps[-1] if self.steps else None

    def get_step_executions(self, step_name: str) -> List[StepExecution]:
        """Get all executions of a specific step (for retries)."""
        return [s for s in self.steps if s.step_name == step_name]


# =============================================================================
# Instance State
# =============================================================================


@dataclass
class InstanceState:
    """
    Complete state of a workflow instance.

    This must be JSON-serializable for persistence and promotion between runtimes.
    """

    instance_id: str
    """Unique identifier for this instance."""

    workflow_id: str
    """Identifier of the workflow class."""

    workflow_version: str
    """Version of the workflow when instance was created."""

    status: InstanceStatus = InstanceStatus.PENDING
    """Current status."""

    current_step: Optional[str] = None
    """Name of the current step being executed."""

    runtime: RuntimeType = RuntimeType.LOCAL
    """Current runtime where instance is executing."""

    # Instance data (workflow's self.* attributes)
    data: Dict[str, Any] = field(default_factory=dict)
    """JSON-serializable instance variables."""

    # Execution history
    history: InstanceHistory = field(default_factory=InstanceHistory)
    """Complete execution history."""

    # Timing
    created_at: Optional[datetime] = None
    """When the instance was created."""

    started_at: Optional[datetime] = None
    """When the instance started executing."""

    completed_at: Optional[datetime] = None
    """When the instance completed (success or failure)."""

    # Wait state
    waiting_for_events: Optional[List[str]] = None
    """Event types this instance is waiting for."""

    wait_timeout_at: Optional[datetime] = None
    """When the current wait times out."""

    # Error tracking
    error: Optional[str] = None
    """Error message if instance failed."""

    retry_count: int = 0
    """Number of retries attempted for the current step."""

    # Triggering event
    trigger_event: Optional[WorkflowEvent] = None
    """Event that triggered this instance."""

    # Parent/child relationships
    parent_instance_id: Optional[str] = None
    """Instance ID of parent workflow (if spawned)."""

    child_instance_ids: List[str] = field(default_factory=list)
    """Instance IDs of child workflows."""

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert to JSON-serializable dictionary.

        Returns:
            Dictionary suitable for JSON serialization
        """
        return {
            "instance_id": self.instance_id,
            "workflow_id": self.workflow_id,
            "workflow_version": self.workflow_version,
            "status": self.status.value,
            "current_step": self.current_step,
            "runtime": self.runtime.value,
            "data": self.data,
            "history": {
                "steps": [
                    {
                        "step_name": s.step_name,
                        "started_at": s.started_at.isoformat() if s.started_at else None,
                        "completed_at": s.completed_at.isoformat() if s.completed_at else None,
                        "status": s.status,
                        "result": s.result,
                        "error": s.error,
                        "attempt": s.attempt,
                        "next_step": s.next_step,
                    }
                    for s in self.history.steps
                ],
                "events_received": list(self.history.events_received),
            },
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "waiting_for_events": self.waiting_for_events,
            "wait_timeout_at": self.wait_timeout_at.isoformat() if self.wait_timeout_at else None,
            "error": self.error,
            "retry_count": self.retry_count,
            "trigger_event": dict(self.trigger_event) if self.trigger_event else None,
            "parent_instance_id": self.parent_instance_id,
            "child_instance_ids": self.child_instance_ids,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "InstanceState":
        """
        Create InstanceState from dictionary.

        Args:
            data: Dictionary from to_dict()

        Returns:
            Reconstructed InstanceState
        """
        history = InstanceHistory(
            steps=[
                StepExecution(
                    step_name=s["step_name"],
                    started_at=datetime.fromisoformat(s["started_at"]) if s.get("started_at") else datetime.now(),
                    completed_at=datetime.fromisoformat(s["completed_at"]) if s.get("completed_at") else None,
                    status=s.get("status", "running"),
                    result=s.get("result"),
                    error=s.get("error"),
                    attempt=s.get("attempt", 1),
                    next_step=s.get("next_step"),
                )
                for s in data.get("history", {}).get("steps", [])
            ],
            events_received=data.get("history", {}).get("events_received", []),
        )

        return cls(
            instance_id=data["instance_id"],
            workflow_id=data["workflow_id"],
            workflow_version=data.get("workflow_version", "1.0.0"),
            status=InstanceStatus(data.get("status", "pending")),
            current_step=data.get("current_step"),
            runtime=RuntimeType(data.get("runtime", "local")),
            data=data.get("data", {}),
            history=history,
            created_at=datetime.fromisoformat(data["created_at"]) if data.get("created_at") else None,
            started_at=datetime.fromisoformat(data["started_at"]) if data.get("started_at") else None,
            completed_at=datetime.fromisoformat(data["completed_at"]) if data.get("completed_at") else None,
            waiting_for_events=data.get("waiting_for_events"),
            wait_timeout_at=datetime.fromisoformat(data["wait_timeout_at"]) if data.get("wait_timeout_at") else None,
            error=data.get("error"),
            retry_count=data.get("retry_count", 0),
            trigger_event=data.get("trigger_event"),
            parent_instance_id=data.get("parent_instance_id"),
            child_instance_ids=data.get("child_instance_ids", []),
        )
