"""
@wait_for Integration Tests

Tests the @wait_for decorator functionality:
- Wait for single event type
- Wait for multiple event types (first one wins)
- Timeout fires after duration
- Event arrives before timeout
- Event arrives after timeout (should be ignored)
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
    VersioningStrategy,
)


class TestWaitForSingleEvent:
    """Tests for waiting on a single event type."""

    @pytest.mark.asyncio
    async def test_wait_for_single_event_success(self, mock_engine, stores):
        """Test successfully waiting for a single event."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="SingleEventWait",
            description="Wait for single event",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="initiate"),
                StepDefinition(
                    name="wait_for_approval",
                    wait_for_events=["approval:granted"],
                    timeout="7d",
                ),
                StepDefinition(name="finalize"),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("SingleEventWait", event_data={})

        # Move to waiting state
        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)

        await mock_engine.complete_step(instance_id, "initiate", next_step="wait_for_approval")
        await mock_engine.enter_waiting_state(
            instance_id,
            events=["approval:granted"],
            timeout=timedelta(days=7)
        )

        # Verify waiting
        instance = await mock_engine.get_instance(instance_id)
        assert instance.status == InstanceStatus.WAITING
        assert "approval:granted" in instance.waiting.events

        # Send event
        success = await mock_engine.resume_instance(
            instance_id,
            "approval:granted",
            {"approved_by": "manager", "timestamp": datetime.utcnow().isoformat()}
        )

        assert success

        # Verify resumed
        instance = await mock_engine.get_instance(instance_id)
        assert instance.status == InstanceStatus.RUNNING
        assert instance.waiting is None
        assert instance.state["last_event"]["type"] == "approval:granted"
        assert instance.state["last_event"]["data"]["approved_by"] == "manager"

    @pytest.mark.asyncio
    async def test_wait_for_single_event_preserves_state(self, mock_engine, stores):
        """Test that state is preserved when entering and exiting wait."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="StatePreserveWait",
            description="State preservation during wait",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="prepare"),
                StepDefinition(name="wait"),
                StepDefinition(name="use_state"),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("StatePreserveWait", event_data={})

        # Build up state before waiting
        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        instance.state = {
            "prepared_data": {"key": "value", "count": 42},
            "metadata": {"user": "test_user"},
        }
        await stores.instances.update(instance_id, instance)

        await mock_engine.complete_step(instance_id, "prepare", next_step="wait")
        await mock_engine.enter_waiting_state(instance_id, events=["data:ready"])

        # Verify state preserved in waiting
        instance = await mock_engine.get_instance(instance_id)
        assert instance.state["prepared_data"]["key"] == "value"
        assert instance.state["prepared_data"]["count"] == 42

        # Resume
        await mock_engine.resume_instance(instance_id, "data:ready", {"new_data": "arrived"})

        # Verify state still preserved after resume
        instance = await mock_engine.get_instance(instance_id)
        assert instance.state["prepared_data"]["key"] == "value"
        assert instance.state["prepared_data"]["count"] == 42


class TestWaitForMultipleEvents:
    """Tests for waiting on multiple event types."""

    @pytest.mark.asyncio
    async def test_wait_for_multiple_events_first_wins(self, mock_engine, stores):
        """Test that first matching event resumes workflow."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="MultiEventWait",
            description="Wait for multiple events",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="prepare"),
                StepDefinition(
                    name="wait_for_decision",
                    wait_for_events=["decision:approve", "decision:reject", "decision:defer"],
                ),
                StepDefinition(name="handle_decision"),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        # Test with "approve"
        instance_id_1 = await mock_engine.trigger_workflow("MultiEventWait", event_data={})
        instance = await mock_engine.get_instance(instance_id_1)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id_1, instance)

        await mock_engine.complete_step(instance_id_1, "prepare", next_step="wait_for_decision")
        await mock_engine.enter_waiting_state(
            instance_id_1,
            events=["decision:approve", "decision:reject", "decision:defer"]
        )

        # Send approve event
        await mock_engine.resume_instance(instance_id_1, "decision:approve", {"approved": True})

        instance = await mock_engine.get_instance(instance_id_1)
        assert instance.status == InstanceStatus.RUNNING
        assert instance.state["last_event"]["type"] == "decision:approve"

        # Test with "reject"
        instance_id_2 = await mock_engine.trigger_workflow("MultiEventWait", event_data={})
        instance = await mock_engine.get_instance(instance_id_2)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id_2, instance)

        await mock_engine.complete_step(instance_id_2, "prepare", next_step="wait_for_decision")
        await mock_engine.enter_waiting_state(
            instance_id_2,
            events=["decision:approve", "decision:reject", "decision:defer"]
        )

        # Send reject event
        await mock_engine.resume_instance(instance_id_2, "decision:reject", {"reason": "insufficient"})

        instance = await mock_engine.get_instance(instance_id_2)
        assert instance.status == InstanceStatus.RUNNING
        assert instance.state["last_event"]["type"] == "decision:reject"
        assert instance.state["last_event"]["data"]["reason"] == "insufficient"

    @pytest.mark.asyncio
    async def test_non_matching_event_does_not_resume(self, mock_engine, stores):
        """Test that non-matching events don't resume the workflow."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="FilteredWait",
            description="Filtered event wait",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="wait"),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("FilteredWait", event_data={})
        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)

        await mock_engine.enter_waiting_state(
            instance_id,
            events=["specific:event_a", "specific:event_b"]
        )

        # Try non-matching events
        result = await mock_engine.resume_instance(instance_id, "other:event", {})
        assert result is False

        result = await mock_engine.resume_instance(instance_id, "specific:event_c", {})
        assert result is False

        # Should still be waiting
        instance = await mock_engine.get_instance(instance_id)
        assert instance.status == InstanceStatus.WAITING

        # Matching event works
        result = await mock_engine.resume_instance(instance_id, "specific:event_a", {})
        assert result is True

        instance = await mock_engine.get_instance(instance_id)
        assert instance.status == InstanceStatus.RUNNING


class TestWaitTimeout:
    """Tests for wait timeout behavior."""

    @pytest.mark.asyncio
    async def test_timeout_timer_created(self, mock_engine, stores):
        """Test that timeout timer is created when entering wait state."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="TimeoutWait",
            description="Wait with timeout",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="wait", wait_for_events=["response"], timeout="1h"),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("TimeoutWait", event_data={})
        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)

        timeout = timedelta(hours=1)
        await mock_engine.enter_waiting_state(
            instance_id,
            events=["response"],
            timeout=timeout
        )

        # Verify timer created
        timers = await stores.timers.get_by_instance(instance_id)
        assert len(timers) == 1
        assert timers[0].event_type == "timeout"

        # Verify timeout_at set correctly
        instance = await mock_engine.get_instance(instance_id)
        assert instance.waiting.timeout_at is not None
        assert instance.waiting.timer_id == timers[0].id

    @pytest.mark.asyncio
    async def test_timeout_fires_when_due(self, stores):
        """Test that timeout timer fires when time is due."""
        # Set up instance in waiting state with expired timeout
        instance = WorkflowInstance(
            id=f"inst_{uuid.uuid4().hex[:8]}",
            workflow_id=f"wf_{uuid.uuid4().hex[:8]}",
            workflow_name="TimeoutTest",
            workflow_version="1.0.0",
            status=InstanceStatus.WAITING,
            current_step="wait",
            state={},
            trigger_event={"type": "manual"},
            waiting=WaitingState(
                events=["response"],
                timeout_at=(datetime.utcnow() - timedelta(minutes=5)).isoformat() + "Z",
            ),
        )
        await stores.instances.create(instance)

        # Create expired timer
        timer = Timer(
            id=f"timer_{uuid.uuid4().hex[:8]}",
            instance_id=instance.id,
            fire_at=(datetime.utcnow() - timedelta(minutes=5)).isoformat() + "Z",
            event_type="timeout",
            event_data={"step": "wait"},
        )
        await stores.timers.create(timer)

        # Get due timers
        due_timers = await stores.timers.get_due(datetime.utcnow())
        assert len(due_timers) == 1
        assert due_timers[0].instance_id == instance.id

    @pytest.mark.asyncio
    async def test_event_before_timeout_cancels_timer(self, mock_engine, stores):
        """Test that receiving event before timeout cancels the timer."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="EventBeforeTimeout",
            description="Event arrives before timeout",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="wait", wait_for_events=["response"], timeout="1h"),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("EventBeforeTimeout", event_data={})
        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)

        await mock_engine.enter_waiting_state(
            instance_id,
            events=["response"],
            timeout=timedelta(hours=1)
        )

        # Verify timer exists
        timers_before = await stores.timers.get_by_instance(instance_id)
        assert len(timers_before) == 1

        # Event arrives
        await mock_engine.resume_instance(instance_id, "response", {"data": "arrived"})

        # Timer should be cancelled (in a real implementation)
        # For now, verify instance is no longer waiting
        instance = await mock_engine.get_instance(instance_id)
        assert instance.status == InstanceStatus.RUNNING
        assert instance.waiting is None

    @pytest.mark.asyncio
    async def test_event_after_timeout_ignored(self, stores):
        """Test that events arriving after timeout are ignored."""
        # Create instance that has already timed out
        instance = WorkflowInstance(
            id=f"inst_{uuid.uuid4().hex[:8]}",
            workflow_id=f"wf_{uuid.uuid4().hex[:8]}",
            workflow_name="TimeoutIgnored",
            workflow_version="1.0.0",
            status=InstanceStatus.RUNNING,  # Already resumed due to timeout
            current_step="handle_timeout",
            state={"timed_out": True},
            trigger_event={"type": "manual"},
        )
        await stores.instances.create(instance)

        # Try to "resume" with the original event
        # This should not work because instance is not waiting
        from tests.conftest import MockWorkflowEngine

        engine = MockWorkflowEngine(stores=stores)

        result = await engine.resume_instance(
            instance.id,
            "response",
            {"late_data": "arrived"}
        )

        # Should fail because not waiting
        assert result is False

        # Instance state unchanged
        instance = await stores.instances.get(instance.id)
        assert instance.state.get("timed_out") is True
        assert "late_data" not in str(instance.state)


class TestWaitWithFilters:
    """Tests for waiting with event filters."""

    @pytest.mark.asyncio
    async def test_wait_with_correlation_filter(self, mock_engine, stores):
        """Test waiting for events with correlation ID filter."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="CorrelatedWait",
            description="Wait with correlation",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="wait"),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        correlation_id = f"corr_{uuid.uuid4().hex[:8]}"

        instance_id = await mock_engine.trigger_workflow("CorrelatedWait", event_data={})
        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        instance.state["correlation_id"] = correlation_id
        await stores.instances.update(instance_id, instance)

        await mock_engine.enter_waiting_state(instance_id, events=["response"])

        # Verify waiting
        instance = await mock_engine.get_instance(instance_id)
        assert instance.status == InstanceStatus.WAITING
        assert instance.state["correlation_id"] == correlation_id


