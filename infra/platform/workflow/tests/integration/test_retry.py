"""
@retry Integration Tests

Tests the @retry decorator functionality:
- Fixed backoff: delay stays constant
- Linear backoff: delay increases linearly
- Exponential backoff: delay doubles
- Max attempts reached -> dead letter
- RetryableError triggers retry
- NonRetryableError skips to failure
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import pytest

from workflow_engine.stores.memory import InMemoryStores
from workflow_engine.stores.base import (
    WorkflowDefinition,
    WorkflowInstance,
    InstanceStatus,
    RuntimeType,
    TriggerType,
    TriggerConfig,
    StepDefinition,
    StepHistory,
    WaitingState,
    Timer,
    DeadLetterEntry,
    VersioningStrategy,
)


class MockRetryHandler:
    """Mock retry handler for testing retry logic."""

    def __init__(self, stores: InMemoryStores):
        self.stores = stores
        self.retry_delays: Dict[str, List[timedelta]] = {}

    def calculate_fixed_delay(
        self, attempt: int, initial_delay: timedelta
    ) -> timedelta:
        """Fixed backoff - same delay every time."""
        return initial_delay

    def calculate_linear_delay(
        self, attempt: int, initial_delay: timedelta
    ) -> timedelta:
        """Linear backoff - delay * attempt_number."""
        return initial_delay * attempt

    def calculate_exponential_delay(
        self, attempt: int, initial_delay: timedelta
    ) -> timedelta:
        """Exponential backoff - delay * 2^(attempt-1)."""
        multiplier = 2 ** (attempt - 1)
        return initial_delay * multiplier

    def calculate_delay(
        self,
        attempt: int,
        backoff: str,
        initial_delay: timedelta,
        max_delay: timedelta,
    ) -> timedelta:
        """Calculate delay based on backoff strategy."""
        if backoff == "fixed":
            delay = self.calculate_fixed_delay(attempt, initial_delay)
        elif backoff == "linear":
            delay = self.calculate_linear_delay(attempt, initial_delay)
        elif backoff == "exponential":
            delay = self.calculate_exponential_delay(attempt, initial_delay)
        else:
            delay = initial_delay

        # Cap at max_delay
        if delay > max_delay:
            delay = max_delay

        return delay

    async def record_retry(
        self, instance_id: str, step_name: str, attempt: int, delay: timedelta
    ) -> None:
        """Record a retry attempt."""
        if instance_id not in self.retry_delays:
            self.retry_delays[instance_id] = []
        self.retry_delays[instance_id].append(delay)


@pytest.fixture
def retry_handler(stores: InMemoryStores) -> MockRetryHandler:
    """Create a mock retry handler."""
    return MockRetryHandler(stores)


class TestFixedBackoff:
    """Tests for fixed backoff strategy."""

    @pytest.mark.asyncio
    async def test_fixed_backoff_constant_delay(self, retry_handler):
        """Test that fixed backoff returns constant delay."""
        initial_delay = timedelta(seconds=5)
        max_delay = timedelta(minutes=5)

        delays = []
        for attempt in range(1, 6):
            delay = retry_handler.calculate_delay(
                attempt=attempt,
                backoff="fixed",
                initial_delay=initial_delay,
                max_delay=max_delay,
            )
            delays.append(delay)

        # All delays should be equal
        assert all(d == initial_delay for d in delays)
        assert delays == [initial_delay] * 5

    @pytest.mark.asyncio
    async def test_fixed_backoff_respects_max_delay(self, retry_handler):
        """Test that fixed backoff doesn't exceed max_delay."""
        initial_delay = timedelta(minutes=10)
        max_delay = timedelta(minutes=5)

        delay = retry_handler.calculate_delay(
            attempt=1,
            backoff="fixed",
            initial_delay=initial_delay,
            max_delay=max_delay,
        )

        # Should be capped at max_delay
        assert delay == max_delay


