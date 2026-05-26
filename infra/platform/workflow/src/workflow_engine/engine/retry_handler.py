"""
Retry Handler - Exponential backoff, max attempts, dead letter routing.

The RetryHandler is responsible for:
- Computing retry delays based on backoff strategy
- Tracking retry attempts per step
- Determining when retries are exhausted
- Routing failed steps to dead letter queue
- Supporting custom retry policies

Design Principles:
- Retries are step-level, not instance-level
- Each step can have its own retry configuration
- Exponential backoff with jitter prevents thundering herd
- Dead letter routing after retries exhausted

Usage:
    retry_handler = RetryHandler(dead_letter_store)

    # Check if should retry
    decision = retry_handler.should_retry(
        step_execution=execution,
        retry_config=step_def.retry_config,
        error_type="RetryableError",
    )

    if decision.should_retry:
        await asyncio.sleep(decision.delay.total_seconds())
        # retry step
    else:
        # move to dead letter queue
"""

from __future__ import annotations

import logging
import random
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from .types import (
    BackoffStrategy,
    DeadLetterEntry,
    DeadLetterStore,
    EventLogStore,
    NonRetryableError,
    RetryableError,
    RetryConfig,
    StepExecution,
    StepStatus,
    WorkflowInstance,
)


logger = logging.getLogger(__name__)


@dataclass
class RetryDecision:
    """
    Decision on whether and how to retry a failed step.

    Attributes:
        should_retry: Whether to retry
        delay: How long to wait before retry (if should_retry)
        attempt: Current attempt number
        max_attempts: Maximum attempts allowed
        reason: Explanation for decision
        error_type: Type of error that caused failure
    """
    should_retry: bool
    delay: Optional[timedelta] = None
    attempt: int = 1
    max_attempts: int = 1
    reason: str = ""
    error_type: Optional[str] = None

    @property
    def attempts_remaining(self) -> int:
        """Number of retry attempts remaining."""
        return max(0, self.max_attempts - self.attempt)

    @property
    def is_exhausted(self) -> bool:
        """True if all retries have been used."""
        return self.attempt >= self.max_attempts


