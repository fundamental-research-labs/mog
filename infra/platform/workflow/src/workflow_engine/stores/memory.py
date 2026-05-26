"""
In-Memory Store Implementations

These implementations are essential for:
1. Unit testing - Fast, no external dependencies
2. Local development - Quick iteration without database setup
3. Integration testing - Deterministic behavior

All data is lost when the process exits. For persistence, use SQLite or PostgreSQL.
"""

from datetime import datetime
from typing import Any

from .base import (
    WorkflowDefinitionStore,
    InstanceStore,
    TimerStore,
    EventLogStore,
    DeadLetterStore,
    WorkflowDefinition,
    WorkflowInstance,
    Timer,
    WorkflowEvent,
    DeadLetterEntry,
    InstanceStatus,
    TriggerType,
    EventType,
    _generate_id,
    _now,
)


class InMemoryWorkflowDefinitionStore(WorkflowDefinitionStore):
    """
    In-memory implementation of WorkflowDefinitionStore.

    Thread-safe for single-threaded async usage (no locks needed for async).
    """

    def __init__(self) -> None:
        # Main storage: id -> definition
        self._definitions: dict[str, WorkflowDefinition] = {}
        # Index: name -> list of ids (for versioning)
        self._by_name: dict[str, list[str]] = {}
        # Index: (name, version) -> id
        self._by_name_version: dict[tuple[str, str], str] = {}

    async def create(self, definition: WorkflowDefinition) -> str:
        """Create a new workflow definition."""
        if not definition.id:
            definition.id = _generate_id()

        if definition.id in self._definitions:
            raise ValueError(f"Workflow definition with id {definition.id} already exists")

        # Check for duplicate name+version
        key = (definition.name, definition.version)
        if key in self._by_name_version:
            raise ValueError(
                f"Workflow {definition.name} version {definition.version} already exists"
            )

        self._definitions[definition.id] = definition

        # Update indexes
        if definition.name not in self._by_name:
            self._by_name[definition.name] = []
        self._by_name[definition.name].append(definition.id)
        self._by_name_version[key] = definition.id

        return definition.id

    async def get(self, workflow_id: str) -> WorkflowDefinition | None:
        """Get a workflow definition by ID."""
        return self._definitions.get(workflow_id)

    async def get_by_name(self, name: str) -> WorkflowDefinition | None:
        """Get the latest version of a workflow definition by name."""
        ids = self._by_name.get(name, [])
        if not ids:
            return None

        # Return most recently created (last in list)
        # In a real implementation, you'd sort by version
        return self._definitions.get(ids[-1])

    async def get_by_name_and_version(
        self, name: str, version: str
    ) -> WorkflowDefinition | None:
        """Get a specific version of a workflow definition."""
        key = (name, version)
        workflow_id = self._by_name_version.get(key)
        if not workflow_id:
            return None
        return self._definitions.get(workflow_id)

    async def list_versions(self, name: str) -> list[WorkflowDefinition]:
        """List all versions of a workflow definition."""
        ids = self._by_name.get(name, [])
        definitions = []
        for workflow_id in ids:
            defn = self._definitions.get(workflow_id)
            if defn:
                definitions.append(defn)
        return definitions

    async def update(self, workflow_id: str, definition: WorkflowDefinition) -> None:
        """Update a workflow definition."""
        if workflow_id not in self._definitions:
            raise KeyError(f"Workflow definition {workflow_id} not found")

        old_def = self._definitions[workflow_id]

        # If name or version changed, update indexes
        if old_def.name != definition.name or old_def.version != definition.version:
            # Remove old indexes
            old_key = (old_def.name, old_def.version)
            if old_key in self._by_name_version:
                del self._by_name_version[old_key]
            if old_def.name in self._by_name and workflow_id in self._by_name[old_def.name]:
                self._by_name[old_def.name].remove(workflow_id)

            # Add new indexes
            new_key = (definition.name, definition.version)
            if new_key in self._by_name_version:
                raise ValueError(
                    f"Workflow {definition.name} version {definition.version} already exists"
                )
            self._by_name_version[new_key] = workflow_id
            if definition.name not in self._by_name:
                self._by_name[definition.name] = []
            self._by_name[definition.name].append(workflow_id)

        definition.updated_at = _now()
        self._definitions[workflow_id] = definition

    async def delete(self, workflow_id: str) -> None:
        """Delete a workflow definition."""
        if workflow_id not in self._definitions:
            raise KeyError(f"Workflow definition {workflow_id} not found")

        definition = self._definitions[workflow_id]

        # Remove from indexes
        key = (definition.name, definition.version)
        if key in self._by_name_version:
            del self._by_name_version[key]
        if definition.name in self._by_name and workflow_id in self._by_name[definition.name]:
            self._by_name[definition.name].remove(workflow_id)
            if not self._by_name[definition.name]:
                del self._by_name[definition.name]

        del self._definitions[workflow_id]

    async def list_all(self) -> list[WorkflowDefinition]:
        """List all workflow definitions."""
        return list(self._definitions.values())

    async def find_by_trigger(
        self, trigger_type: TriggerType, **kwargs: Any
    ) -> list[WorkflowDefinition]:
        """Find workflow definitions matching a trigger."""
        results = []
        for definition in self._definitions.values():
            trigger = definition.trigger

            # Must match trigger type
            if trigger.type != trigger_type:
                continue

            # Check trigger-specific filters
            match = True
            if "table" in kwargs and trigger.table != kwargs["table"]:
                match = False
            if "field" in kwargs and trigger.field != kwargs["field"]:
                match = False
            if "value" in kwargs and trigger.value != kwargs["value"]:
                match = False
            if "sheet" in kwargs and trigger.sheet != kwargs["sheet"]:
                match = False
            if "path" in kwargs and trigger.path != kwargs["path"]:
                match = False

            if match:
                results.append(definition)

        return results

    def clear(self) -> None:
        """Clear all data (for testing)."""
        self._definitions.clear()
        self._by_name.clear()
        self._by_name_version.clear()


