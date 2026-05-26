"""
Event Simulation - Inject and simulate external events for workflow testing.

This module provides utilities for simulating external events in workflow tests,
such as approval buttons being clicked, webhook callbacks arriving, or
scheduled events firing.

Example:
    ctx = MockContext({...})
    instance = test.trigger(ctx, event={...})

    # Inject an approval event
    ctx.events.inject({
        "type": "expense:approved",
        "expense_id": "exp1",
        "approved_by": "manager@company.com"
    })

    # Workflow should have processed the event
    assert instance.current_step == "approve"
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional
from uuid import uuid4


@dataclass
class SimulatedEvent:
    """A simulated event for testing."""

    id: str
    type: str
    data: Dict[str, Any]
    timestamp: datetime
    delivered: bool = False
    delivered_to: Optional[str] = None  # instance_id that received it

    @classmethod
    def create(
        cls,
        event_type: str,
        data: Optional[Dict[str, Any]] = None,
        timestamp: Optional[datetime] = None,
    ) -> "SimulatedEvent":
        """Create a new simulated event."""
        return cls(
            id=f"evt_{uuid4().hex[:12]}",
            type=event_type,
            data=data or {},
            timestamp=timestamp or datetime.now(timezone.utc),
        )


@dataclass
class EventMatcher:
    """Matches events to waiting workflows."""

    event_types: List[str]
    instance_id: str
    callback: Callable[[Dict[str, Any]], None]
    one_shot: bool = True  # Remove after first match
    matched: bool = False


class EventSimulator:
    """
    Event simulation utility for workflow testing.

    Provides methods to inject external events into waiting workflows,
    simulating user actions, webhook callbacks, and other external triggers.

    Usage:
        simulator = EventSimulator()

        # Register a workflow waiting for events
        simulator.register_waiter(
            event_types=["expense:approved", "expense:rejected"],
            instance_id="inst_123",
            callback=lambda e: workflow.handle_event(e)
        )

        # Inject an event
        simulator.inject({
            "type": "expense:approved",
            "expense_id": "exp1"
        })
    """

    def __init__(self) -> None:
        """Initialize the event simulator."""
        self._pending_events: List[SimulatedEvent] = []
        self._delivered_events: List[SimulatedEvent] = []
        self._waiters: List[EventMatcher] = []
        self._event_listeners: List[Callable[[SimulatedEvent], None]] = []
        self._get_current_time: Callable[[], datetime] = lambda: datetime.now(timezone.utc)

    def set_time_source(self, time_fn: Callable[[], datetime]) -> None:
        """
        Set the function used to get current time.

        Args:
            time_fn: Function that returns current datetime.
        """
        self._get_current_time = time_fn

    def inject(self, event: Dict[str, Any]) -> SimulatedEvent:
        """
        Inject an event into the simulation.

        The event will be delivered to any waiting workflow that
        is expecting this event type.

        Args:
            event: Event data. Must include "type" key.

        Returns:
            The created SimulatedEvent.

        Raises:
            ValueError: If event has no "type" key.
        """
        if "type" not in event:
            raise ValueError("Event must have a 'type' key")

        simulated = SimulatedEvent.create(
            event_type=event["type"],
            data=event,
            timestamp=self._get_current_time(),
        )

        self._pending_events.append(simulated)
        self._notify_listeners(simulated)
        self._try_deliver(simulated)

        return simulated

    def inject_sequence(self, events: List[Dict[str, Any]]) -> List[SimulatedEvent]:
        """
        Inject a sequence of events.

        Args:
            events: List of events to inject in order.

        Returns:
            List of created SimulatedEvents.
        """
        return [self.inject(e) for e in events]

    def inject_after_delay(
        self,
        event: Dict[str, Any],
        delay_seconds: float,
        time_traveler: Any,  # TimeTraveler - avoid circular import
    ) -> SimulatedEvent:
        """
        Schedule an event to be injected after a delay.

        This integrates with the TimeTraveler to allow time-based
        event injection in tests.

        Args:
            event: Event data to inject.
            delay_seconds: Seconds to wait before injection.
            time_traveler: TimeTraveler instance for scheduling.

        Returns:
            The created SimulatedEvent (not yet delivered).
        """
        from datetime import timedelta

        fire_at = time_traveler.now() + timedelta(seconds=delay_seconds)

        # Create the event but don't deliver yet
        simulated = SimulatedEvent.create(
            event_type=event["type"],
            data=event,
            timestamp=fire_at,
        )

        def deliver_event() -> None:
            self._pending_events.append(simulated)
            self._notify_listeners(simulated)
            self._try_deliver(simulated)

        time_traveler.register_timer(
            fire_at=fire_at,
            callback=deliver_event,
            name=f"event:{event['type']}",
        )

        return simulated

    def register_waiter(
        self,
        event_types: List[str],
        instance_id: str,
        callback: Callable[[Dict[str, Any]], None],
        one_shot: bool = True,
    ) -> EventMatcher:
        """
        Register a workflow as waiting for events.

        Args:
            event_types: List of event types to wait for.
            instance_id: The workflow instance ID.
            callback: Function to call when event arrives.
            one_shot: If True, remove waiter after first match.

        Returns:
            The EventMatcher object.
        """
        matcher = EventMatcher(
            event_types=event_types,
            instance_id=instance_id,
            callback=callback,
            one_shot=one_shot,
        )
        self._waiters.append(matcher)

        # Try to deliver any pending events
        for event in self._pending_events:
            if not event.delivered:
                self._try_deliver(event)

        return matcher

    def unregister_waiter(self, instance_id: str) -> None:
        """
        Remove a workflow from the waiter list.

        Args:
            instance_id: The workflow instance ID.
        """
        self._waiters = [w for w in self._waiters if w.instance_id != instance_id]

    def _try_deliver(self, event: SimulatedEvent) -> bool:
        """
        Try to deliver an event to a waiting workflow.

        Args:
            event: The event to deliver.

        Returns:
            True if event was delivered.
        """
        if event.delivered:
            return False

        for matcher in self._waiters[:]:  # Copy list since we may modify it
            if matcher.matched and matcher.one_shot:
                continue

            if event.type in matcher.event_types:
                # Deliver the event
                event.delivered = True
                event.delivered_to = matcher.instance_id
                matcher.matched = True

                self._pending_events.remove(event)
                self._delivered_events.append(event)

                matcher.callback(event.data)

                if matcher.one_shot:
                    self._waiters.remove(matcher)

                return True

        return False

    def add_listener(self, listener: Callable[[SimulatedEvent], None]) -> None:
        """
        Add a listener called when events are injected.

        Args:
            listener: Function called with each injected event.
        """
        self._event_listeners.append(listener)

    def remove_listener(self, listener: Callable[[SimulatedEvent], None]) -> None:
        """
        Remove an event listener.

        Args:
            listener: The listener to remove.
        """
        if listener in self._event_listeners:
            self._event_listeners.remove(listener)

    def _notify_listeners(self, event: SimulatedEvent) -> None:
        """Notify all listeners of an event."""
        for listener in self._event_listeners:
            listener(event)

    @property
    def pending_events(self) -> List[SimulatedEvent]:
        """Get all undelivered events."""
        return [e for e in self._pending_events if not e.delivered]

    @property
    def delivered_events(self) -> List[SimulatedEvent]:
        """Get all delivered events."""
        return list(self._delivered_events)

    @property
    def all_events(self) -> List[SimulatedEvent]:
        """Get all events (pending and delivered)."""
        return self._pending_events + self._delivered_events

    def get_events_by_type(self, event_type: str) -> List[SimulatedEvent]:
        """
        Get all events of a specific type.

        Args:
            event_type: The event type to filter by.

        Returns:
            List of matching events.
        """
        return [e for e in self.all_events if e.type == event_type]

    def get_events_for_instance(self, instance_id: str) -> List[SimulatedEvent]:
        """
        Get all events delivered to a specific instance.

        Args:
            instance_id: The workflow instance ID.

        Returns:
            List of events delivered to that instance.
        """
        return [e for e in self._delivered_events if e.delivered_to == instance_id]

    def is_waiting(self, instance_id: str) -> bool:
        """
        Check if an instance is waiting for events.

        Args:
            instance_id: The workflow instance ID.

        Returns:
            True if instance has registered waiters.
        """
        return any(w.instance_id == instance_id and not w.matched for w in self._waiters)

    def get_waiting_for(self, instance_id: str) -> List[str]:
        """
        Get the event types an instance is waiting for.

        Args:
            instance_id: The workflow instance ID.

        Returns:
            List of event types the instance is waiting for.
        """
        for matcher in self._waiters:
            if matcher.instance_id == instance_id and not matcher.matched:
                return matcher.event_types
        return []

    def clear(self) -> None:
        """Clear all events and waiters."""
        self._pending_events.clear()
        self._delivered_events.clear()
        self._waiters.clear()

    def reset_delivered(self) -> None:
        """Reset delivered events but keep waiters."""
        self._delivered_events.clear()
