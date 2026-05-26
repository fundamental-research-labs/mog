"""
Workflow Engine - Durable Python Workflows for Data OS

This package provides the complete workflow system including:
- Decorators for defining workflows (@workflow, @step, @wait_for, @retry, @parallel)
- Error types for workflow control (RetryableError, NonRetryableError, etc.)
- Type definitions for workflow state and configuration
- Registry for workflow discovery and matching
- Persistence layer (stores) for workflow state
- Testing infrastructure for workflow development
- Cloud runtime for durable workflow execution
- Context API for accessing kernel and app services

Quick Start:
    from workflow_engine import workflow, step, wait_for, retry, parallel
    from workflow_engine import RetryableError, NonRetryableError

    @workflow(trigger="record:created", table="expenses")
    class ExpenseApproval:
        @step
        def start(self, event, ctx):
            self.expense = ctx.records.get("expenses", event["recordId"])
            if self.expense["amount"] <= 500:
                return self.auto_approve()
            return self.request_approval()

        @step
        @wait_for(["approved", "rejected"], timeout="7d")
        def wait_for_decision(self, event, ctx):
            if event is None:  # Timeout
                return self.escalate()
            return self.handle_decision(event)

        @step
        @retry(max_attempts=3, backoff="exponential")
        def sync_external(self, ctx):
            response = ctx.http.post("https://api.example.com/sync")
            if not response.ok:
                raise RetryableError("Sync failed")
            return self.complete()

Testing Example:
    from workflow_engine.stores import InMemoryStores
    from workflow_engine.testing import WorkflowTest, MockContext

    stores = InMemoryStores()

    class TestMyWorkflow(WorkflowTest):
        workflow = MyWorkflow

        def test_happy_path(self):
            ctx = MockContext({...})
            instance = self.trigger(ctx, event={...})
            assert instance.status == "completed"

For full documentation, see the workflow README.
"""

__version__ = "0.1.0"

# =============================================================================
# Decorators - The main user-facing API
# =============================================================================

from .decorators import (
    workflow,
    step,
    wait_for,
    retry,
    parallel,
    # Utility functions
    is_workflow,
    is_step,
    get_workflow_metadata,
    get_step_metadata,
)

# =============================================================================
# Errors - Exceptions users raise in workflows
# =============================================================================

from .errors import (
    # Base error
    WorkflowError,
    # Retry control
    RetryableError,
    NonRetryableError,
    MaxRetriesExceeded,
    # Cancellation
    WorkflowCancelled,
    WorkflowTimeout,
    # Definition errors
    WorkflowDefinitionError,
    StepDefinitionError,
    # Runtime errors
    WorkflowNotFound,
    InstanceNotFound,
    StepNotFound,
    InvalidTransition,
    # State errors
    SerializationError,
    DeserializationError,
    # Promotion errors
    PromotionError,
    # Event errors
    EventDeliveryError,
    DuplicateEventError,
    # Version errors
    VersionMismatchError,
    MigrationError,
)

# =============================================================================
# Types - For type hints and advanced usage
# =============================================================================

from .types import (
    # Enums
    InstanceStatus,
    RuntimeType,
    TriggerType,
    BackoffStrategy,
    VersioningStrategy,
    # Duration parsing
    parse_duration,
    # Trigger configs
    RecordTriggerConfig,
    CellTriggerConfig,
    ScheduleTriggerConfig,
    WebhookTriggerConfig,
    TriggerConfig,
    # Step/Workflow configs
    RetryConfig,
    WaitForConfig,
    ParallelConfig,
    StepMetadata,
    WorkflowMetadata,
    # Event types
    WorkflowEvent,
    # Instance state
    StepExecution,
    InstanceHistory,
    InstanceState,
)

# =============================================================================
# Definitions - For introspection and engine use
# =============================================================================

from .definition import (
    # Definition classes
    StepDefinition,
    WorkflowDefinition,
    StepTransition,
    # Instance helper (mixed into workflow classes)
    WorkflowInstanceHelper,
    # Metadata attribute names
    WORKFLOW_META_ATTR,
    STEP_META_ATTR,
)

# =============================================================================
# Registry - For workflow discovery and lookup
# =============================================================================

from .registry import (
    WorkflowRegistry,
    get_global_registry,
    reset_global_registry,
    discover_workflows,
    TriggerIndex,
)

# =============================================================================
# Persistence Layer - Stores for workflow state
# (May not be available if stores module not yet implemented)
# =============================================================================

try:
    from .stores import (
        # Store implementations
        InMemoryStores,
        SQLiteStores,
        # Abstract base classes
        WorkflowDefinitionStore,
        InstanceStore,
        TimerStore,
        EventLogStore,
        DeadLetterStore,
        # Additional types from stores
        Timer,
        DeadLetterEntry,
    )
    _HAS_STORES = True
except ImportError:
    _HAS_STORES = False

# =============================================================================
# Testing Infrastructure
# (May not be available if testing module not yet implemented)
# =============================================================================

try:
    from .testing import (
        MockContext,
        WorkflowTest,
        TimeTraveler,
        EventSimulator,
        WorkflowAssertions,
    )
    _HAS_TESTING = True
except ImportError:
    _HAS_TESTING = False

# =============================================================================
# Type stub for WorkflowContext (implementation in context module)
# =============================================================================

from typing import TYPE_CHECKING, Any, Dict, List, Literal, Optional
from datetime import datetime, timedelta