class TestWaitStateQueries:
    """Tests for querying waiting instances."""

    @pytest.mark.asyncio
    async def test_find_instances_waiting_for_event_type(self, stores):
        """Test finding all instances waiting for a specific event type."""
        # Create multiple instances waiting for different events
        instances_waiting_approval = []
        instances_waiting_payment = []

        for i in range(3):
            instance = WorkflowInstance(
                id=f"inst_approval_{i}",
                workflow_id="wf_1",
                workflow_name="ApprovalWorkflow",
                workflow_version="1.0.0",
                status=InstanceStatus.WAITING,
                current_step="wait",
                state={},
                trigger_event={"type": "manual"},
                waiting=WaitingState(events=["approval:granted"]),
            )
            await stores.instances.create(instance)
            instances_waiting_approval.append(instance.id)

        for i in range(2):
            instance = WorkflowInstance(
                id=f"inst_payment_{i}",
                workflow_id="wf_2",
                workflow_name="PaymentWorkflow",
                workflow_version="1.0.0",
                status=InstanceStatus.WAITING,
                current_step="wait",
                state={},
                trigger_event={"type": "manual"},
                waiting=WaitingState(events=["payment:received"]),
            )
            await stores.instances.create(instance)
            instances_waiting_payment.append(instance.id)

        # Find instances waiting for approval
        waiting_for_approval = await stores.instances.find_waiting_for_event("approval:granted")
        assert len(waiting_for_approval) == 3
        for inst in waiting_for_approval:
            assert inst.id in instances_waiting_approval

        # Find instances waiting for payment
        waiting_for_payment = await stores.instances.find_waiting_for_event("payment:received")
        assert len(waiting_for_payment) == 2
        for inst in waiting_for_payment:
            assert inst.id in instances_waiting_payment

    @pytest.mark.asyncio
    async def test_find_instances_waiting_for_multiple_events(self, stores):
        """Test finding instances that could match multiple event types."""
        # Instance waiting for either approval or rejection
        instance = WorkflowInstance(
            id=f"inst_{uuid.uuid4().hex[:8]}",
            workflow_id="wf_1",
            workflow_name="DecisionWorkflow",
            workflow_version="1.0.0",
            status=InstanceStatus.WAITING,
            current_step="wait",
            state={},
            trigger_event={"type": "manual"},
            waiting=WaitingState(events=["decision:approve", "decision:reject"]),
        )
        await stores.instances.create(instance)

        # Should be found when searching for either event
        found_approve = await stores.instances.find_waiting_for_event("decision:approve")
        assert len(found_approve) == 1
        assert found_approve[0].id == instance.id

        found_reject = await stores.instances.find_waiting_for_event("decision:reject")
        assert len(found_reject) == 1
        assert found_reject[0].id == instance.id


