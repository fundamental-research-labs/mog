"""
Kernel APIs - Low-level data access for workflows.

This module provides direct access to kernel-level data primitives:
- TablesAPI: Table metadata and schema operations
- RecordsAPI: CRUD operations on records
- RelationsAPI: Relation traversal and linking

These APIs provide raw data access without domain-specific logic.
For domain operations, use the App APIs (ctx.apps.*) instead.
"""

from workflow_engine.context.kernel.tables import TablesAPI
from workflow_engine.context.kernel.records import RecordsAPI
from workflow_engine.context.kernel.relations import RelationsAPI

__all__ = [
    "TablesAPI",
    "RecordsAPI",
    "RelationsAPI",
]