if TYPE_CHECKING:
    # This is a stub for IDE support. The real implementation
    # is in platform/workflow/src/workflow_server/context/

    class AppRegistry:
        """Access to app-specific APIs."""
        crm: Any
        finance: Any
        spreadsheet: Any
        analytics: Any
        bug_tracker: Any

    class TablesAPI:
        """Table operations."""
        def find_by_name(self, name: str) -> Dict[str, Any]: ...
        def list(self) -> List[Dict[str, Any]]: ...

    class RecordsAPI:
        """Record CRUD operations."""
        def get(self, table: str, record_id: str) -> Dict[str, Any]: ...
        def list(self, table: str, filter: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]: ...
        def create(self, table: str, data: Dict[str, Any]) -> Dict[str, Any]: ...
        def update(self, table: str, record_id: str, data: Dict[str, Any]) -> Dict[str, Any]: ...
        def delete(self, table: str, record_id: str) -> None: ...

    class HttpClient:
        """HTTP client for external APIs."""
        def get(self, url: str, **kwargs: Any) -> Any: ...
        def post(self, url: str, **kwargs: Any) -> Any: ...
        def put(self, url: str, **kwargs: Any) -> Any: ...
        def delete(self, url: str, **kwargs: Any) -> Any: ...

    class NotificationService:
        """Send notifications."""
        def email(self, *, to: str, subject: str, body: str = "", template: str = "", **kwargs: Any) -> None: ...
        def slack(self, *, channel: str, message: str, **kwargs: Any) -> None: ...
        def toast(self, *, user: str = "", message: str, **kwargs: Any) -> None: ...

    class SecretsManager:
        """Access secrets."""
        def get(self, key: str) -> str: ...

    class WorkflowsAPI:
        """Query and control other workflows."""
        def find(self, **kwargs: Any) -> List[Dict[str, Any]]: ...
        def signal(self, instance_id: str, event_type: str, data: Dict[str, Any]) -> None: ...
        def cancel(self, instance_id: str, reason: str = "") -> None: ...

    class WorkflowConfig:
        """Workflow configuration."""
        company_name: str
        environment: str

    class WorkflowContext:
        """
        Context available within workflow steps.

        This provides access to:
        - App APIs (ctx.apps.crm, ctx.apps.finance, etc.)
        - Kernel APIs (ctx.records, ctx.tables, ctx.relations)
        - HTTP client (ctx.http)
        - Notifications (ctx.notify)
        - Secrets (ctx.secrets)
        - Time operations (ctx.now(), ctx.sleep())
        - Workflow control (ctx.spawn(), ctx.emit())
        """

        # App APIs (high-level)
        apps: AppRegistry

        # Kernel APIs (low-level)
        tables: TablesAPI
        records: RecordsAPI

        # External communication
        http: HttpClient
        notify: NotificationService
        secrets: SecretsManager

        # Workflow control
        workflows: WorkflowsAPI
        config: WorkflowConfig

        # Instance info
        instance_id: str
        current_step: str
        runtime: Literal["local", "cloud"]

        def now(self) -> datetime:
            """Get current time."""
            ...

        def sleep(self, duration: timedelta) -> None:
            """Pause workflow (triggers cloud promotion)."""
            ...

        def spawn(self, workflow_class: type, input: Dict[str, Any]) -> str:
            """Start a child workflow."""
            ...

        def emit(self, event_type: str, data: Dict[str, Any]) -> None:
            """Emit an event."""
            ...

        def promote_to_cloud(self) -> None:
            """Explicitly promote to cloud runtime."""
            ...

        def cancel(self, reason: str = "") -> None:
            """Cancel this workflow."""
            ...


# =============================================================================
# Public API
# =============================================================================

__all__ = [
    "__version__",
    # Decorators
    "workflow",
    "step",
    "wait_for",
    "retry",
    "parallel",
    # Utility functions
    "is_workflow",
    "is_step",
    "get_workflow_metadata",
    "get_step_metadata",
    # Errors
    "WorkflowError",
    "RetryableError",
    "NonRetryableError",
    "MaxRetriesExceeded",
    "WorkflowCancelled",
    "WorkflowTimeout",
    "WorkflowDefinitionError",
    "StepDefinitionError",
    "WorkflowNotFound",
    "InstanceNotFound",
    "StepNotFound",
    "InvalidTransition",
    "SerializationError",
    "DeserializationError",
    "PromotionError",
    "EventDeliveryError",
    "DuplicateEventError",
    "VersionMismatchError",
    "MigrationError",
    # Types
    "InstanceStatus",
    "RuntimeType",
    "TriggerType",
    "BackoffStrategy",
    "VersioningStrategy",
    "parse_duration",
    "RecordTriggerConfig",
    "CellTriggerConfig",
    "ScheduleTriggerConfig",
    "WebhookTriggerConfig",
    "TriggerConfig",
    "RetryConfig",
    "WaitForConfig",
    "ParallelConfig",
    "StepMetadata",
    "WorkflowMetadata",
    "WorkflowEvent",
    "StepExecution",
    "InstanceHistory",
    "InstanceState",
    # Definitions
    "StepDefinition",
    "WorkflowDefinition",
    "StepTransition",
    "WorkflowInstanceHelper",
    "WORKFLOW_META_ATTR",
    "STEP_META_ATTR",
    # Registry
    "WorkflowRegistry",
    "get_global_registry",
    "reset_global_registry",
    "discover_workflows",
    "TriggerIndex",
    # Type hints (only in TYPE_CHECKING)
    "WorkflowContext",
]

# Add stores exports if available
if _HAS_STORES:
    __all__.extend([
        "InMemoryStores",
        "SQLiteStores",
        "WorkflowDefinitionStore",
        "InstanceStore",
        "TimerStore",
        "EventLogStore",
        "DeadLetterStore",
        "Timer",
        "DeadLetterEntry",
    ])

# Add testing exports if available
if _HAS_TESTING:
    __all__.extend([
        "MockContext",
        "WorkflowTest",
        "TimeTraveler",
        "EventSimulator",
        "WorkflowAssertions",
    ])