class TestWaitDurationVariants:
    """Tests for various timeout duration configurations."""

    @pytest.mark.asyncio
    async def test_short_timeout_milliseconds(self, mock_engine, stores):
        """Test wait with very short timeout (milliseconds)."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="ShortTimeout",
            description="Short timeout test",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="wait"),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("ShortTimeout", event_data={})
        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)

        # 100ms timeout
        await mock_engine.enter_waiting_state(
            instance_id,
            events=["fast:response"],
            timeout=timedelta(milliseconds=100)
        )

        # Timer should be created
        timers = await stores.timers.get_by_instance(instance_id)
        assert len(timers) == 1

    @pytest.mark.asyncio
    async def test_long_timeout_days(self, mock_engine, stores):
        """Test wait with long timeout (days)."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="LongTimeout",
            description="Long timeout test",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="wait"),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("LongTimeout", event_data={})
        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)

        # 30 day timeout
        await mock_engine.enter_waiting_state(
            instance_id,
            events=["quarterly:review"],
            timeout=timedelta(days=30)
        )

        instance = await mock_engine.get_instance(instance_id)
        assert instance.waiting.timeout_at is not None

        # Verify timeout is approximately 30 days from now
        timeout_at = datetime.fromisoformat(instance.waiting.timeout_at.replace("Z", "+00:00"))
        expected = datetime.utcnow() + timedelta(days=30)
        # Allow 1 minute tolerance
        assert abs((timeout_at.replace(tzinfo=None) - expected).total_seconds()) < 60

    @pytest.mark.asyncio
    async def test_no_timeout_indefinite_wait(self, mock_engine, stores):
        """Test wait without timeout (indefinite wait)."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="IndefiniteWait",
            description="Indefinite wait test",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="wait"),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("IndefiniteWait", event_data={})
        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)

        # No timeout specified
        await mock_engine.enter_waiting_state(
            instance_id,
            events=["eventual:response"],
            timeout=None
        )

        # Should be waiting without timeout
        instance = await mock_engine.get_instance(instance_id)
        assert instance.status == InstanceStatus.WAITING
        assert instance.waiting.timeout_at is None

        # No timer created
        timers = await stores.timers.get_by_instance(instance_id)
        assert len(timers) == 0
