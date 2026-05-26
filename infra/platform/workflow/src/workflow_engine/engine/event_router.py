"""
Event Router - Match incoming events to waiting workflow instances.

The EventRouter is responsible for:
- Receiving incoming events (record changes, webhooks, signals, etc.)
- Finding workflow instances waiting for those events
- Matching events to triggers for starting new workflows
- Routing events to the appropriate instances
- Handling event filtering and correlation

Design Principles:
- Events are routed to ALL matching instances (fan-out)
- Event matching supports wildcards and filters
- Events can both resume waiting workflows AND trigger new ones
- Correlation IDs allow targeting specific workflow groups

Usage:
    router = EventRouter(instance_store, workflow_store, trigger_registry)

    # Route an event
    matches = await router.route_event(event)

    # matches.waiting_instances -> instances to wake up
    # matches.new_triggers -> workflows to start
"""

from __future__ import annotations

import fnmatch
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence, Set

from .types import (
    EventPayload,
    InstanceStatus,
    InstanceStore,
    TriggerConfig,
    TriggerType,
    WaitingInstance,
    WorkflowDefinition,
    WorkflowInstance,
    WorkflowStore,
)


logger = logging.getLogger(__name__)


@dataclass
class EventMatch:
    """
    Result of matching an event against waiting instances.

    Attributes:
        waiting_instances: Instances waiting for this event (to resume)
        new_triggers: Workflow definitions triggered by this event (to start)
        event: The original event
    """
    waiting_instances: List[WaitingInstance] = field(default_factory=list)
    new_triggers: List[WorkflowDefinition] = field(default_factory=list)
    event: Optional[EventPayload] = None


@dataclass
class TriggerRegistration:
    """
    Registration of a workflow trigger.

    Attributes:
        workflow_id: The workflow to trigger
        trigger_config: Trigger configuration
        definition: Full workflow definition
        priority: Higher priority triggers are evaluated first
        enabled: Whether this trigger is active
    """
    workflow_id: str
    trigger_config: TriggerConfig
    definition: WorkflowDefinition
    priority: int = 0
    enabled: bool = True


class TriggerRegistry:
    """
    Registry of workflow triggers.

    Maps events to workflows that should be triggered.
    Supports dynamic registration/unregistration.
    """

    def __init__(self):
        self._triggers: Dict[str, List[TriggerRegistration]] = {}
        # Index by event type for fast lookup
        self._by_event_type: Dict[str, List[TriggerRegistration]] = {}

    def register(
        self,
        definition: WorkflowDefinition,
        priority: int = 0,
        enabled: bool = True,
    ) -> None:
        """
        Register a workflow trigger.

        Args:
            definition: The workflow definition
            priority: Higher priority = evaluated first
            enabled: Whether trigger is active
        """
        trigger = definition.trigger
        registration = TriggerRegistration(
            workflow_id=definition.workflow_id,
            trigger_config=trigger,
            definition=definition,
            priority=priority,
            enabled=enabled,
        )

        # Store by workflow ID
        if definition.workflow_id not in self._triggers:
            self._triggers[definition.workflow_id] = []
        self._triggers[definition.workflow_id].append(registration)

        # Index by event type
        event_type = trigger.trigger_type.value
        if event_type not in self._by_event_type:
            self._by_event_type[event_type] = []
        self._by_event_type[event_type].append(registration)

        # Sort by priority (highest first)
        self._by_event_type[event_type].sort(key=lambda r: -r.priority)

        logger.debug(f"Registered trigger for {definition.workflow_id}: {event_type}")

    def unregister(self, workflow_id: str) -> bool:
        """
        Unregister all triggers for a workflow.

        Args:
            workflow_id: The workflow to unregister

        Returns:
            True if any triggers were removed
        """
        if workflow_id not in self._triggers:
            return False

        registrations = self._triggers.pop(workflow_id)

        # Remove from event type index
        for reg in registrations:
            event_type = reg.trigger_config.trigger_type.value
            if event_type in self._by_event_type:
                self._by_event_type[event_type] = [
                    r for r in self._by_event_type[event_type]
                    if r.workflow_id != workflow_id
                ]

        logger.debug(f"Unregistered {len(registrations)} triggers for {workflow_id}")
        return True

    def get_triggers_for_event(
        self,
        event_type: str,
    ) -> List[TriggerRegistration]:
        """
        Get all triggers that could match an event type.

        Args:
            event_type: The event type (e.g., "record:created")

        Returns:
            List of potentially matching triggers (ordered by priority)
        """
        return self._by_event_type.get(event_type, [])

    def get_all_triggers(self) -> List[TriggerRegistration]:
        """Get all registered triggers."""
        result = []
        for triggers in self._triggers.values():
            result.extend(triggers)
        return result

    def enable_trigger(self, workflow_id: str) -> bool:
        """Enable triggers for a workflow."""
        if workflow_id not in self._triggers:
            return False
        for reg in self._triggers[workflow_id]:
            reg.enabled = True
        return True

    def disable_trigger(self, workflow_id: str) -> bool:
        """Disable triggers for a workflow."""
        if workflow_id not in self._triggers:
            return False
        for reg in self._triggers[workflow_id]:
            reg.enabled = False
        return True