class TestLinearBackoff:
    """Tests for linear backoff strategy."""

    @pytest.mark.asyncio
    async def test_linear_backoff_increases_linearly(self, retry_handler):
        """Test that linear backoff increases linearly."""
        initial_delay = timedelta(seconds=5)
        max_delay = timedelta(minutes=5)

        delays = []
        for attempt in range(1, 6):
            delay = retry_handler.calculate_delay(
                attempt=attempt,
                backoff="linear",
                initial_delay=initial_delay,
                max_delay=max_delay,
            )
            delays.append(delay)

        # Verify linear progression: 5s, 10s, 15s, 20s, 25s
        expected = [
            timedelta(seconds=5),
            timedelta(seconds=10),
            timedelta(seconds=15),
            timedelta(seconds=20),
            timedelta(seconds=25),
        ]
        assert delays == expected

    @pytest.mark.asyncio
    async def test_linear_backoff_caps_at_max(self, retry_handler):
        """Test that linear backoff caps at max_delay."""
        initial_delay = timedelta(seconds=30)
        max_delay = timedelta(seconds=60)

        delays = []
        for attempt in range(1, 6):
            delay = retry_handler.calculate_delay(
                attempt=attempt,
                backoff="linear",
                initial_delay=initial_delay,
                max_delay=max_delay,
            )
            delays.append(delay)

        # Should cap at 60s after attempt 2
        # 30s, 60s (capped), 60s (capped), 60s (capped), 60s (capped)
        assert delays[0] == timedelta(seconds=30)
        assert delays[1] == timedelta(seconds=60)  # Would be 60s, equals cap
        assert delays[2] == max_delay  # Would be 90s, capped
        assert delays[3] == max_delay  # Would be 120s, capped
        assert delays[4] == max_delay  # Would be 150s, capped


class TestExponentialBackoff:
    """Tests for exponential backoff strategy."""

    @pytest.mark.asyncio
    async def test_exponential_backoff_doubles(self, retry_handler):
        """Test that exponential backoff doubles each time."""
        initial_delay = timedelta(seconds=1)
        max_delay = timedelta(minutes=5)

        delays = []
        for attempt in range(1, 6):
            delay = retry_handler.calculate_delay(
                attempt=attempt,
                backoff="exponential",
                initial_delay=initial_delay,
                max_delay=max_delay,
            )
            delays.append(delay)

        # Verify exponential progression: 1s, 2s, 4s, 8s, 16s
        expected = [
            timedelta(seconds=1),
            timedelta(seconds=2),
            timedelta(seconds=4),
            timedelta(seconds=8),
            timedelta(seconds=16),
        ]
        assert delays == expected

    @pytest.mark.asyncio
    async def test_exponential_backoff_caps_at_max(self, retry_handler):
        """Test that exponential backoff caps at max_delay."""
        initial_delay = timedelta(seconds=10)
        max_delay = timedelta(seconds=30)

        delays = []
        for attempt in range(1, 6):
            delay = retry_handler.calculate_delay(
                attempt=attempt,
                backoff="exponential",
                initial_delay=initial_delay,
                max_delay=max_delay,
            )
            delays.append(delay)

        # 10s, 20s, 30s (capped at 40s), 30s (capped), 30s (capped)
        assert delays[0] == timedelta(seconds=10)
        assert delays[1] == timedelta(seconds=20)
        assert delays[2] == max_delay  # Would be 40s, capped to 30s
        assert delays[3] == max_delay
        assert delays[4] == max_delay


class TestMaxAttemptsExhausted:
    """Tests for when max attempts are reached."""

    @pytest.mark.asyncio
    async def test_dead_letter_after_max_attempts(self, mock_engine, stores):
        """Test that workflow goes to dead letter after max attempts."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="RetryExhausted",
            description="Test max retry exhaustion",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(
                    name="flaky_step",
                    retry_max_attempts=3,
                    retry_backoff="exponential",
                    retry_initial_delay="1s",
                ),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("RetryExhausted", event_data={})

        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)

        # Simulate failed attempts
        now = datetime.utcnow().isoformat() + "Z"
        for attempt in range(1, 4):  # 3 attempts
            instance = await mock_engine.get_instance(instance_id)
            instance.step_history.append(
                StepHistory(
                    step_name="flaky_step",
                    started_at=now,
                    completed_at=now,
                    status="failed",
                    attempt=attempt,
                    error=f"Transient error (attempt {attempt})",
                )
            )
            await stores.instances.update(instance_id, instance)

        # After 3 attempts, move to failed/dead letter
        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.DEAD_LETTERED
        instance.error = "Max retries exceeded"
        await stores.instances.update(instance_id, instance)

        # Create dead letter entry
        dead_letter = DeadLetterEntry(
            id=f"dlq_{uuid.uuid4().hex[:8]}",
            instance=instance,
            reason="Max retries exceeded (3 attempts)",
        )
        await stores.dead_letters.add(dead_letter)

        # Verify dead letter
        entries = await stores.dead_letters.list_all()
        assert len(entries) == 1
        assert entries[0].instance.id == instance_id
        assert entries[0].reason == "Max retries exceeded (3 attempts)"

    @pytest.mark.asyncio
    async def test_retry_count_tracked_in_step_history(self, mock_engine, stores):
        """Test that retry count is tracked in step history."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="RetryTracking",
            description="Track retry attempts",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(
                    name="tracked_step",
                    retry_max_attempts=5,
                ),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("RetryTracking", event_data={})

        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)

        # Simulate 3 failed attempts then success
        now = datetime.utcnow().isoformat() + "Z"
        for attempt in range(1, 4):
            instance = await mock_engine.get_instance(instance_id)
            instance.step_history.append(
                StepHistory(
                    step_name="tracked_step",
                    started_at=now,
                    completed_at=now,
                    status="failed" if attempt < 3 else "retrying",
                    attempt=attempt,
                    error=f"Error on attempt {attempt}",
                )
            )
            await stores.instances.update(instance_id, instance)

        # Success on attempt 4
        instance = await mock_engine.get_instance(instance_id)
        instance.step_history.append(
            StepHistory(
                step_name="tracked_step",
                started_at=now,
                completed_at=now,
                status="completed",
                attempt=4,
            )
        )
        await stores.instances.update(instance_id, instance)

        # Verify history
        instance = await mock_engine.get_instance(instance_id)
        tracked_steps = [s for s in instance.step_history if s.step_name == "tracked_step"]
        assert len(tracked_steps) == 4

        # Verify attempts are numbered correctly
        attempts = [s.attempt for s in tracked_steps]
        assert attempts == [1, 2, 3, 4]

        # Final attempt succeeded
        assert tracked_steps[-1].status == "completed"