class RetryHandler:
    """
    Handles retry logic for failed workflow steps.

    The RetryHandler computes retry delays, tracks attempts,
    and decides when to give up and route to dead letter queue.

    Supports multiple backoff strategies:
    - Fixed: Same delay every time
    - Linear: delay * attempt_number
    - Exponential: delay * 2^attempt_number

    Attributes:
        dead_letter_store: Storage for dead letter entries
        event_log: Audit log storage
        jitter_factor: Random jitter to add (0-1, default 0.1)
    """

    def __init__(
        self,
        dead_letter_store: Optional[DeadLetterStore] = None,
        event_log: Optional[EventLogStore] = None,
        jitter_factor: float = 0.1,
    ):
        """
        Initialize the RetryHandler.

        Args:
            dead_letter_store: Storage for dead letter entries
            event_log: Audit log storage
            jitter_factor: Random jitter to add to delays (0-1)
        """
        self.dead_letter_store = dead_letter_store
        self.event_log = event_log
        self.jitter_factor = max(0.0, min(1.0, jitter_factor))

    # =========================================================================
    # Retry Decision
    # =========================================================================

    def should_retry(
        self,
        step_execution: StepExecution,
        retry_config: Optional[RetryConfig],
        error_type: str,
    ) -> RetryDecision:
        """
        Determine whether a failed step should be retried.

        Args:
            step_execution: The failed step execution record
            retry_config: Retry configuration (may be None)
            error_type: Type of error that occurred

        Returns:
            RetryDecision with retry info
        """
        # No retry config = no retries
        if retry_config is None:
            return RetryDecision(
                should_retry=False,
                attempt=step_execution.attempt,
                max_attempts=1,
                reason="No retry configuration",
                error_type=error_type,
            )

        # Non-retryable errors never retry
        if error_type == "NonRetryableError":
            return RetryDecision(
                should_retry=False,
                attempt=step_execution.attempt,
                max_attempts=retry_config.max_attempts,
                reason="Non-retryable error",
                error_type=error_type,
            )

        # Check if retries exhausted
        if step_execution.attempt >= retry_config.max_attempts:
            return RetryDecision(
                should_retry=False,
                attempt=step_execution.attempt,
                max_attempts=retry_config.max_attempts,
                reason="Max retries exhausted",
                error_type=error_type,
            )

        # Check if error type is in retryable list (if specified)
        if retry_config.retryable_errors:
            if error_type not in retry_config.retryable_errors:
                return RetryDecision(
                    should_retry=False,
                    attempt=step_execution.attempt,
                    max_attempts=retry_config.max_attempts,
                    reason=f"Error type {error_type} not in retryable list",
                    error_type=error_type,
                )

        # Calculate delay
        delay = self.calculate_delay(
            attempt=step_execution.attempt,
            config=retry_config,
        )

        return RetryDecision(
            should_retry=True,
            delay=delay,
            attempt=step_execution.attempt,
            max_attempts=retry_config.max_attempts,
            reason=f"Retry {step_execution.attempt + 1} of {retry_config.max_attempts}",
            error_type=error_type,
        )

    def should_retry_from_result(
        self,
        error: Optional[str],
        error_type: Optional[str],
        attempt: int,
        retry_config: Optional[RetryConfig],
    ) -> RetryDecision:
        """
        Convenience method to check retry from step result info.

        Args:
            error: Error message
            error_type: Type of error
            attempt: Current attempt number
            retry_config: Retry configuration

        Returns:
            RetryDecision
        """
        # Create a mock step execution for the decision logic
        execution = StepExecution(
            step_name="",
            status=StepStatus.FAILED,
            attempt=attempt,
            error=error,
            error_type=error_type,
        )

        return self.should_retry(
            step_execution=execution,
            retry_config=retry_config,
            error_type=error_type or "UnknownError",
        )

    # =========================================================================
    # Delay Calculation
    # =========================================================================

    def calculate_delay(
        self,
        attempt: int,
        config: RetryConfig,
    ) -> timedelta:
        """
        Calculate the delay before next retry attempt.

        Args:
            attempt: Current attempt number (1-indexed)
            config: Retry configuration

        Returns:
            Delay duration with optional jitter
        """
        base_delay = config.initial_delay

        if config.backoff == BackoffStrategy.FIXED:
            delay = base_delay
        elif config.backoff == BackoffStrategy.LINEAR:
            delay = base_delay * attempt
        elif config.backoff == BackoffStrategy.EXPONENTIAL:
            # 2^(attempt-1) for exponential growth
            multiplier = 2 ** (attempt - 1)
            delay = timedelta(seconds=base_delay.total_seconds() * multiplier)
        else:
            delay = base_delay

        # Cap at max delay
        if delay > config.max_delay:
            delay = config.max_delay

        # Add jitter
        if self.jitter_factor > 0:
            delay = self._add_jitter(delay)

        return delay

    def _add_jitter(self, delay: timedelta) -> timedelta:
        """
        Add random jitter to a delay.

        Jitter prevents thundering herd when many workflows retry simultaneously.

        Args:
            delay: Base delay

        Returns:
            Delay with jitter added
        """
        jitter_range = delay.total_seconds() * self.jitter_factor
        jitter = random.uniform(-jitter_range, jitter_range)
        new_seconds = max(0, delay.total_seconds() + jitter)
        return timedelta(seconds=new_seconds)

    def calculate_all_delays(
        self,
        config: RetryConfig,
    ) -> List[timedelta]:
        """
        Calculate delays for all possible retry attempts.

        Useful for displaying retry schedule to users.

        Args:
            config: Retry configuration

        Returns:
            List of delays for attempts 1 through max_attempts
        """
        delays = []
        for attempt in range(1, config.max_attempts + 1):
            # Calculate without jitter for predictable display
            original_jitter = self.jitter_factor
            self.jitter_factor = 0
            delay = self.calculate_delay(attempt, config)
            self.jitter_factor = original_jitter
            delays.append(delay)
        return delays

    # =========================================================================
    # Dead Letter Routing
    # =========================================================================

    async def send_to_dead_letter(
        self,
        instance: WorkflowInstance,
        step_execution: StepExecution,
        error: str,
        error_type: str,
        can_retry: bool = True,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Optional[DeadLetterEntry]:
        """
        Send a failed workflow to the dead letter queue.

        Called when retries are exhausted or for non-retryable errors.

        Args:
            instance: The failed workflow instance
            step_execution: The failed step execution
            error: Error message
            error_type: Type of error
            can_retry: Whether manual retry is possible
            metadata: Additional metadata

        Returns:
            The DeadLetterEntry, or None if no dead letter store
        """
        if self.dead_letter_store is None:
            logger.warning(
                f"Cannot send to dead letter: no store configured "
                f"(instance={instance.instance_id})"
            )
            return None

        import uuid
        entry = DeadLetterEntry(
            entry_id=f"dlq_{uuid.uuid4().hex[:16]}",
            instance_id=instance.instance_id,
            workflow_id=instance.workflow_id,
            workflow_version=instance.workflow_version,
            final_state=instance.to_dict(),
            failure_reason=error,
            failure_type=error_type,
            step_name=step_execution.step_name,
            attempts=step_execution.attempt,
            failed_at=datetime.utcnow(),
            can_retry=can_retry,
            metadata={
                **(metadata or {}),
                "step_history": [s.to_dict() for s in instance.step_history],
                "trigger_event": instance.trigger_event,
            },
        )

        await self.dead_letter_store.save(entry)

        # Log event
        if self.event_log:
            await self.event_log.log_event(
                instance_id=instance.instance_id,
                event_type="sent_to_dead_letter",
                data={
                    "entry_id": entry.entry_id,
                    "step_name": step_execution.step_name,
                    "error": error,
                    "error_type": error_type,
                    "attempts": step_execution.attempt,
                },
            )

        logger.error(
            f"Sent instance {instance.instance_id} to dead letter queue: {error}"
        )

        return entry

    # =========================================================================
    # Retry Tracking
    # =========================================================================

    def get_retry_stats(
        self,
        step_history: List[StepExecution],
        step_name: str,
    ) -> Dict[str, Any]:
        """
        Get retry statistics for a specific step.

        Args:
            step_history: Full step history
            step_name: The step to analyze

        Returns:
            Dict with retry statistics
        """
        step_executions = [s for s in step_history if s.step_name == step_name]

        if not step_executions:
            return {
                "step_name": step_name,
                "total_attempts": 0,
                "successful": False,
                "errors": [],
            }

        errors = []
        for execution in step_executions:
            if execution.error:
                errors.append({
                    "attempt": execution.attempt,
                    "error": execution.error,
                    "error_type": execution.error_type,
                    "timestamp": execution.completed_at.isoformat() if execution.completed_at else None,
                })

        final_execution = step_executions[-1]

        return {
            "step_name": step_name,
            "total_attempts": final_execution.attempt,
            "successful": final_execution.status == StepStatus.COMPLETED,
            "final_status": final_execution.status.value,
            "errors": errors,
            "total_duration_ms": self._calculate_total_duration(step_executions),
        }

    def _calculate_total_duration(
        self,
        executions: List[StepExecution],
    ) -> Optional[int]:
        """Calculate total duration across all retry attempts."""
        total_ms = 0
        for execution in executions:
            if execution.started_at and execution.completed_at:
                duration = execution.completed_at - execution.started_at
                total_ms += int(duration.total_seconds() * 1000)
        return total_ms if total_ms > 0 else None


class RetryPolicy:
    """
    Pre-defined retry policies for common scenarios.

    Usage:
        @step
        @retry(**RetryPolicy.EXTERNAL_API)
        def call_api(self, ctx):
            ...
    """

    # Default retry policy
    DEFAULT = {
        "max_attempts": 3,
        "backoff": BackoffStrategy.EXPONENTIAL,
        "initial_delay": timedelta(seconds=1),
        "max_delay": timedelta(minutes=1),
    }

    # For external API calls (longer delays, more attempts)
    EXTERNAL_API = {
        "max_attempts": 5,
        "backoff": BackoffStrategy.EXPONENTIAL,
        "initial_delay": timedelta(seconds=2),
        "max_delay": timedelta(minutes=5),
    }

    # For rate-limited APIs (longer delays)
    RATE_LIMITED = {
        "max_attempts": 10,
        "backoff": BackoffStrategy.EXPONENTIAL,
        "initial_delay": timedelta(seconds=5),
        "max_delay": timedelta(minutes=15),
    }

    # For database operations (quick retries)
    DATABASE = {
        "max_attempts": 3,
        "backoff": BackoffStrategy.LINEAR,
        "initial_delay": timedelta(milliseconds=100),
        "max_delay": timedelta(seconds=5),
    }

    # For idempotent operations (aggressive retry)
    IDEMPOTENT = {
        "max_attempts": 10,
        "backoff": BackoffStrategy.EXPONENTIAL,
        "initial_delay": timedelta(milliseconds=500),
        "max_delay": timedelta(minutes=2),
    }

    # No retry (fail fast)
    NONE = {
        "max_attempts": 1,
        "backoff": BackoffStrategy.FIXED,
        "initial_delay": timedelta(seconds=0),
        "max_delay": timedelta(seconds=0),
    }

    @classmethod
    def create_config(cls, policy_name: str) -> RetryConfig:
        """
        Create a RetryConfig from a policy name.

        Args:
            policy_name: One of DEFAULT, EXTERNAL_API, RATE_LIMITED, DATABASE, IDEMPOTENT, NONE

        Returns:
            RetryConfig with policy settings
        """
        policy = getattr(cls, policy_name.upper(), cls.DEFAULT)
        return RetryConfig(**policy)

    @classmethod
    def custom(
        cls,
        max_attempts: int = 3,
        backoff: BackoffStrategy = BackoffStrategy.EXPONENTIAL,
        initial_delay_seconds: float = 1.0,
        max_delay_seconds: float = 60.0,
        retryable_errors: Optional[List[str]] = None,
    ) -> RetryConfig:
        """
        Create a custom retry configuration.

        Args:
            max_attempts: Maximum retry attempts
            backoff: Backoff strategy
            initial_delay_seconds: Initial delay in seconds
            max_delay_seconds: Maximum delay in seconds
            retryable_errors: List of error types to retry (empty = all RetryableError)

        Returns:
            Custom RetryConfig
        """
        return RetryConfig(
            max_attempts=max_attempts,
            backoff=backoff,
            initial_delay=timedelta(seconds=initial_delay_seconds),
            max_delay=timedelta(seconds=max_delay_seconds),
            retryable_errors=retryable_errors or [],
        )
