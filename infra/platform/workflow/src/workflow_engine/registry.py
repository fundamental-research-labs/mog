"""
Global workflow registry.

This module provides the central registry for all workflow classes.
The registry is used by:
1. The @workflow decorator to register workflows
2. The trigger system to match events to workflows
3. The engine to look up workflow definitions
"""

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterator, List, Optional, Set, Type, Tuple
import threading

from .types import (
    RecordTriggerConfig,
    CellTriggerConfig,
    ScheduleTriggerConfig,
    WebhookTriggerConfig,
    TriggerConfig,
    TriggerType,
    WorkflowEvent,
)
from .definition import WorkflowDefinition, WORKFLOW_META_ATTR
from .errors import WorkflowNotFound, WorkflowDefinitionError


# =============================================================================
# Trigger Index
# =============================================================================


@dataclass
class TriggerIndex:
    """
    Index for fast trigger matching.

    This class maintains indexes for efficiently matching events to workflows.
    """

    # Index by trigger type
    by_trigger_type: Dict[TriggerType, Set[str]] = field(default_factory=dict)

    # Index for record triggers: table -> workflow_ids
    by_table: Dict[str, Set[str]] = field(default_factory=dict)

    # Index for record triggers with field: (table, field) -> workflow_ids
    by_table_field: Dict[Tuple[str, str], Set[str]] = field(default_factory=dict)

    # Index for record triggers with field+value: (table, field, value) -> workflow_ids
    by_table_field_value: Dict[Tuple[str, str, Any], Set[str]] = field(default_factory=dict)

    # Index for cell triggers: sheet -> workflow_ids
    by_sheet: Dict[str, Set[str]] = field(default_factory=dict)

    # Index for webhook triggers: (path, method) -> workflow_ids
    by_webhook: Dict[Tuple[str, str], Set[str]] = field(default_factory=dict)

    # Index for schedule triggers: cron -> workflow_ids
    by_schedule: Dict[str, Set[str]] = field(default_factory=dict)

    def add(self, definition: WorkflowDefinition) -> None:
        """Add a workflow to the index."""
        workflow_id = definition.workflow_id
        trigger_type = definition.trigger_type
        config = definition.trigger_config

        # Add to trigger type index
        if trigger_type not in self.by_trigger_type:
            self.by_trigger_type[trigger_type] = set()
        self.by_trigger_type[trigger_type].add(workflow_id)

        # Add to specific indexes based on trigger type
        if isinstance(config, RecordTriggerConfig):
            table = config.table

            # Add to table index
            if table not in self.by_table:
                self.by_table[table] = set()
            self.by_table[table].add(workflow_id)

            # Add to table+field index if applicable
            if config.field:
                key = (table, config.field)
                if key not in self.by_table_field:
                    self.by_table_field[key] = set()
                self.by_table_field[key].add(workflow_id)

                # Add to table+field+value index if applicable
                if config.value is not None:
                    value_key = (table, config.field, config.value)
                    if value_key not in self.by_table_field_value:
                        self.by_table_field_value[value_key] = set()
                    self.by_table_field_value[value_key].add(workflow_id)

        elif isinstance(config, CellTriggerConfig):
            sheet = config.sheet
            if sheet not in self.by_sheet:
                self.by_sheet[sheet] = set()
            self.by_sheet[sheet].add(workflow_id)

        elif isinstance(config, WebhookTriggerConfig):
            key = (config.path, config.method)
            if key not in self.by_webhook:
                self.by_webhook[key] = set()
            self.by_webhook[key].add(workflow_id)

        elif isinstance(config, ScheduleTriggerConfig):
            cron = config.cron
            if cron not in self.by_schedule:
                self.by_schedule[cron] = set()
            self.by_schedule[cron].add(workflow_id)

    def remove(self, definition: WorkflowDefinition) -> None:
        """Remove a workflow from the index."""
        workflow_id = definition.workflow_id
        trigger_type = definition.trigger_type
        config = definition.trigger_config

        # Remove from trigger type index
        if trigger_type in self.by_trigger_type:
            self.by_trigger_type[trigger_type].discard(workflow_id)

        # Remove from specific indexes
        if isinstance(config, RecordTriggerConfig):
            table = config.table

            if table in self.by_table:
                self.by_table[table].discard(workflow_id)

            if config.field:
                key = (table, config.field)
                if key in self.by_table_field:
                    self.by_table_field[key].discard(workflow_id)

                if config.value is not None:
                    value_key = (table, config.field, config.value)
                    if value_key in self.by_table_field_value:
                        self.by_table_field_value[value_key].discard(workflow_id)

        elif isinstance(config, CellTriggerConfig):
            sheet = config.sheet
            if sheet in self.by_sheet:
                self.by_sheet[sheet].discard(workflow_id)

        elif isinstance(config, WebhookTriggerConfig):
            key = (config.path, config.method)
            if key in self.by_webhook:
                self.by_webhook[key].discard(workflow_id)

        elif isinstance(config, ScheduleTriggerConfig):
            cron = config.cron
            if cron in self.by_schedule:
                self.by_schedule[cron].discard(workflow_id)