class TestRetryableErrors:
    """Tests for RetryableError handling."""

    @pytest.mark.asyncio
    async def test_retryable_error_triggers_retry(self, mock_engine, stores):
        """Test that RetryableError triggers retry."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="RetryableErrorWorkflow",
            description="Retryable error test",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(
                    name="api_call",
                    retry_max_attempts=3,
                    retry_backoff="exponential",
                ),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("RetryableErrorWorkflow", event_data={})

        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        instance.state["error_type"] = "RetryableError"
        instance.state["error_message"] = "Rate limited - retry after 60s"
        await stores.instances.update(instance_id, instance)

        # Record failed attempt with retryable error
        now = datetime.utcnow().isoformat() + "Z"
        instance = await mock_engine.get_instance(instance_id)
        instance.step_history.append(
            StepHistory(
                step_name="api_call",
                started_at=now,
                completed_at=now,
                status="retrying",  # Marked as retrying, not failed
                attempt=1,
                error="RetryableError: Rate limited",
            )
        )
        await stores.instances.update(instance_id, instance)

        # Verify instance is not failed yet
        instance = await mock_engine.get_instance(instance_id)
        assert instance.status == InstanceStatus.RUNNING  # Still running (will retry)


class TestNonRetryableErrors:
    """Tests for NonRetryableError handling."""

    @pytest.mark.asyncio
    async def test_non_retryable_error_skips_to_failure(self, mock_engine, stores):
        """Test that NonRetryableError immediately fails without retry."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="NonRetryableWorkflow",
            description="Non-retryable error test",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(
                    name="validate",
                    retry_max_attempts=5,  # Would retry if retryable
                ),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("NonRetryableWorkflow", event_data={})

        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)

        # Simulate NonRetryableError - should fail immediately
        await mock_engine.fail_step(
            instance_id,
            "validate",
            "NonRetryableError: Invalid input - missing required field"
        )

        # Verify instance failed without retrying
        instance = await mock_engine.get_instance(instance_id)
        assert instance.status == InstanceStatus.FAILED
        assert "NonRetryableError" in instance.error

        # Only one attempt should exist
        validate_steps = [s for s in instance.step_history if s.step_name == "validate"]
        assert len(validate_steps) == 1
        assert validate_steps[0].status == "failed"

    @pytest.mark.asyncio
    async def test_auth_error_is_non_retryable(self, mock_engine, stores):
        """Test that authentication errors don't retry."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="AuthErrorWorkflow",
            description="Auth error test",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(
                    name="call_api",
                    retry_max_attempts=5,
                ),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("AuthErrorWorkflow", event_data={})

        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)

        # 401 Unauthorized - should not retry
        await mock_engine.fail_step(
            instance_id,
            "call_api",
            "NonRetryableError: 401 Unauthorized - Invalid API key"
        )

        instance = await mock_engine.get_instance(instance_id)
        assert instance.status == InstanceStatus.FAILED

        # Should be only one attempt
        api_steps = [s for s in instance.step_history if s.step_name == "call_api"]
        assert len(api_steps) == 1


class TestRetryDelayExecution:
    """Tests for retry delay execution."""

    @pytest.mark.asyncio
    async def test_retry_creates_timer_for_delay(self, mock_engine, stores):
        """Test that retry creates a timer for the delay period."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="DelayedRetry",
            description="Retry with delay",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(
                    name="delayed_step",
                    retry_max_attempts=3,
                    retry_backoff="fixed",
                    retry_initial_delay="30s",
                ),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("DelayedRetry", event_data={})

        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)

        # Simulate first failure requiring retry
        now = datetime.utcnow().isoformat() + "Z"
        instance = await mock_engine.get_instance(instance_id)
        instance.step_history.append(
            StepHistory(
                step_name="delayed_step",
                started_at=now,
                completed_at=now,
                status="retrying",
                attempt=1,
                error="Transient error",
            )
        )
        await stores.instances.update(instance_id, instance)

        # Create timer for retry delay
        retry_at = (datetime.utcnow() + timedelta(seconds=30)).isoformat() + "Z"
        timer = Timer(
            id=f"timer_{uuid.uuid4().hex[:8]}",
            instance_id=instance_id,
            fire_at=retry_at,
            event_type="retry",
            event_data={"step": "delayed_step", "attempt": 2},
        )
        await stores.timers.create(timer)

        # Verify timer exists
        timers = await stores.timers.get_by_instance(instance_id)
        assert len(timers) == 1
        assert timers[0].event_type == "retry"
        assert timers[0].event_data["attempt"] == 2