class EventRouter:
    """
    Routes events to waiting instances and triggers.

    The EventRouter handles the fan-out of events:
    1. Find all instances waiting for this event type
    2. Filter to those that match the event payload
    3. Find all workflow triggers that match
    4. Return aggregated matches

    Attributes:
        instance_store: Storage for workflow instances
        workflow_store: Storage for workflow definitions
        trigger_registry: Registry of workflow triggers
    """

    def __init__(
        self,
        instance_store: InstanceStore,
        workflow_store: Optional[WorkflowStore] = None,
        trigger_registry: Optional[TriggerRegistry] = None,
    ):
        """
        Initialize the EventRouter.

        Args:
            instance_store: Storage for instances
            workflow_store: Storage for definitions (optional)
            trigger_registry: Trigger registry (optional, creates new if not provided)
        """
        self.instance_store = instance_store
        self.workflow_store = workflow_store
        self.trigger_registry = trigger_registry or TriggerRegistry()

    # =========================================================================
    # Event Routing
    # =========================================================================

    async def route_event(
        self,
        event: EventPayload,
    ) -> EventMatch:
        """
        Route an event to matching instances and triggers.

        This is the main entry point for event routing. It:
        1. Finds all waiting instances for this event type
        2. Filters to those that match the event
        3. Finds all workflow triggers that match
        4. Returns combined results

        Args:
            event: The event to route

        Returns:
            EventMatch with waiting instances and new triggers
        """
        match = EventMatch(event=event)

        # Find waiting instances
        waiting = await self._find_waiting_instances(event)
        match.waiting_instances = waiting

        # Find matching triggers
        triggers = self._find_matching_triggers(event)
        match.new_triggers = [t.definition for t in triggers]

        logger.info(
            f"Routed event {event.event_type}: "
            f"{len(match.waiting_instances)} waiting, "
            f"{len(match.new_triggers)} triggers"
        )

        return match

    async def route_events(
        self,
        events: List[EventPayload],
    ) -> List[EventMatch]:
        """
        Route multiple events (batch processing).

        Args:
            events: List of events to route

        Returns:
            List of EventMatch results
        """
        return [await self.route_event(event) for event in events]

    # =========================================================================
    # Waiting Instance Matching
    # =========================================================================

    async def _find_waiting_instances(
        self,
        event: EventPayload,
    ) -> List[WaitingInstance]:
        """
        Find instances waiting for this event.

        Args:
            event: The event to match

        Returns:
            List of matching WaitingInstance records
        """
        # Get all instances waiting for this event type
        candidates = await self.instance_store.get_waiting_for_event(event.event_type)

        # Filter by event payload
        matches: List[WaitingInstance] = []
        for waiting in candidates:
            if self._matches_waiting_filter(event, waiting):
                matches.append(waiting)

        return matches

    def _matches_waiting_filter(
        self,
        event: EventPayload,
        waiting: WaitingInstance,
    ) -> bool:
        """
        Check if an event matches a waiting instance's filter.

        Args:
            event: The event to check
            waiting: The waiting instance with optional filter

        Returns:
            True if event matches
        """
        if waiting.filter is None:
            return True

        # Check each filter condition
        for key, expected in waiting.filter.items():
            # Get actual value from event
            actual = self._get_event_value(event, key)

            # Match
            if not self._value_matches(actual, expected):
                return False

        return True

    def _get_event_value(self, event: EventPayload, key: str) -> Any:
        """
        Get a value from an event by key path.

        Supports dot notation: "data.company.id"

        Args:
            event: The event
            key: Key path

        Returns:
            The value, or None if not found
        """
        parts = key.split(".")
        value: Any = None

        # Start with event attributes
        if parts[0] == "event_type":
            value = event.event_type
        elif parts[0] == "source_id":
            value = event.source_id
        elif parts[0] == "record_id":
            value = event.record_id
        elif parts[0] == "correlation_id":
            value = event.correlation_id
        elif parts[0] == "data":
            value = event.data
            parts = parts[1:]
        else:
            # Assume it's in data
            value = event.data

        # Navigate path
        for part in parts:
            if value is None:
                return None
            if isinstance(value, dict):
                value = value.get(part)
            else:
                return None

        return value

    def _value_matches(self, actual: Any, expected: Any) -> bool:
        """
        Check if an actual value matches an expected filter value.

        Supports:
        - Exact match
        - Glob patterns (for strings)
        - Lists (any match)
        - Regex (strings starting with "~")

        Args:
            actual: The actual value
            expected: The expected/filter value

        Returns:
            True if matches
        """
        if expected is None:
            return actual is None

        if isinstance(expected, list):
            # Match if actual equals any expected value
            return actual in expected

        if isinstance(expected, str):
            # Check for regex pattern
            if expected.startswith("~"):
                pattern = expected[1:]
                if isinstance(actual, str):
                    return bool(re.match(pattern, actual))
                return False

            # Check for glob pattern
            if "*" in expected or "?" in expected:
                if isinstance(actual, str):
                    return fnmatch.fnmatch(actual, expected)
                return False

        # Exact match
        return actual == expected

    # =========================================================================
    # Trigger Matching
    # =========================================================================

    def _find_matching_triggers(
        self,
        event: EventPayload,
    ) -> List[TriggerRegistration]:
        """
        Find workflow triggers that match this event.

        Args:
            event: The event to match

        Returns:
            List of matching trigger registrations
        """
        candidates = self.trigger_registry.get_triggers_for_event(event.event_type)

        matches: List[TriggerRegistration] = []
        for trigger in candidates:
            if not trigger.enabled:
                continue

            if self._matches_trigger(event, trigger.trigger_config):
                matches.append(trigger)

        return matches

    def _matches_trigger(
        self,
        event: EventPayload,
        trigger: TriggerConfig,
    ) -> bool:
        """
        Check if an event matches a trigger configuration.

        Args:
            event: The event to check
            trigger: The trigger configuration

        Returns:
            True if matches
        """
        # Event type must match
        if event.event_type != trigger.trigger_type.value:
            return False

        # Check table match (for record triggers)
        if trigger.table is not None:
            event_table = event.data.get("table") or event.source_id
            if event_table != trigger.table:
                return False

        # Check field match (for update triggers)
        if trigger.field is not None:
            event_field = event.data.get("field")
            if event_field != trigger.field:
                return False

        # Check value match
        if trigger.value is not None:
            event_value = event.data.get("value")
            if not self._value_matches(event_value, trigger.value):
                return False

        return True

    # =========================================================================
    # Signal Routing (Workflow-to-Workflow)
    # =========================================================================

    async def route_signal(
        self,
        target_instance_id: str,
        signal_type: str,
        data: Dict[str, Any],
    ) -> Optional[WaitingInstance]:
        """
        Route a signal to a specific workflow instance.

        Signals are explicit communications between workflows,
        different from general events.

        Args:
            target_instance_id: Instance to signal
            signal_type: Type of signal
            data: Signal data

        Returns:
            WaitingInstance if target was waiting for this signal
        """
        # Create signal event
        event = EventPayload(
            event_type=signal_type,
            data=data,
            timestamp=datetime.utcnow(),
        )

        # Check if instance is waiting for this signal
        instance = await self.instance_store.get(target_instance_id)
        if instance is None:
            logger.warning(f"Signal target not found: {target_instance_id}")
            return None

        if instance.status != InstanceStatus.WAITING:
            logger.debug(f"Signal target not waiting: {target_instance_id}")
            return None

        if instance.waiting_for is None or signal_type not in instance.waiting_for:
            logger.debug(f"Instance not waiting for signal {signal_type}")
            return None

        return WaitingInstance(
            instance_id=instance.instance_id,
            workflow_id=instance.workflow_id,
            waiting_for=instance.waiting_for,
            timeout_at=instance.wait_timeout_at,
        )

    # =========================================================================
    # Correlation-Based Routing
    # =========================================================================

    async def route_by_correlation(
        self,
        event: EventPayload,
        correlation_id: str,
    ) -> List[WaitingInstance]:
        """
        Route event to instances with matching correlation ID.

        Used for grouping related workflow instances.

        Args:
            event: The event
            correlation_id: Correlation ID to match

        Returns:
            Matching waiting instances
        """
        # Get all waiting instances for this event
        waiting = await self._find_waiting_instances(event)

        # Filter by correlation ID
        # Note: This requires loading full instance to check correlation
        # A real implementation should have a correlation index
        matches: List[WaitingInstance] = []
        for w in waiting:
            instance = await self.instance_store.get(w.instance_id)
            if instance and instance.correlation_id == correlation_id:
                matches.append(w)

        return matches

    # =========================================================================
    # Trigger Management
    # =========================================================================

    async def register_workflow_triggers(
        self,
        workflow_id: str,
        priority: int = 0,
    ) -> bool:
        """
        Register triggers for a workflow from the store.

        Args:
            workflow_id: The workflow to register
            priority: Trigger priority

        Returns:
            True if successfully registered
        """
        if self.workflow_store is None:
            logger.error("Cannot register triggers: no workflow store")
            return False

        definition = await self.workflow_store.get(workflow_id)
        if definition is None:
            logger.error(f"Workflow not found: {workflow_id}")
            return False

        self.trigger_registry.register(definition, priority=priority)
        return True

    async def register_all_triggers(self) -> int:
        """
        Register triggers for all workflows in the store.

        Returns:
            Number of workflows registered
        """
        if self.workflow_store is None:
            return 0

        definitions = await self.workflow_store.list_workflows()
        for definition in definitions:
            self.trigger_registry.register(definition)

        return len(definitions)

    def unregister_workflow_triggers(self, workflow_id: str) -> bool:
        """Unregister triggers for a workflow."""
        return self.trigger_registry.unregister(workflow_id)