# =============================================================================
# Workflow Registry
# =============================================================================


class WorkflowRegistry:
    """
    Global registry of workflow classes.

    This class maintains:
    1. All registered workflow definitions
    2. Indexes for fast trigger matching
    3. Thread-safe access

    The registry is typically used as a singleton (see global_registry),
    but can be instantiated separately for testing.

    Example:
        # Get the global registry
        from workflow_engine.registry import global_registry

        # Register a workflow
        global_registry.register(MyWorkflow)

        # Find workflows for an event
        workflows = global_registry.match_event({
            "type": "record:created",
            "table": "expenses",
            "recordId": "123"
        })

        # Get a workflow by ID
        definition = global_registry.get("MyWorkflow")
    """

    def __init__(self) -> None:
        """Initialize an empty registry."""
        self._lock = threading.RLock()
        self._workflows: Dict[str, WorkflowDefinition] = {}
        self._index = TriggerIndex()

        # Callbacks for registration events
        self._on_register: List[Callable[[WorkflowDefinition], None]] = []
        self._on_unregister: List[Callable[[WorkflowDefinition], None]] = []

    def register(
        self,
        workflow_class: Type[Any],
        *,
        replace: bool = False,
    ) -> WorkflowDefinition:
        """
        Register a workflow class.

        Args:
            workflow_class: Class decorated with @workflow
            replace: If True, replace existing registration

        Returns:
            The WorkflowDefinition for the registered class

        Raises:
            WorkflowDefinitionError: If class is not properly decorated
            WorkflowDefinitionError: If workflow is already registered and replace=False
        """
        with self._lock:
            definition = WorkflowDefinition.from_class(workflow_class)
            workflow_id = definition.workflow_id

            # Check for existing registration
            if workflow_id in self._workflows:
                if not replace:
                    raise WorkflowDefinitionError(
                        f"Workflow '{workflow_id}' is already registered. "
                        f"Use replace=True to override."
                    )
                # Remove old registration
                old_def = self._workflows[workflow_id]
                self._index.remove(old_def)

            # Register
            self._workflows[workflow_id] = definition
            self._index.add(definition)

            # Notify callbacks
            for callback in self._on_register:
                try:
                    callback(definition)
                except Exception:
                    pass  # Don't let callback errors break registration

            return definition

    def unregister(self, workflow_id: str) -> Optional[WorkflowDefinition]:
        """
        Unregister a workflow.

        Args:
            workflow_id: ID of the workflow to unregister

        Returns:
            The unregistered WorkflowDefinition, or None if not found
        """
        with self._lock:
            definition = self._workflows.pop(workflow_id, None)
            if definition is not None:
                self._index.remove(definition)

                # Notify callbacks
                for callback in self._on_unregister:
                    try:
                        callback(definition)
                    except Exception:
                        pass

            return definition

    def get(self, workflow_id: str) -> WorkflowDefinition:
        """
        Get a workflow definition by ID.

        Args:
            workflow_id: Workflow ID (class name)

        Returns:
            WorkflowDefinition

        Raises:
            WorkflowNotFound: If workflow is not registered
        """
        with self._lock:
            definition = self._workflows.get(workflow_id)
            if definition is None:
                raise WorkflowNotFound(workflow_id)
            return definition

    def get_optional(self, workflow_id: str) -> Optional[WorkflowDefinition]:
        """
        Get a workflow definition by ID, or None if not found.

        Args:
            workflow_id: Workflow ID (class name)

        Returns:
            WorkflowDefinition or None
        """
        with self._lock:
            return self._workflows.get(workflow_id)

    def exists(self, workflow_id: str) -> bool:
        """Check if a workflow is registered."""
        with self._lock:
            return workflow_id in self._workflows

    def list(self) -> List[WorkflowDefinition]:
        """Get all registered workflow definitions."""
        with self._lock:
            return list(self._workflows.values())

    def clear(self) -> None:
        """Clear all registrations. Useful for testing."""
        with self._lock:
            self._workflows.clear()
            self._index = TriggerIndex()

    # =========================================================================
    # Trigger Matching
    # =========================================================================

    def match_event(self, event: WorkflowEvent) -> List[WorkflowDefinition]:
        """
        Find all workflows that match an event.

        This method uses the trigger index for efficient matching.

        Args:
            event: Event to match

        Returns:
            List of matching workflow definitions
        """
        with self._lock:
            event_type = event.get("type", "")
            candidates: Set[str] = set()

            # Determine trigger type from event type
            trigger_type = self._event_type_to_trigger(event_type)
            if trigger_type is None:
                return []

            # Get candidates based on event type
            if trigger_type in (
                TriggerType.RECORD_CREATED,
                TriggerType.RECORD_UPDATED,
                TriggerType.RECORD_DELETED,
            ):
                candidates = self._match_record_event(event, trigger_type)

            elif trigger_type == TriggerType.CELL_CHANGED:
                candidates = self._match_cell_event(event)

            elif trigger_type == TriggerType.WEBHOOK:
                candidates = self._match_webhook_event(event)

            elif trigger_type == TriggerType.SCHEDULE:
                # All schedule workflows are candidates
                candidates = self._index.by_trigger_type.get(trigger_type, set())

            elif trigger_type in (TriggerType.MANUAL, TriggerType.WORKFLOW_SPAWNED):
                candidates = self._index.by_trigger_type.get(trigger_type, set())

            # Convert to definitions
            return [
                self._workflows[wid]
                for wid in candidates
                if wid in self._workflows
            ]

    def _event_type_to_trigger(self, event_type: str) -> Optional[TriggerType]:
        """Convert event type string to TriggerType."""
        mapping = {
            "record:created": TriggerType.RECORD_CREATED,
            "record:updated": TriggerType.RECORD_UPDATED,
            "record:deleted": TriggerType.RECORD_DELETED,
            "cell:changed": TriggerType.CELL_CHANGED,
            "relation:linked": TriggerType.RELATION_LINKED,
            "relation:unlinked": TriggerType.RELATION_UNLINKED,
            "schedule": TriggerType.SCHEDULE,
            "webhook": TriggerType.WEBHOOK,
            "manual": TriggerType.MANUAL,
            "workflow:spawned": TriggerType.WORKFLOW_SPAWNED,
            "workflow:signal": TriggerType.WORKFLOW_SIGNAL,
        }
        return mapping.get(event_type)

    def _match_record_event(
        self,
        event: WorkflowEvent,
        trigger_type: TriggerType,
    ) -> Set[str]:
        """Match a record event to workflows."""
        table = event.get("table", "")
        field = event.get("field")
        value = event.get("value")

        candidates: Set[str] = set()

        # Match by (table, field, value) - most specific
        if field and value is not None:
            key = (table, field, value)
            candidates.update(self._index.by_table_field_value.get(key, set()))

        # Match by (table, field) - for any value change
        if field:
            key = (table, field)
            for wid in self._index.by_table_field.get(key, set()):
                # Check if workflow has value filter
                definition = self._workflows.get(wid)
                if definition and isinstance(definition.trigger_config, RecordTriggerConfig):
                    if definition.trigger_config.value is None:
                        # No value filter, matches any change to this field
                        candidates.add(wid)
                    # If value filter exists, it was already matched above

        # Match by table only (for any field/value)
        for wid in self._index.by_table.get(table, set()):
            definition = self._workflows.get(wid)
            if definition and isinstance(definition.trigger_config, RecordTriggerConfig):
                # Only include if no field filter
                if definition.trigger_config.field is None:
                    candidates.add(wid)

        # Filter by trigger type
        type_workflows = self._index.by_trigger_type.get(trigger_type, set())
        return candidates & type_workflows

    def _match_cell_event(self, event: WorkflowEvent) -> Set[str]:
        """Match a cell event to workflows."""
        sheet = event.get("sheet", "")
        cell = event.get("cell", "")
        cell_range = event.get("range", "")

        candidates: Set[str] = set()

        # Get workflows watching this sheet
        for wid in self._index.by_sheet.get(sheet, set()):
            definition = self._workflows.get(wid)
            if definition and isinstance(definition.trigger_config, CellTriggerConfig):
                config_range = definition.trigger_config.range

                # If no range specified, match any cell in the sheet
                if config_range is None:
                    candidates.add(wid)
                else:
                    # TODO: Implement proper range intersection check
                    # For now, do simple string matching
                    if cell and cell in config_range:
                        candidates.add(wid)
                    elif cell_range and (
                        cell_range == config_range or
                        config_range in cell_range or
                        cell_range in config_range
                    ):
                        candidates.add(wid)

        return candidates

    def _match_webhook_event(self, event: WorkflowEvent) -> Set[str]:
        """Match a webhook event to workflows."""
        path = event.get("path", "")
        method = event.get("method", "POST")

        key = (path, method)
        return self._index.by_webhook.get(key, set()).copy()

    # =========================================================================
    # Queries
    # =========================================================================

    def get_by_trigger_type(self, trigger_type: TriggerType) -> List[WorkflowDefinition]:
        """Get all workflows with a specific trigger type."""
        with self._lock:
            workflow_ids = self._index.by_trigger_type.get(trigger_type, set())
            return [
                self._workflows[wid]
                for wid in workflow_ids
                if wid in self._workflows
            ]

    def get_by_table(self, table: str) -> List[WorkflowDefinition]:
        """Get all workflows triggered by a specific table."""
        with self._lock:
            workflow_ids = self._index.by_table.get(table, set())
            return [
                self._workflows[wid]
                for wid in workflow_ids
                if wid in self._workflows
            ]

    def get_schedules(self) -> List[Tuple[str, WorkflowDefinition]]:
        """Get all scheduled workflows with their cron expressions."""
        with self._lock:
            result = []
            for cron, workflow_ids in self._index.by_schedule.items():
                for wid in workflow_ids:
                    if wid in self._workflows:
                        result.append((cron, self._workflows[wid]))
            return result

    # =========================================================================
    # Callbacks
    # =========================================================================

    def on_register(self, callback: Callable[[WorkflowDefinition], None]) -> None:
        """
        Register a callback for workflow registration events.

        Args:
            callback: Function called with WorkflowDefinition when registered
        """
        self._on_register.append(callback)

    def on_unregister(self, callback: Callable[[WorkflowDefinition], None]) -> None:
        """
        Register a callback for workflow unregistration events.

        Args:
            callback: Function called with WorkflowDefinition when unregistered
        """
        self._on_unregister.append(callback)

    # =========================================================================
    # Iteration
    # =========================================================================

    def __iter__(self) -> Iterator[WorkflowDefinition]:
        """Iterate over all workflow definitions."""
        with self._lock:
            return iter(list(self._workflows.values()))

    def __len__(self) -> int:
        """Get the number of registered workflows."""
        with self._lock:
            return len(self._workflows)

    def __contains__(self, workflow_id: str) -> bool:
        """Check if a workflow is registered."""
        return self.exists(workflow_id)


