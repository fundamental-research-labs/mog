"""
Timer Service - Handle timeouts, schedules, and sleep.

The TimerService is responsible for:
- Managing @wait_for timeouts
- Handling ctx.sleep() delays
- Processing scheduled workflow triggers (cron)
- Firing timers at the appropriate time
- Coordinating with the instance manager to resume workflows

Design Principles:
- Timers are persisted to survive restarts
- Multiple timer types: timeout, sleep, schedule
- Timers are associated with workflow instances
- Scheduled triggers create timers for their next execution

Usage:
    timer_service = TimerService(timer_store, instance_store)

    # Create a timeout timer
    await timer_service.create_timeout(
        instance_id="inst_123",
        timeout=timedelta(days=7),
    )

    # Create a sleep timer
    await timer_service.create_sleep(
        instance_id="inst_123",
        duration=timedelta(hours=24),
    )

    # Process due timers
    fired = await timer_service.process_due_timers()
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Literal, Optional

from .types import (
    InstanceStatus,
    InstanceStore,
    PendingTimer,
    TimerStore,
    TriggerConfig,
    TriggerType,
    WorkflowDefinition,
    WorkflowInstance,
    WorkflowStore,
)


logger = logging.getLogger(__name__)


# Try to import croniter for cron expression parsing
try:
    from croniter import croniter
    HAS_CRONITER = True
except ImportError:
    HAS_CRONITER = False
    logger.warning("croniter not installed - cron scheduling unavailable")


class TimerService:
    """
    Manages timers for workflow timeouts, sleeps, and schedules.

    The TimerService provides durable timer functionality:
    - Timers survive process restarts (persisted to storage)
    - Multiple timer types with different behaviors
    - Batch processing of due timers
    - Schedule (cron) support for periodic workflows

    Attributes:
        timer_store: Persistent storage for timers
        instance_store: Storage for workflow instances
        workflow_store: Storage for workflow definitions (for schedules)
        poll_interval: How often to check for due timers
    """

    def __init__(
        self,
        timer_store: TimerStore,
        instance_store: Optional[InstanceStore] = None,
        workflow_store: Optional[WorkflowStore] = None,
        poll_interval: timedelta = timedelta(seconds=1),
        id_generator: Optional[Callable[[], str]] = None,
    ):
        """
        Initialize the TimerService.

        Args:
            timer_store: Storage backend for timers
            instance_store: Storage for instances (optional)
            workflow_store: Storage for definitions (optional, needed for schedules)
            poll_interval: How often to check for due timers
            id_generator: Custom ID generator (default: UUID)
        """
        self.timer_store = timer_store
        self.instance_store = instance_store
        self.workflow_store = workflow_store
        self.poll_interval = poll_interval
        self._id_generator = id_generator or (lambda: f"timer_{uuid.uuid4().hex[:16]}")
        self._running = False
        self._poll_task: Optional[asyncio.Task[None]] = None

    # =========================================================================
    # Timer Creation
    # =========================================================================

    async def create_timeout(
        self,
        instance_id: str,
        timeout: timedelta,
        payload: Optional[Dict[str, Any]] = None,
    ) -> PendingTimer:
        """
        Create a timeout timer for @wait_for.

        When this timer fires, the waiting step receives a timeout event.

        Args:
            instance_id: The workflow instance
            timeout: How long until timeout
            payload: Additional data to pass when timer fires

        Returns:
            The created PendingTimer
        """
        fire_at = datetime.utcnow() + timeout

        timer = PendingTimer(
            timer_id=self._id_generator(),
            instance_id=instance_id,
            fire_at=fire_at,
            timer_type="timeout",
            payload=payload or {},
        )

        await self.timer_store.save(timer)

        logger.info(
            f"Created timeout timer {timer.timer_id} for {instance_id}, "
            f"fires at {fire_at.isoformat()}"
        )

        return timer

    async def create_sleep(
        self,
        instance_id: str,
        duration: timedelta,
        payload: Optional[Dict[str, Any]] = None,
    ) -> PendingTimer:
        """
        Create a sleep timer for ctx.sleep().

        When this timer fires, the workflow resumes execution.

        Args:
            instance_id: The workflow instance
            duration: How long to sleep
            payload: Additional data to pass when timer fires

        Returns:
            The created PendingTimer
        """
        fire_at = datetime.utcnow() + duration

        timer = PendingTimer(
            timer_id=self._id_generator(),
            instance_id=instance_id,
            fire_at=fire_at,
            timer_type="sleep",
            payload=payload or {},
        )

        await self.timer_store.save(timer)

        logger.info(
            f"Created sleep timer {timer.timer_id} for {instance_id}, "
            f"fires at {fire_at.isoformat()}"
        )

        return timer

    async def create_schedule(
        self,
        workflow_id: str,
        cron_expression: str,
        timezone_str: str = "UTC",
        payload: Optional[Dict[str, Any]] = None,
    ) -> PendingTimer:
        """
        Create a schedule timer for cron-triggered workflows.

        The timer fires at the next cron time, then creates a new timer
        for the following occurrence.

        Args:
            workflow_id: The workflow to trigger
            cron_expression: Cron expression (5 or 6 fields)
            timezone_str: Timezone for cron evaluation
            payload: Additional trigger data

        Returns:
            The created PendingTimer

        Raises:
            ValueError: If croniter not installed or invalid expression
        """
        if not HAS_CRONITER:
            raise ValueError("croniter package required for cron schedules")

        # Calculate next fire time
        now = datetime.now(timezone.utc)
        cron = croniter(cron_expression, now)
        fire_at = cron.get_next(datetime)

        # Store schedule info in payload
        schedule_payload = {
            **(payload or {}),
            "_schedule": {
                "workflow_id": workflow_id,
                "cron": cron_expression,
                "timezone": timezone_str,
            },
        }

        timer = PendingTimer(
            timer_id=self._id_generator(),
            instance_id=f"schedule:{workflow_id}",  # Special instance ID for schedules
            fire_at=fire_at,
            timer_type="schedule",
            payload=schedule_payload,
        )

        await self.timer_store.save(timer)

        logger.info(
            f"Created schedule timer {timer.timer_id} for {workflow_id}, "
            f"fires at {fire_at.isoformat()}"
        )

        return timer

    # =========================================================================
    # Timer Processing
    # =========================================================================

    async def process_due_timers(
        self,
        now: Optional[datetime] = None,
        batch_size: int = 100,
    ) -> List[FiredTimer]:
        """
        Process all timers that are due to fire.

        This is the main timer processing method. It:
        1. Gets all timers due before now
        2. Processes each timer based on type
        3. Deletes processed timers
        4. Returns list of fired timers

        Args:
            now: Current time (default: utcnow)
            batch_size: Maximum timers to process in one batch

        Returns:
            List of FiredTimer results
        """
        if now is None:
            now = datetime.utcnow()

        # Get due timers
        due_timers = await self.timer_store.get_due_timers(before=now)

        if not due_timers:
            return []

        # Limit batch size
        due_timers = due_timers[:batch_size]

        results: List[FiredTimer] = []

        for timer in due_timers:
            try:
                result = await self._process_timer(timer)
                results.append(result)

                # Delete processed timer
                await self.timer_store.delete(timer.timer_id)

            except Exception as e:
                logger.exception(f"Error processing timer {timer.timer_id}: {e}")
                results.append(FiredTimer(
                    timer=timer,
                    success=False,
                    error=str(e),
                ))

        logger.info(f"Processed {len(results)} due timers")
        return results

    async def _process_timer(self, timer: PendingTimer) -> "FiredTimer":
        """
        Process a single timer.

        Args:
            timer: The timer to process

        Returns:
            FiredTimer result
        """
        if timer.timer_type == "timeout":
            return await self._process_timeout(timer)
        elif timer.timer_type == "sleep":
            return await self._process_sleep(timer)
        elif timer.timer_type == "schedule":
            return await self._process_schedule(timer)
        else:
            return FiredTimer(
                timer=timer,
                success=False,
                error=f"Unknown timer type: {timer.timer_type}",
            )

    async def _process_timeout(self, timer: PendingTimer) -> "FiredTimer":
        """
        Process a timeout timer.

        The workflow instance should be woken up with a timeout event.
        """
        if self.instance_store is None:
            return FiredTimer(
                timer=timer,
                success=False,
                error="No instance store configured",
            )

        instance = await self.instance_store.get(timer.instance_id)

        if instance is None:
            return FiredTimer(
                timer=timer,
                success=False,
                error=f"Instance not found: {timer.instance_id}",
            )

        # Check instance is still waiting
        if instance.status != InstanceStatus.WAITING:
            logger.debug(
                f"Instance {timer.instance_id} no longer waiting "
                f"(status: {instance.status.value})"
            )
            return FiredTimer(
                timer=timer,
                success=True,
                skipped=True,
                reason="Instance not waiting",
            )

        return FiredTimer(
            timer=timer,
            success=True,
            instance_id=timer.instance_id,
            action="resume_with_timeout",
        )

    async def _process_sleep(self, timer: PendingTimer) -> "FiredTimer":
        """
        Process a sleep timer.

        The workflow instance should be resumed from its current step.
        """
        if self.instance_store is None:
            return FiredTimer(
                timer=timer,
                success=False,
                error="No instance store configured",
            )

        instance = await self.instance_store.get(timer.instance_id)

        if instance is None:
            return FiredTimer(
                timer=timer,
                success=False,
                error=f"Instance not found: {timer.instance_id}",
            )

        # Check instance is still waiting
        if instance.status != InstanceStatus.WAITING:
            logger.debug(
                f"Instance {timer.instance_id} no longer waiting "
                f"(status: {instance.status.value})"
            )
            return FiredTimer(
                timer=timer,
                success=True,
                skipped=True,
                reason="Instance not waiting",
            )

        return FiredTimer(
            timer=timer,
            success=True,
            instance_id=timer.instance_id,
            action="resume_after_sleep",
        )

    async def _process_schedule(self, timer: PendingTimer) -> "FiredTimer":
        """
        Process a schedule timer.

        This should trigger a new workflow instance and create
        the next schedule timer.
        """
        schedule_info = timer.payload.get("_schedule", {})
        workflow_id = schedule_info.get("workflow_id")
        cron_expression = schedule_info.get("cron")
        timezone_str = schedule_info.get("timezone", "UTC")

        if not workflow_id or not cron_expression:
            return FiredTimer(
                timer=timer,
                success=False,
                error="Invalid schedule timer payload",
            )

        # Create the next schedule timer
        try:
            await self.create_schedule(
                workflow_id=workflow_id,
                cron_expression=cron_expression,
                timezone_str=timezone_str,
                payload={k: v for k, v in timer.payload.items() if k != "_schedule"},
            )
        except Exception as e:
            logger.error(f"Failed to create next schedule timer: {e}")

        return FiredTimer(
            timer=timer,
            success=True,
            workflow_id=workflow_id,
            action="trigger_scheduled_workflow",
        )

    # =========================================================================
    # Timer Management
    # =========================================================================

    async def cancel_timer(self, timer_id: str) -> bool:
        """
        Cancel a pending timer.

        Args:
            timer_id: The timer to cancel

        Returns:
            True if timer was cancelled
        """
        result = await self.timer_store.delete(timer_id)
        if result:
            logger.info(f"Cancelled timer {timer_id}")
        return result

    async def cancel_instance_timers(self, instance_id: str) -> int:
        """
        Cancel all timers for an instance.

        Called when an instance is cancelled or completed.

        Args:
            instance_id: The instance

        Returns:
            Number of timers cancelled
        """
        count = await self.timer_store.delete_by_instance(instance_id)
        if count > 0:
            logger.info(f"Cancelled {count} timers for instance {instance_id}")
        return count

    async def get_instance_timers(self, instance_id: str) -> List[PendingTimer]:
        """
        Get all pending timers for an instance.

        Args:
            instance_id: The instance

        Returns:
            List of pending timers
        """
        return await self.timer_store.get_by_instance(instance_id)

    async def reschedule_timer(
        self,
        timer_id: str,
        new_fire_at: datetime,
    ) -> Optional[PendingTimer]:
        """
        Reschedule a timer to a new time.

        Args:
            timer_id: The timer to reschedule
            new_fire_at: New fire time

        Returns:
            Updated timer, or None if timer not found
        """
        # Get existing timer
        timers = await self.timer_store.get_due_timers(before=datetime.max)
        timer = next((t for t in timers if t.timer_id == timer_id), None)

        if timer is None:
            return None

        # Delete old timer
        await self.timer_store.delete(timer_id)

        # Create new timer with same properties but new time
        new_timer = PendingTimer(
            timer_id=self._id_generator(),
            instance_id=timer.instance_id,
            fire_at=new_fire_at,
            timer_type=timer.timer_type,
            payload=timer.payload,
        )

        await self.timer_store.save(new_timer)

        logger.info(f"Rescheduled timer {timer_id} -> {new_timer.timer_id}")
        return new_timer

    # =========================================================================
    # Schedule Management
    # =========================================================================

    async def register_scheduled_workflow(
        self,
        definition: WorkflowDefinition,
    ) -> Optional[PendingTimer]:
        """
        Register a scheduled workflow's trigger.

        Creates the initial schedule timer for a cron-triggered workflow.

        Args:
            definition: The workflow definition

        Returns:
            The created timer, or None if not a scheduled workflow
        """
        trigger = definition.trigger

        if trigger.trigger_type != TriggerType.SCHEDULE:
            return None

        if trigger.cron is None:
            logger.warning(f"Schedule trigger without cron: {definition.workflow_id}")
            return None

        return await self.create_schedule(
            workflow_id=definition.workflow_id,
            cron_expression=trigger.cron,
            timezone_str=trigger.timezone,
        )

    async def unregister_scheduled_workflow(self, workflow_id: str) -> int:
        """
        Unregister a scheduled workflow's timers.

        Args:
            workflow_id: The workflow

        Returns:
            Number of timers cancelled
        """
        # Schedule timers use "schedule:{workflow_id}" as instance_id
        return await self.cancel_instance_timers(f"schedule:{workflow_id}")

    # =========================================================================
    # Polling Loop
    # =========================================================================

    async def start_polling(
        self,
        callback: Callable[[List["FiredTimer"]], Any],
    ) -> None:
        """
        Start the timer polling loop.

        Continuously polls for due timers and calls callback with results.

        Args:
            callback: Function to call with fired timers
        """
        if self._running:
            logger.warning("Timer polling already running")
            return

        self._running = True

        async def poll_loop():
            while self._running:
                try:
                    fired = await self.process_due_timers()
                    if fired:
                        result = callback(fired)
                        if asyncio.iscoroutine(result):
                            await result
                except Exception as e:
                    logger.exception(f"Error in timer poll loop: {e}")

                await asyncio.sleep(self.poll_interval.total_seconds())

        self._poll_task = asyncio.create_task(poll_loop())
        logger.info(
            f"Started timer polling with interval {self.poll_interval.total_seconds()}s"
        )

    async def stop_polling(self) -> None:
        """Stop the timer polling loop."""
        self._running = False

        if self._poll_task:
            self._poll_task.cancel()
            try:
                await self._poll_task
            except asyncio.CancelledError:
                pass
            self._poll_task = None

        logger.info("Stopped timer polling")

    # =========================================================================
    # Utility Methods
    # =========================================================================

    def calculate_next_cron_time(
        self,
        cron_expression: str,
        timezone_str: str = "UTC",
        after: Optional[datetime] = None,
    ) -> datetime:
        """
        Calculate the next time a cron expression will fire.

        Args:
            cron_expression: Cron expression
            timezone_str: Timezone
            after: Calculate next time after this (default: now)

        Returns:
            Next fire time

        Raises:
            ValueError: If croniter not installed
        """
        if not HAS_CRONITER:
            raise ValueError("croniter package required for cron schedules")

        if after is None:
            after = datetime.now(timezone.utc)

        cron = croniter(cron_expression, after)
        return cron.get_next(datetime)

    def validate_cron_expression(self, cron_expression: str) -> bool:
        """
        Validate a cron expression.

        Args:
            cron_expression: Expression to validate

        Returns:
            True if valid
        """
        if not HAS_CRONITER:
            return False

        try:
            croniter(cron_expression)
            return True
        except (ValueError, KeyError):
            return False


class FiredTimer:
    """
    Result of a timer firing.

    Attributes:
        timer: The timer that fired
        success: Whether processing succeeded
        error: Error message if failed
        skipped: True if timer was skipped (e.g., instance no longer waiting)
        reason: Reason for skip
        instance_id: Instance to wake up (for timeout/sleep)
        workflow_id: Workflow to trigger (for schedule)
        action: What action to take
    """

    def __init__(
        self,
        timer: PendingTimer,
        success: bool,
        error: Optional[str] = None,
        skipped: bool = False,
        reason: Optional[str] = None,
        instance_id: Optional[str] = None,
        workflow_id: Optional[str] = None,
        action: Optional[str] = None,
    ):
        self.timer = timer
        self.success = success
        self.error = error
        self.skipped = skipped
        self.reason = reason
        self.instance_id = instance_id
        self.workflow_id = workflow_id
        self.action = action

    def __repr__(self) -> str:
        if self.success:
            if self.skipped:
                return f"FiredTimer({self.timer.timer_id}, skipped: {self.reason})"
            return f"FiredTimer({self.timer.timer_id}, action={self.action})"
        return f"FiredTimer({self.timer.timer_id}, error={self.error})"