class InMemoryInstanceStore(InstanceStore):
    """
    In-memory implementation of InstanceStore.
    """

    def __init__(self) -> None:
        # Main storage: id -> instance
        self._instances: dict[str, WorkflowInstance] = {}
        # Index: status -> set of ids
        self._by_status: dict[InstanceStatus, set[str]] = {
            status: set() for status in InstanceStatus
        }
        # Index: workflow_id -> set of ids
        self._by_workflow: dict[str, set[str]] = {}
        # Index: idempotency_key -> id
        self._by_idempotency_key: dict[str, str] = {}
        # Index: parent_instance_id -> set of ids
        self._by_parent: dict[str, set[str]] = {}

    async def create(self, instance: WorkflowInstance) -> str:
        """Create a new instance. Returns instance_id."""
        if not instance.id:
            instance.id = _generate_id()

        if instance.id in self._instances:
            raise ValueError(f"Instance with id {instance.id} already exists")

        # Check idempotency key uniqueness
        if instance.idempotency_key:
            if instance.idempotency_key in self._by_idempotency_key:
                raise ValueError(
                    f"Instance with idempotency_key {instance.idempotency_key} already exists"
                )
            self._by_idempotency_key[instance.idempotency_key] = instance.id

        self._instances[instance.id] = instance

        # Update indexes
        status = InstanceStatus(instance.status) if isinstance(instance.status, str) else instance.status
        self._by_status[status].add(instance.id)

        if instance.workflow_id not in self._by_workflow:
            self._by_workflow[instance.workflow_id] = set()
        self._by_workflow[instance.workflow_id].add(instance.id)

        if instance.parent_instance_id:
            if instance.parent_instance_id not in self._by_parent:
                self._by_parent[instance.parent_instance_id] = set()
            self._by_parent[instance.parent_instance_id].add(instance.id)

        return instance.id

    async def get(self, instance_id: str) -> WorkflowInstance | None:
        """Get an instance by ID."""
        return self._instances.get(instance_id)

    async def update(self, instance_id: str, instance: WorkflowInstance) -> None:
        """Update an existing instance."""
        if instance_id not in self._instances:
            raise KeyError(f"Instance {instance_id} not found")

        old_instance = self._instances[instance_id]

        # Update status index if changed
        old_status = InstanceStatus(old_instance.status) if isinstance(old_instance.status, str) else old_instance.status
        new_status = InstanceStatus(instance.status) if isinstance(instance.status, str) else instance.status

        if old_status != new_status:
            self._by_status[old_status].discard(instance_id)
            self._by_status[new_status].add(instance_id)

        # Update idempotency key index if changed
        if old_instance.idempotency_key != instance.idempotency_key:
            if old_instance.idempotency_key:
                del self._by_idempotency_key[old_instance.idempotency_key]
            if instance.idempotency_key:
                if instance.idempotency_key in self._by_idempotency_key:
                    raise ValueError(
                        f"Instance with idempotency_key {instance.idempotency_key} already exists"
                    )
                self._by_idempotency_key[instance.idempotency_key] = instance_id

        instance.updated_at = _now()
        self._instances[instance_id] = instance

    async def delete(self, instance_id: str) -> None:
        """Delete an instance."""
        if instance_id not in self._instances:
            raise KeyError(f"Instance {instance_id} not found")

        instance = self._instances[instance_id]

        # Remove from indexes
        status = InstanceStatus(instance.status) if isinstance(instance.status, str) else instance.status
        self._by_status[status].discard(instance_id)

        if instance.workflow_id in self._by_workflow:
            self._by_workflow[instance.workflow_id].discard(instance_id)

        if instance.idempotency_key:
            del self._by_idempotency_key[instance.idempotency_key]

        if instance.parent_instance_id and instance.parent_instance_id in self._by_parent:
            self._by_parent[instance.parent_instance_id].discard(instance_id)

        del self._instances[instance_id]

    async def list_by_status(self, status: InstanceStatus) -> list[WorkflowInstance]:
        """List all instances with a given status."""
        ids = self._by_status.get(status, set())
        return [self._instances[id] for id in ids if id in self._instances]

    async def list_by_workflow(self, workflow_id: str) -> list[WorkflowInstance]:
        """List all instances of a specific workflow."""
        ids = self._by_workflow.get(workflow_id, set())
        return [self._instances[id] for id in ids if id in self._instances]

    async def find_waiting_for_event(self, event_type: str) -> list[WorkflowInstance]:
        """Find instances waiting for a specific event type."""
        results = []
        waiting_ids = self._by_status.get(InstanceStatus.WAITING, set())
        for instance_id in waiting_ids:
            instance = self._instances.get(instance_id)
            if instance and instance.waiting:
                if event_type in instance.waiting.events:
                    results.append(instance)
        return results

    async def find_by_idempotency_key(
        self, idempotency_key: str
    ) -> WorkflowInstance | None:
        """Find an instance by its idempotency key."""
        instance_id = self._by_idempotency_key.get(idempotency_key)
        if not instance_id:
            return None
        return self._instances.get(instance_id)

    async def list_by_parent(self, parent_instance_id: str) -> list[WorkflowInstance]:
        """List child instances of a parent workflow."""
        ids = self._by_parent.get(parent_instance_id, set())
        return [self._instances[id] for id in ids if id in self._instances]

    async def list_all(self) -> list[WorkflowInstance]:
        """List all instances."""
        return list(self._instances.values())

    def clear(self) -> None:
        """Clear all data (for testing)."""
        self._instances.clear()
        for status_set in self._by_status.values():
            status_set.clear()
        self._by_workflow.clear()
        self._by_idempotency_key.clear()
        self._by_parent.clear()


