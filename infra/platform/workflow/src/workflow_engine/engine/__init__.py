"""
Workflow Engine Core - Durable Python Workflow Execution.

This package provides the core workflow engine components for executing
durable Python workflows. The engine supports:

- **Durable Execution**: State is persisted after each step, surviving crashes
- **Event-Driven**: Workflows can wait for external events with timeouts
- **Retry & Backoff**: Automatic retries with configurable backoff strategies
- **Versioning**: Multiple workflow versions with migration support
- **Cancellation**: Graceful cancellation with optional compensation

Architecture Overview:
----------------------

    +------------------+     +------------------+     +------------------+
    |  Event Router    |     |  Timer Service   |     | Version Manager  |
    |  (triggers/wake) |     | (timeouts/cron)  |     | (upgrades/migrate)|
    +--------+---------+     +--------+---------+     +--------+---------+
             |                        |                        |
             v                        v                        v
    +--------+---------+     +--------+---------+     +--------+---------+
    | Instance Manager |<--->| Step Executor    |<--->| Retry Handler    |
    | (CRUD/lifecycle) |     | (run steps)      |     | (backoff/DLQ)    |
    +--------+---------+     +--------+---------+     +--------+---------+
             |                        |                        |
             v                        v                        v
    +--------+---------+     +--------+---------+     +--------+---------+
    | Instance Store   |     | Workflow Store   |     | Dead Letter Store|
    | (persistence)    |     | (definitions)    |     | (failed entries) |
    +------------------+     +------------------+     +------------------+

Usage Example:
--------------

    from workflow_engine.engine import (
        InstanceManager,
        StepExecutor,
        EventRouter,
        TimerService,
        RetryHandler,
        CancellationHandler,
        DeadLetterQueue,
        VersionManager,
    )

    # Initialize stores (abstract - use concrete implementations)
    instance_store = PostgresInstanceStore(...)
    workflow_store = PostgresWorkflowStore(...)
    timer_store = PostgresTimerStore(...)
    dead_letter_store = PostgresDeadLetterStore(...)

    # Create engine components
    instance_manager = InstanceManager(
        instance_store=instance_store,
        workflow_store=workflow_store,
        timer_store=timer_store,
        dead_letter_store=dead_letter_store,
    )

    step_executor = StepExecutor(workflow_store=workflow_store)

    event_router = EventRouter(
        instance_store=instance_store,
        workflow_store=workflow_store,
    )

    timer_service = TimerService(
        timer_store=timer_store,
        instance_store=instance_store,
    )

    # Register workflow
    step_executor.register_workflow("ExpenseApproval", ExpenseApprovalWorkflow)

    # Create instance from trigger
    instance = await instance_manager.create_instance(
        workflow_id="ExpenseApproval",
        trigger_event=EventPayload(...),
    )

    # Execute step
    result = await step_executor.execute_step(
        instance=instance,
        context=workflow_context,
    )

    # Handle result
    if result.success:
        if result.wait_for_events:
            await instance_manager.transition_to_waiting(
                instance,
                waiting_for=result.wait_for_events,
                timeout_at=...,
            )
        elif result.next_step:
            instance.current_step = result.next_step
            await instance_manager.save_instance(instance)
        else:
            await instance_manager.transition_to_completed(instance)
    else:
        # Handle failure with retry logic
        ...

Module Reference:
-----------------

types:
    Core data types, enums, and abstract storage interfaces.
    - WorkflowInstance, StepExecution, EventPayload
    - InstanceStatus, StepStatus, TriggerType
    - InstanceStore, WorkflowStore, TimerStore (abstracts)

instance_manager:
    Workflow instance lifecycle management.
    - Create, load, persist instances
    - Status transitions (running, waiting, completed, failed)
    - Crash recovery (load incomplete instances)

step_executor:
    Step execution and state management.
    - Execute step methods with context
    - Handle return values (transitions)
    - Classify and handle errors

event_router:
    Event matching and routing.
    - Match events to waiting instances
    - Match events to workflow triggers
    - Support for filters and correlation

timer_service:
    Timer management for delays and schedules.
    - @wait_for timeouts
    - ctx.sleep() delays
    - Cron-based scheduling

retry_handler:
    Retry logic with backoff strategies.
    - Exponential, linear, fixed backoff
    - Max attempts tracking
    - Dead letter routing

cancellation:
    Workflow cancellation with compensation.
    - Graceful cancellation
    - Compensation execution
    - Cascading to child workflows

dead_letter:
    Dead letter queue for failed workflows.
    - Store failed instances
    - Manual retry support
    - Failure analytics

version_manager:
    Workflow versioning and migrations.
    - Register multiple versions
    - Version strategies (replace, parallel, migrate)
    - State migration functions
"""