class EventMatcher:
    """
    Utility class for building event matching filters.

    Provides a fluent API for building complex event filters.

    Usage:
        filter = (EventMatcher()
            .event_type("record:updated")
            .field("table", "deals")
            .field("data.stage", "Won")
            .build())
    """

    def __init__(self):
        self._conditions: Dict[str, Any] = {}

    def event_type(self, event_type: str) -> "EventMatcher":
        """Match specific event type."""
        self._conditions["event_type"] = event_type
        return self

    def source_id(self, source_id: str) -> "EventMatcher":
        """Match specific source ID."""
        self._conditions["source_id"] = source_id
        return self

    def record_id(self, record_id: str) -> "EventMatcher":
        """Match specific record ID."""
        self._conditions["record_id"] = record_id
        return self

    def correlation_id(self, correlation_id: str) -> "EventMatcher":
        """Match correlation ID."""
        self._conditions["correlation_id"] = correlation_id
        return self

    def field(self, path: str, value: Any) -> "EventMatcher":
        """Match a field in the event data."""
        self._conditions[f"data.{path}"] = value
        return self

    def any_of(self, path: str, values: List[Any]) -> "EventMatcher":
        """Match if field equals any of the values."""
        self._conditions[f"data.{path}"] = values
        return self

    def pattern(self, path: str, glob_pattern: str) -> "EventMatcher":
        """Match field against glob pattern."""
        self._conditions[f"data.{path}"] = glob_pattern
        return self

    def regex(self, path: str, regex_pattern: str) -> "EventMatcher":
        """Match field against regex pattern."""
        self._conditions[f"data.{path}"] = f"~{regex_pattern}"
        return self

    def build(self) -> Dict[str, Any]:
        """Build the filter dict."""
        return dict(self._conditions)