class InMemoryTimerStore(TimerStore):
    """
    In-memory implementation of TimerStore.
    """

    def __init__(self) -> None:
        # Main storage: id -> timer
        self._timers: dict[str, Timer] = {}
        # Index: instance_id -> set of timer ids
        self._by_instance: dict[str, set[str]] = {}

    async def create(self, timer: Timer) -> str:
        """Create a new timer. Returns timer_id."""
        if not timer.id:
            timer.id = _generate_id()

        if timer.id in self._timers:
            raise ValueError(f"Timer with id {timer.id} already exists")

        self._timers[timer.id] = timer

        # Update index
        if timer.instance_id not in self._by_instance:
            self._by_instance[timer.instance_id] = set()
        self._by_instance[timer.instance_id].add(timer.id)

        return timer.id

    async def get(self, timer_id: str) -> Timer | None:
        """Get a timer by ID."""
        return self._timers.get(timer_id)

    async def get_due(self, now: datetime) -> list[Timer]:
        """Get all timers that should fire at or before the given time."""
        now_str = now.isoformat() + "Z" if not now.isoformat().endswith("Z") else now.isoformat()
        results = []
        for timer in self._timers.values():
            if timer.fire_at <= now_str:
                results.append(timer)
        # Sort by fire_at for consistent ordering
        results.sort(key=lambda t: t.fire_at)
        return results

    async def delete(self, timer_id: str) -> None:
        """Delete a timer."""
        if timer_id not in self._timers:
            raise KeyError(f"Timer {timer_id} not found")

        timer = self._timers[timer_id]

        # Remove from index
        if timer.instance_id in self._by_instance:
            self._by_instance[timer.instance_id].discard(timer_id)
            if not self._by_instance[timer.instance_id]:
                del self._by_instance[timer.instance_id]

        del self._timers[timer_id]

    async def get_by_instance(self, instance_id: str) -> list[Timer]:
        """Get all timers for a specific workflow instance."""
        timer_ids = self._by_instance.get(instance_id, set())
        return [self._timers[id] for id in timer_ids if id in self._timers]

    async def delete_by_instance(self, instance_id: str) -> None:
        """Delete all timers for a specific workflow instance."""
        timer_ids = list(self._by_instance.get(instance_id, set()))
        for timer_id in timer_ids:
            if timer_id in self._timers:
                del self._timers[timer_id]
        if instance_id in self._by_instance:
            del self._by_instance[instance_id]

    def clear(self) -> None:
        """Clear all data (for testing)."""
        self._timers.clear()
        self._by_instance.clear()