# =============================================================================
# Types and Data Classes
# =============================================================================

from .types import (
    # Enums
    InstanceStatus,
    StepStatus,
    TriggerType,
    RuntimeType,
    VersioningStrategy,
    BackoffStrategy,
    # Errors
    WorkflowError,
    RetryableError,
    NonRetryableError,
    StepTransitionError,
    SerializationError,
    DeserializationError,
    InstanceNotFoundError,
    WorkflowDefinitionError,
    CancellationError,
    VersionMismatchError,
    # Data Classes
    StepDefinition,
    RetryConfig,
    TriggerConfig,
    WorkflowDefinition,
    StepExecution,
    WorkflowInstance,
    PendingTimer,
    WaitingInstance,
    DeadLetterEntry,
    StepResult,
    EventPayload,
    # Abstract Storage Interfaces
    InstanceStore,
    WorkflowStore,
    TimerStore,
    DeadLetterStore,
    EventLogStore,
    # Protocol
    WorkflowContextProtocol,
)

# =============================================================================
# Engine Components
# =============================================================================

from .instance_manager import InstanceManager

from .step_executor import (
    StepExecutor,
    StepTransition,
    WorkflowBase,
)

from .event_router import (
    EventRouter,
    TriggerRegistry,
    TriggerRegistration,
    EventMatch,
    EventMatcher,
)

from .timer_service import (
    TimerService,
    FiredTimer,
)

from .retry_handler import (
    RetryHandler,
    RetryDecision,
    RetryPolicy,
)

from .cancellation import (
    CancellationHandler,
    CancellationResult,
    CompensationStep,
    CancellationPolicy,
)

from .dead_letter import (
    DeadLetterQueue,
    DeadLetterAlertManager,
    FailureStats,
    RetryResult,
)

from .version_manager import (
    VersionManager,
    Version,
    VersionInfo,
    MigrationResult,
    compare_versions,
    is_breaking_change,
)

# =============================================================================
# Public API
# =============================================================================

__all__ = [
    # Enums
    "InstanceStatus",
    "StepStatus",
    "TriggerType",
    "RuntimeType",
    "VersioningStrategy",
    "BackoffStrategy",
    # Errors
    "WorkflowError",
    "RetryableError",
    "NonRetryableError",
    "StepTransitionError",
    "SerializationError",
    "DeserializationError",
    "InstanceNotFoundError",
    "WorkflowDefinitionError",
    "CancellationError",
    "VersionMismatchError",
    # Data Classes
    "StepDefinition",
    "RetryConfig",
    "TriggerConfig",
    "WorkflowDefinition",
    "StepExecution",
    "WorkflowInstance",
    "PendingTimer",
    "WaitingInstance",
    "DeadLetterEntry",
    "StepResult",
    "EventPayload",
    # Abstract Storage Interfaces
    "InstanceStore",
    "WorkflowStore",
    "TimerStore",
    "DeadLetterStore",
    "EventLogStore",
    # Protocol
    "WorkflowContextProtocol",
    # Instance Manager
    "InstanceManager",
    # Step Executor
    "StepExecutor",
    "StepTransition",
    "WorkflowBase",
    # Event Router
    "EventRouter",
    "TriggerRegistry",
    "TriggerRegistration",
    "EventMatch",
    "EventMatcher",
    # Timer Service
    "TimerService",
    "FiredTimer",
    # Retry Handler
    "RetryHandler",
    "RetryDecision",
    "RetryPolicy",
    # Cancellation
    "CancellationHandler",
    "CancellationResult",
    "CompensationStep",
    "CancellationPolicy",
    # Dead Letter Queue
    "DeadLetterQueue",
    "DeadLetterAlertManager",
    "FailureStats",
    "RetryResult",
    # Version Manager
    "VersionManager",
    "Version",
    "VersionInfo",
    "MigrationResult",
    "compare_versions",
    "is_breaking_change",
]

# =============================================================================
# Version
# =============================================================================

__version__ = "0.1.0"