# =============================================================================
# Global Registry Singleton
# =============================================================================


# The global registry instance
_global_registry: Optional[WorkflowRegistry] = None
_registry_lock = threading.Lock()


def get_global_registry() -> WorkflowRegistry:
    """
    Get the global workflow registry.

    Returns:
        The singleton WorkflowRegistry instance
    """
    global _global_registry
    if _global_registry is None:
        with _registry_lock:
            if _global_registry is None:
                _global_registry = WorkflowRegistry()
    return _global_registry


def reset_global_registry() -> None:
    """
    Reset the global registry. Useful for testing.
    """
    global _global_registry
    with _registry_lock:
        if _global_registry is not None:
            _global_registry.clear()
        _global_registry = None


# Convenience alias
global_registry = property(lambda self: get_global_registry())


# =============================================================================
# Auto-Discovery
# =============================================================================


def discover_workflows(
    module: Any,
    *,
    registry: Optional[WorkflowRegistry] = None,
    recursive: bool = True,
) -> List[WorkflowDefinition]:
    """
    Discover and register workflows from a module.

    This function scans a module for classes decorated with @workflow
    and registers them.

    Args:
        module: Module to scan
        registry: Registry to use (defaults to global)
        recursive: If True, scan submodules

    Returns:
        List of discovered workflow definitions
    """
    import inspect
    import pkgutil

    if registry is None:
        registry = get_global_registry()

    discovered: List[WorkflowDefinition] = []

    # Scan module for workflow classes
    for name, obj in inspect.getmembers(module):
        if inspect.isclass(obj) and hasattr(obj, WORKFLOW_META_ATTR):
            try:
                definition = registry.register(obj)
                discovered.append(definition)
            except WorkflowDefinitionError:
                pass  # Already registered or invalid

    # Recursively scan submodules
    if recursive and hasattr(module, "__path__"):
        for importer, submodule_name, is_pkg in pkgutil.iter_modules(module.__path__):
            try:
                submodule = importer.find_module(submodule_name).load_module(submodule_name)
                discovered.extend(discover_workflows(submodule, registry=registry, recursive=True))
            except Exception:
                pass  # Skip modules that fail to import

    return discovered
