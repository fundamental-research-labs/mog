"""
Dead Letter Store - Stores failed workflow instances for later inspection/retry.

Re-exports the abstract DeadLetterStore from base for convenience.
"""

from .base import (
    DeadLetterStore,
    DeadLetterEntry,
)

__all__ = [
    "DeadLetterStore",
    "DeadLetterEntry",
]