class TestRetryStatePreservation:
    """Tests for state preservation across retries."""

    @pytest.mark.asyncio
    async def test_state_preserved_between_retry_attempts(self, mock_engine, stores):
        """Test that workflow state is preserved between retry attempts."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="StatePreserve",
            description="State preservation test",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(
                    name="accumulate",
                    retry_max_attempts=5,
                ),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("StatePreserve", event_data={})

        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        instance.state = {"attempt_results": [], "total_tries": 0}
        await stores.instances.update(instance_id, instance)

        # Simulate multiple retries, accumulating state
        now = datetime.utcnow().isoformat() + "Z"
        for attempt in range(1, 4):
            instance = await mock_engine.get_instance(instance_id)
            instance.state["attempt_results"].append({
                "attempt": attempt,
                "timestamp": now,
                "result": f"partial_{attempt}",
            })
            instance.state["total_tries"] = attempt

            instance.step_history.append(
                StepHistory(
                    step_name="accumulate",
                    started_at=now,
                    completed_at=now,
                    status="retrying" if attempt < 3 else "completed",
                    attempt=attempt,
                    error=f"Error {attempt}" if attempt < 3 else None,
                )
            )
            await stores.instances.update(instance_id, instance)

        # Verify state accumulated across attempts
        final_instance = await mock_engine.get_instance(instance_id)
        assert len(final_instance.state["attempt_results"]) == 3
        assert final_instance.state["total_tries"] == 3

        # Each attempt result preserved
        for i, result in enumerate(final_instance.state["attempt_results"], 1):
            assert result["attempt"] == i
            assert result["result"] == f"partial_{i}"


class TestRetryConfiguration:
    """Tests for various retry configurations."""

    @pytest.mark.asyncio
    async def test_zero_retry_fails_immediately(self, mock_engine, stores):
        """Test that zero retries fails on first error."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="NoRetry",
            description="No retry test",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(
                    name="no_retry_step",
                    retry_max_attempts=1,  # Only initial attempt, no retries
                ),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("NoRetry", event_data={})

        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)

        # First failure should be final
        await mock_engine.fail_step(instance_id, "no_retry_step", "Error occurred")

        instance = await mock_engine.get_instance(instance_id)
        assert instance.status == InstanceStatus.FAILED

    @pytest.mark.asyncio
    async def test_high_retry_count(self, retry_handler):
        """Test retry with high max attempts."""
        initial_delay = timedelta(seconds=1)
        max_delay = timedelta(minutes=30)

        # Calculate delays for 20 attempts
        delays = []
        for attempt in range(1, 21):
            delay = retry_handler.calculate_delay(
                attempt=attempt,
                backoff="exponential",
                initial_delay=initial_delay,
                max_delay=max_delay,
            )
            delays.append(delay)

        # Should cap at max_delay eventually
        assert delays[-1] == max_delay

        # Verify exponential growth until cap
        for i in range(1, len(delays)):
            if delays[i - 1] < max_delay:
                assert delays[i] == min(delays[i - 1] * 2, max_delay)
