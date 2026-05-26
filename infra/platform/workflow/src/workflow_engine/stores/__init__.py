"""
Workflow Engine Persistence Layer

This module provides the storage abstraction for the workflow engine:
- Abstract base classes defining the store interfaces
- In-memory implementations for testing
- SQLite implementations for local development
- PostgreSQL implementations can be added later (same interface)

Usage:
    # For testing
    from workflow_engine.stores import InMemoryStores
    stores = InMemoryStores()

    # For local development
    from workflow_engine.stores import SQLiteStores
    stores = SQLiteStores("workflows.db")
    await stores.initialize()

    # Use the same API regardless of backend
    await stores.workflows.create(definition)
    await stores.instances.create(instance)
    await stores.timers.create(timer)
    await stores.events.append(event)
    await stores.dead_letters.add(entry)
"""

# =============================================================================
# Base Types and Enums
# =============================================================================

from .base import (
    # Enums
    InstanceStatus,
    RuntimeType,
    TriggerType,
    VersioningStrategy,
    EventType,
    # Data Classes
    TriggerConfig,
    StepDefinition,
    WorkflowDefinition,
    StepHistory,
    WaitingState,
    WorkflowInstance,
    Timer,
    WorkflowEvent,
    DeadLetterEntry,
    # Abstract Base Classes
    BaseStore,
    WorkflowDefinitionStore,
    InstanceStore,
    TimerStore,
    EventLogStore,
    DeadLetterStore,
    # Utility functions
    _generate_id,
    _now,
)

# =============================================================================
# In-Memory Implementations (for testing)
# =============================================================================

from .memory import (
    InMemoryWorkflowDefinitionStore,
    InMemoryInstanceStore,
    InMemoryTimerStore,
    InMemoryEventLogStore,
    InMemoryDeadLetterStore,
    InMemoryStores,
)

# =============================================================================
# SQLite Implementations (for local development)
# =============================================================================

from .sqlite import (
    SQLiteWorkflowDefinitionStore,
    SQLiteInstanceStore,
    SQLiteTimerStore,
    SQLiteEventLogStore,
    SQLiteDeadLetterStore,
    SQLiteStores,
)

# =============================================================================
# Re-exports for convenience
# =============================================================================

from .workflow_store import (
    WorkflowDefinitionStore,
    WorkflowDefinition,
    TriggerConfig,
    StepDefinition,
    TriggerType,
    VersioningStrategy,
)

from .instance_store import (
    InstanceStore,
    WorkflowInstance,
    InstanceStatus,
    RuntimeType,
    StepHistory,
    WaitingState,
)

from .timer_store import (
    TimerStore,
    Timer,
)

from .event_log import (
    EventLogStore,
    WorkflowEvent,
    EventType,
)

from .dead_letter_store import (
    DeadLetterStore,
    DeadLetterEntry,
)

__all__ = [
    # Enums
    "InstanceStatus",
    "RuntimeType",
    "TriggerType",
    "VersioningStrategy",
    "EventType",
    # Data Classes
    "TriggerConfig",
    "StepDefinition",
    "WorkflowDefinition",
    "StepHistory",
    "WaitingState",
    "WorkflowInstance",
    "Timer",
    "WorkflowEvent",
    "DeadLetterEntry",
    # Abstract Base Classes
    "BaseStore",
    "WorkflowDefinitionStore",
    "InstanceStore",
    "TimerStore",
    "EventLogStore",
    "DeadLetterStore",
    # In-Memory Implementations
    "InMemoryWorkflowDefinitionStore",
    "InMemoryInstanceStore",
    "InMemoryTimerStore",
    "InMemoryEventLogStore",
    "InMemoryDeadLetterStore",
    "InMemoryStores",
    # SQLite Implementations
    "SQLiteWorkflowDefinitionStore",
    "SQLiteInstanceStore",
    "SQLiteTimerStore",
    "SQLiteEventLogStore",
    "SQLiteDeadLetterStore",
    "SQLiteStores",
]