class InMemoryEventLogStore(EventLogStore):
    """
    In-memory implementation of EventLogStore.

    This is an append-only log - events cannot be modified or deleted.
    """

    def __init__(self) -> None:
        # Main storage: list of events (append-only)
        self._events: list[WorkflowEvent] = []
        # Index: instance_id -> list of event indices
        self._by_instance: dict[str, list[int]] = {}
        # Index: event_type -> list of event indices
        self._by_type: dict[EventType, list[int]] = {}

    async def append(self, event: WorkflowEvent) -> None:
        """Append an event to the log (append-only)."""
        if not event.id:
            event.id = _generate_id()

        index = len(self._events)
        self._events.append(event)

        # Update indexes
        if event.instance_id not in self._by_instance:
            self._by_instance[event.instance_id] = []
        self._by_instance[event.instance_id].append(index)

        event_type = EventType(event.event_type) if isinstance(event.event_type, str) else event.event_type
        if event_type not in self._by_type:
            self._by_type[event_type] = []
        self._by_type[event_type].append(index)

    async def get_by_instance(self, instance_id: str) -> list[WorkflowEvent]:
        """Get all events for a specific workflow instance."""
        indices = self._by_instance.get(instance_id, [])
        return [self._events[i] for i in indices]

    async def get_by_time_range(
        self, start: datetime, end: datetime
    ) -> list[WorkflowEvent]:
        """Get events within a time range."""
        start_str = start.isoformat() + "Z" if not start.isoformat().endswith("Z") else start.isoformat()
        end_str = end.isoformat() + "Z" if not end.isoformat().endswith("Z") else end.isoformat()

        results = []
        for event in self._events:
            if start_str <= event.timestamp <= end_str:
                results.append(event)
        return results

    async def get_by_type(self, event_type: EventType) -> list[WorkflowEvent]:
        """Get all events of a specific type."""
        indices = self._by_type.get(event_type, [])
        return [self._events[i] for i in indices]

    async def count_by_instance(self, instance_id: str) -> int:
        """Count events for a specific instance."""
        return len(self._by_instance.get(instance_id, []))

    def clear(self) -> None:
        """Clear all data (for testing)."""
        self._events.clear()
        self._by_instance.clear()
        self._by_type.clear()


