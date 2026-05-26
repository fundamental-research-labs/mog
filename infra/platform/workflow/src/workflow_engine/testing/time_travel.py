"""
Time Travel - Fast-forward through sleeps and timeouts in tests.

This module provides utilities for manipulating time in workflow tests,
allowing you to test workflows with sleeps, timeouts, and schedules
without actually waiting.

Example:
    ctx = MockContext({...})
    instance = test.trigger(ctx, event={...})

    # Fast-forward 7 days
    ctx.time.advance(days=7)

    # Workflow should have progressed past the sleep
    assert instance.current_step == "week_1_checkin"
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Callable, List, Optional


@dataclass
class PendingTimer:
    """A timer waiting to fire at a specific time."""

    fire_at: datetime
    callback: Callable[[], None]
    name: str = ""
    canceled: bool = False

    def cancel(self) -> None:
        """Cancel this timer."""
        self.canceled = True


@dataclass
class PendingSleep:
    """A sleep operation waiting to complete."""

    wake_at: datetime
    instance_id: str
    step_name: str
    callback: Optional[Callable[[], None]] = None
    completed: bool = False


class TimeTraveler:
    """
    Time manipulation utility for workflow testing.

    Provides a controllable clock that can be advanced to test
    time-dependent workflow behavior like sleeps, timeouts, and schedules.

    Usage:
        time_traveler = TimeTraveler()

        # Get current time
        now = time_traveler.now()

        # Advance time
        time_traveler.advance(days=7)
        time_traveler.advance(hours=24)
        time_traveler.advance(minutes=30)

        # Set specific time
        time_traveler.set(datetime(2026, 3, 15, 10, 0, 0))

        # Register a sleep (used by MockContext)
        time_traveler.register_sleep(
            wake_at=now + timedelta(days=7),
            instance_id="inst_123",
            step_name="wait_for_approval"
        )
    """

    def __init__(self, initial_time: Optional[datetime] = None) -> None:
        """
        Initialize the time traveler.

        Args:
            initial_time: Starting time. Defaults to current UTC time.
        """
        self._current_time = initial_time or datetime.now(timezone.utc)
        self._timers: List[PendingTimer] = []
        self._sleeps: List[PendingSleep] = []
        self._time_listeners: List[Callable[[datetime], None]] = []

    def now(self) -> datetime:
        """Get the current simulated time."""
        return self._current_time

    def set(self, time: datetime) -> None:
        """
        Set the current time to a specific value.

        Note: This does not fire timers/sleeps between old and new time.
        Use advance() if you want timers to fire.

        Args:
            time: The time to set.
        """
        if time.tzinfo is None:
            time = time.replace(tzinfo=timezone.utc)
        self._current_time = time
        self._notify_listeners()

    def advance(
        self,
        days: int = 0,
        hours: int = 0,
        minutes: int = 0,
        seconds: int = 0,
        milliseconds: int = 0,
    ) -> None:
        """
        Advance time by the specified duration.

        This will fire any timers/sleeps that fall within the advanced period.

        Args:
            days: Number of days to advance.
            hours: Number of hours to advance.
            minutes: Number of minutes to advance.
            seconds: Number of seconds to advance.
            milliseconds: Number of milliseconds to advance.
        """
        delta = timedelta(
            days=days,
            hours=hours,
            minutes=minutes,
            seconds=seconds,
            milliseconds=milliseconds,
        )
        target_time = self._current_time + delta
        self._advance_to(target_time)

    def _advance_to(self, target_time: datetime) -> None:
        """
        Advance to a target time, firing timers and sleeps in order.

        Args:
            target_time: The time to advance to.
        """
        while True:
            # Find the next event (timer or sleep) to fire
            next_event_time: Optional[datetime] = None
            next_timer: Optional[PendingTimer] = None
            next_sleep: Optional[PendingSleep] = None

            # Check timers
            for timer in self._timers:
                if (
                    not timer.canceled
                    and timer.fire_at <= target_time
                    and (next_event_time is None or timer.fire_at < next_event_time)
                ):
                    next_event_time = timer.fire_at
                    next_timer = timer
                    next_sleep = None

            # Check sleeps
            for sleep in self._sleeps:
                if (
                    not sleep.completed
                    and sleep.wake_at <= target_time
                    and (next_event_time is None or sleep.wake_at < next_event_time)
                ):
                    next_event_time = sleep.wake_at
                    next_sleep = sleep
                    next_timer = None

            if next_event_time is None:
                # No more events to fire
                self._current_time = target_time
                self._notify_listeners()
                break

            # Advance to the event time
            self._current_time = next_event_time

            # Fire the event
            if next_timer is not None:
                self._timers.remove(next_timer)
                next_timer.callback()
            elif next_sleep is not None:
                next_sleep.completed = True
                if next_sleep.callback:
                    next_sleep.callback()

            self._notify_listeners()

    def register_timer(
        self,
        fire_at: datetime,
        callback: Callable[[], None],
        name: str = "",
    ) -> PendingTimer:
        """
        Register a timer that fires at a specific time.

        Args:
            fire_at: When to fire the timer.
            callback: Function to call when timer fires.
            name: Optional name for debugging.

        Returns:
            The timer object, which can be canceled.
        """
        if fire_at.tzinfo is None:
            fire_at = fire_at.replace(tzinfo=timezone.utc)
        timer = PendingTimer(fire_at=fire_at, callback=callback, name=name)
        self._timers.append(timer)
        return timer

    def register_sleep(
        self,
        wake_at: datetime,
        instance_id: str,
        step_name: str,
        callback: Optional[Callable[[], None]] = None,
    ) -> PendingSleep:
        """
        Register a sleep that completes at a specific time.

        Args:
            wake_at: When the sleep completes.
            instance_id: The workflow instance ID.
            step_name: The step that initiated the sleep.
            callback: Optional callback when sleep completes.

        Returns:
            The sleep object, which tracks completion status.
        """
        if wake_at.tzinfo is None:
            wake_at = wake_at.replace(tzinfo=timezone.utc)
        sleep = PendingSleep(
            wake_at=wake_at,
            instance_id=instance_id,
            step_name=step_name,
            callback=callback,
        )
        self._sleeps.append(sleep)
        return sleep

    def add_listener(self, listener: Callable[[datetime], None]) -> None:
        """
        Add a listener that's called when time changes.

        Args:
            listener: Function called with new time on each change.
        """
        self._time_listeners.append(listener)

    def remove_listener(self, listener: Callable[[datetime], None]) -> None:
        """
        Remove a time change listener.

        Args:
            listener: The listener to remove.
        """
        if listener in self._time_listeners:
            self._time_listeners.remove(listener)

    def _notify_listeners(self) -> None:
        """Notify all listeners of time change."""
        for listener in self._time_listeners:
            listener(self._current_time)

    @property
    def pending_timers(self) -> List[PendingTimer]:
        """Get all pending (non-canceled) timers."""
        return [t for t in self._timers if not t.canceled]

    @property
    def pending_sleeps(self) -> List[PendingSleep]:
        """Get all pending (non-completed) sleeps."""
        return [s for s in self._sleeps if not s.completed]

    def clear(self) -> None:
        """Clear all pending timers and sleeps."""
        self._timers.clear()
        self._sleeps.clear()

    def get_sleep_for_instance(self, instance_id: str) -> Optional[PendingSleep]:
        """
        Get the pending sleep for a workflow instance.

        Args:
            instance_id: The workflow instance ID.

        Returns:
            The pending sleep, or None if not sleeping.
        """
        for sleep in self._sleeps:
            if sleep.instance_id == instance_id and not sleep.completed:
                return sleep
        return None

    def is_instance_sleeping(self, instance_id: str) -> bool:
        """
        Check if a workflow instance is currently sleeping.

        Args:
            instance_id: The workflow instance ID.

        Returns:
            True if the instance has a pending sleep.
        """
        return self.get_sleep_for_instance(instance_id) is not None

    def time_until_next_event(self) -> Optional[timedelta]:
        """
        Get the time until the next timer or sleep fires.

        Returns:
            The duration until next event, or None if no pending events.
        """
        next_time: Optional[datetime] = None

        for timer in self._timers:
            if not timer.canceled:
                if next_time is None or timer.fire_at < next_time:
                    next_time = timer.fire_at

        for sleep in self._sleeps:
            if not sleep.completed:
                if next_time is None or sleep.wake_at < next_time:
                    next_time = sleep.wake_at

        if next_time is None:
            return None

        return next_time - self._current_time
