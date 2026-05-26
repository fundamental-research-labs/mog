"""
Event Log Store - Append-only audit trail of all workflow events.

Re-exports the abstract EventLogStore from base for convenience.
"""

from .base import (
    EventLogStore,
    WorkflowEvent,
    EventType,
)

__all__ = [
    "EventLogStore",
    "WorkflowEvent",
    "EventType",
]