class InMemoryDeadLetterStore(DeadLetterStore):
    """
    In-memory implementation of DeadLetterStore.
    """

    def __init__(self) -> None:
        # Main storage: id -> entry
        self._entries: dict[str, DeadLetterEntry] = {}
        # Index: instance_id -> entry_id
        self._by_instance: dict[str, str] = {}
        # Index: workflow_id -> set of entry_ids
        self._by_workflow: dict[str, set[str]] = {}

    async def add(self, entry: DeadLetterEntry) -> str:
        """Add an entry to the dead letter queue."""
        if not entry.id:
            entry.id = _generate_id()

        if entry.id in self._entries:
            raise ValueError(f"Dead letter entry with id {entry.id} already exists")

        self._entries[entry.id] = entry

        # Update indexes
        self._by_instance[entry.instance.id] = entry.id

        workflow_id = entry.instance.workflow_id
        if workflow_id not in self._by_workflow:
            self._by_workflow[workflow_id] = set()
        self._by_workflow[workflow_id].add(entry.id)

        return entry.id

    async def get(self, entry_id: str) -> DeadLetterEntry | None:
        """Get a dead letter entry by ID."""
        return self._entries.get(entry_id)

    async def get_by_instance(self, instance_id: str) -> DeadLetterEntry | None:
        """Get dead letter entry for a specific instance."""
        entry_id = self._by_instance.get(instance_id)
        if not entry_id:
            return None
        return self._entries.get(entry_id)

    async def remove(self, entry_id: str) -> None:
        """Remove an entry from the dead letter queue (e.g., after retry)."""
        if entry_id not in self._entries:
            raise KeyError(f"Dead letter entry {entry_id} not found")

        entry = self._entries[entry_id]

        # Remove from indexes
        if entry.instance.id in self._by_instance:
            del self._by_instance[entry.instance.id]

        workflow_id = entry.instance.workflow_id
        if workflow_id in self._by_workflow:
            self._by_workflow[workflow_id].discard(entry_id)
            if not self._by_workflow[workflow_id]:
                del self._by_workflow[workflow_id]

        del self._entries[entry_id]

    async def list_all(self) -> list[DeadLetterEntry]:
        """List all entries in the dead letter queue."""
        return list(self._entries.values())

    async def list_by_workflow(self, workflow_id: str) -> list[DeadLetterEntry]:
        """List dead letter entries for a specific workflow."""
        entry_ids = self._by_workflow.get(workflow_id, set())
        return [self._entries[id] for id in entry_ids if id in self._entries]

    async def update_retry_count(
        self, entry_id: str, retry_count: int, last_retry_at: str
    ) -> None:
        """Update retry count for an entry."""
        if entry_id not in self._entries:
            raise KeyError(f"Dead letter entry {entry_id} not found")

        entry = self._entries[entry_id]
        entry.retry_count = retry_count
        entry.last_retry_at = last_retry_at

    def clear(self) -> None:
        """Clear all data (for testing)."""
        self._entries.clear()
        self._by_instance.clear()
        self._by_workflow.clear()


class InMemoryStores:
    """
    Convenience class that creates all in-memory stores together.

    Usage:
        stores = InMemoryStores()
        await stores.workflows.create(definition)
        await stores.instances.create(instance)
    """

    def __init__(self) -> None:
        self.workflows = InMemoryWorkflowDefinitionStore()
        self.instances = InMemoryInstanceStore()
        self.timers = InMemoryTimerStore()
        self.events = InMemoryEventLogStore()
        self.dead_letters = InMemoryDeadLetterStore()

    def clear_all(self) -> None:
        """Clear all stores (for testing)."""
        self.workflows.clear()
        self.instances.clear()
        self.timers.clear()
        self.events.clear()
        self.dead_letters.clear()
