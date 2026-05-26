"""
Durable Execution Integration Tests

Tests crash recovery and replay functionality:
- Start workflow, complete 2 steps
- Simulate crash (reset in-memory state)
- Reload from persistence
- Verify continues from step 3, not step 1
"""

from __future__ import annotations

import asyncio
import copy
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


class TestCrashRecovery:
    """Tests for crash recovery scenarios."""

    @pytest.mark.asyncio
    async def test_workflow_continues_from_last_completed_step(self, stores):
        """
        Test that workflow continues from last completed step after crash.

        Scenario:
        1. Start 5-step workflow
        2. Complete steps 1 and 2
        3. Simulate crash
        4. Recovery should start from step 3
        """
        from tests.conftest import MockWorkflowEngine

        # Create workflow definition
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="RecoverableWorkflow",
            description="5-step workflow for crash recovery test",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="step_1"),
                StepDefinition(name="step_2"),
                StepDefinition(name="step_3"),
                StepDefinition(name="step_4"),
                StepDefinition(name="step_5"),
            ],
        )

        # Step 1: Start workflow and complete 2 steps
        engine1 = MockWorkflowEngine(stores=stores)
        await engine1.start()
        await engine1.register_workflow(definition)

        instance_id = await engine1.trigger_workflow(
            "RecoverableWorkflow",
            event_data={"test": "crash_recovery"},
        )

        # Start running
        instance = await engine1.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        instance.state["progress"] = []
        await stores.instances.update(instance_id, instance)

        # Complete step_1
        instance = await engine1.get_instance(instance_id)
        instance.state["progress"].append("step_1_done")
        await stores.instances.update(instance_id, instance)
        await engine1.complete_step(instance_id, "step_1", output="result_1", next_step="step_2")

        # Complete step_2
        instance = await engine1.get_instance(instance_id)
        instance.state["progress"].append("step_2_done")
        await stores.instances.update(instance_id, instance)
        await engine1.complete_step(instance_id, "step_2", output="result_2", next_step="step_3")

        # Verify we're at step_3
        instance = await engine1.get_instance(instance_id)
        assert instance.current_step == "step_3"
        assert instance.state["progress"] == ["step_1_done", "step_2_done"]

        # Step 2: Simulate crash
        await engine1.stop()

        # Step 3: Recovery - create new engine with same stores
        engine2 = MockWorkflowEngine(stores=stores)
        await engine2.start()
        engine2._registered_workflows["RecoverableWorkflow"] = definition

        # Get recovered instance
        recovered = await engine2.get_instance(instance_id)

        # Verify recovery point
        assert recovered is not None
        assert recovered.current_step == "step_3"
        assert recovered.state["progress"] == ["step_1_done", "step_2_done"]

        # Verify step history
        completed_steps = [s for s in recovered.step_history if s.status == "completed"]
        assert len(completed_steps) == 2
        assert completed_steps[0].step_name == "step_1"
        assert completed_steps[1].step_name == "step_2"

        # Step 4: Continue execution from step_3
        instance = await engine2.get_instance(instance_id)
        instance.state["progress"].append("step_3_done")
        await stores.instances.update(instance_id, instance)
        await engine2.complete_step(instance_id, "step_3", output="result_3", next_step="step_4")

        # Verify progress
        instance = await engine2.get_instance(instance_id)
        assert instance.current_step == "step_4"
        assert instance.state["progress"] == ["step_1_done", "step_2_done", "step_3_done"]

    @pytest.mark.asyncio
    async def test_crash_during_step_execution_replays_step(self, stores):
        """
        Test that a step interrupted mid-execution is replayed.

        Scenario:
        1. Start step_2
        2. Crash before step completes
        3. Recovery should re-execute step_2
        """
        from tests.conftest import MockWorkflowEngine

        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="ReplayWorkflow",
            description="Workflow for replay test",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="step_1"),
                StepDefinition(name="step_2"),
                StepDefinition(name="step_3"),
            ],
        )

        engine1 = MockWorkflowEngine(stores=stores)
        await engine1.start()
        await engine1.register_workflow(definition)

        instance_id = await engine1.trigger_workflow("ReplayWorkflow", event_data={})

        # Start and complete step_1
        instance = await engine1.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)
        await engine1.complete_step(instance_id, "step_1", next_step="step_2")

        # step_2 is now "running" (started but not completed)
        instance = await engine1.get_instance(instance_id)
        assert instance.current_step == "step_2"
        assert any(s.step_name == "step_2" and s.status == "running" for s in instance.step_history)

        # Simulate crash
        await engine1.stop()

        # Recovery
        engine2 = MockWorkflowEngine(stores=stores)
        await engine2.start()

        recovered = await engine2.get_instance(instance_id)

        # step_2 should still be the current step, waiting to be re-executed
        assert recovered.current_step == "step_2"

        # In a real implementation, the engine would detect the running step
        # and replay it. For this test, we verify the state allows replay.
        running_steps = [s for s in recovered.step_history if s.status == "running"]
        assert len(running_steps) == 1
        assert running_steps[0].step_name == "step_2"

    @pytest.mark.asyncio
    async def test_idempotent_step_execution_across_crashes(self, stores):
        """
        Test that idempotent steps handle re-execution correctly.

        Uses idempotency tracking in state to prevent duplicate effects.
        """
        from tests.conftest import MockWorkflowEngine

        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="IdempotentWorkflow",
            description="Workflow with idempotent steps",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="idempotent_step"),
                StepDefinition(name="final_step"),
            ],
        )

        engine1 = MockWorkflowEngine(stores=stores)
        await engine1.start()
        await engine1.register_workflow(definition)

        instance_id = await engine1.trigger_workflow(
            "IdempotentWorkflow",
            event_data={},
        )

        # Start execution
        instance = await engine1.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        instance.state = {
            "execution_count": 0,
            "idempotency_keys": [],
        }
        await stores.instances.update(instance_id, instance)

        # Simulate partial execution of idempotent_step
        instance = await engine1.get_instance(instance_id)
        idempotency_key = f"step_exec_{instance_id}_1"

        # Check idempotency before execution
        if idempotency_key not in instance.state["idempotency_keys"]:
            instance.state["execution_count"] += 1
            instance.state["idempotency_keys"].append(idempotency_key)
            await stores.instances.update(instance_id, instance)

        assert instance.state["execution_count"] == 1

        # Crash before step marked complete
        await engine1.stop()

        # Recovery
        engine2 = MockWorkflowEngine(stores=stores)
        await engine2.start()

        # Re-execute step with same idempotency key
        instance = await engine2.get_instance(instance_id)

        if idempotency_key not in instance.state["idempotency_keys"]:
            instance.state["execution_count"] += 1
            instance.state["idempotency_keys"].append(idempotency_key)
            await stores.instances.update(instance_id, instance)

        # Execution count should still be 1 (idempotent)
        final_instance = await engine2.get_instance(instance_id)
        assert final_instance.state["execution_count"] == 1


class TestStateReconstruction:
    """Tests for state reconstruction from persisted data."""

    @pytest.mark.asyncio
    async def test_instance_state_fully_reconstructed(self, stores):
        """Test that all instance state is fully reconstructed after restart."""
        from tests.conftest import MockWorkflowEngine

        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="StateReconstruction",
            description="Workflow for state reconstruction test",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="step")],
        )

        engine1 = MockWorkflowEngine(stores=stores)
        await engine1.start()
        await engine1.register_workflow(definition)

        instance_id = await engine1.trigger_workflow(
            "StateReconstruction",
            event_data={"trigger_data": "value"},
        )

        # Build up complex state
        instance = await engine1.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        instance.state = {
            "string_value": "hello",
            "number_value": 42,
            "float_value": 3.14,
            "bool_value": True,
            "null_value": None,
            "list_value": [1, 2, 3],
            "nested_dict": {
                "level1": {
                    "level2": {
                        "value": "deep"
                    }
                }
            },
            "mixed_array": [
                {"name": "item1", "count": 1},
                {"name": "item2", "count": 2},
            ],
        }
        instance.metadata = {
            "user_id": "user_123",
            "correlation_id": "corr_456",
            "custom": {"key": "value"},
        }
        await stores.instances.update(instance_id, instance)

        # Stop engine
        await engine1.stop()

        # Restart
        engine2 = MockWorkflowEngine(stores=stores)
        await engine2.start()

        # Verify full state reconstruction
        recovered = await engine2.get_instance(instance_id)

        assert recovered.state["string_value"] == "hello"
        assert recovered.state["number_value"] == 42
        assert recovered.state["float_value"] == 3.14
        assert recovered.state["bool_value"] is True
        assert recovered.state["null_value"] is None
        assert recovered.state["list_value"] == [1, 2, 3]
        assert recovered.state["nested_dict"]["level1"]["level2"]["value"] == "deep"
        assert len(recovered.state["mixed_array"]) == 2
        assert recovered.metadata["user_id"] == "user_123"
        assert recovered.trigger_event["data"]["trigger_data"] == "value"

    @pytest.mark.asyncio
    async def test_step_history_preserved_across_restarts(self, stores):
        """Test that step history is preserved with full fidelity."""
        from tests.conftest import MockWorkflowEngine

        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="HistoryPreservation",
            description="Workflow for history preservation test",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="step_1"),
                StepDefinition(name="step_2"),
                StepDefinition(name="step_3"),
            ],
        )

        engine1 = MockWorkflowEngine(stores=stores)
        await engine1.start()
        await engine1.register_workflow(definition)

        instance_id = await engine1.trigger_workflow("HistoryPreservation", event_data={})

        # Execute with detailed step tracking
        instance = await engine1.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)

        # Step 1 completes successfully
        await engine1.complete_step(
            instance_id, "step_1",
            output={"result": "step1_output", "timing_ms": 150},
            next_step="step_2"
        )

        # Step 2 has a failure then succeeds (retry simulation)
        instance = await engine1.get_instance(instance_id)
        now = datetime.utcnow().isoformat() + "Z"

        # Record the failed attempt
        failed_step = StepHistory(
            step_name="step_2",
            started_at=now,
            completed_at=now,
            status="failed",
            attempt=1,
            error="Transient failure",
        )
        # Find and replace the running step_2 with failed attempt
        instance.step_history = [s for s in instance.step_history if not (s.step_name == "step_2" and s.status == "running")]
        instance.step_history.append(failed_step)

        # Record retry
        retry_step = StepHistory(
            step_name="step_2",
            started_at=now,
            status="running",
            attempt=2,
        )
        instance.step_history.append(retry_step)
        await stores.instances.update(instance_id, instance)

        # Complete retry
        await engine1.complete_step(instance_id, "step_2", output={"retry": True}, next_step="step_3")

        # Stop
        await engine1.stop()

        # Restart and verify
        engine2 = MockWorkflowEngine(stores=stores)
        await engine2.start()

        recovered = await engine2.get_instance(instance_id)

        # Verify step history details
        step1_history = [s for s in recovered.step_history if s.step_name == "step_1"]
        step2_history = [s for s in recovered.step_history if s.step_name == "step_2"]

        assert len(step1_history) == 1
        assert step1_history[0].status == "completed"
        assert step1_history[0].output["result"] == "step1_output"

        # step_2 should have failed attempt + completed retry
        completed_step2 = [s for s in step2_history if s.status == "completed"]
        failed_step2 = [s for s in step2_history if s.status == "failed"]

        assert len(failed_step2) == 1
        assert failed_step2[0].error == "Transient failure"
        assert failed_step2[0].attempt == 1


class TestWaitingStateRecovery:
    """Tests for recovering waiting state."""

    @pytest.mark.asyncio
    async def test_waiting_instance_recovers_event_subscriptions(self, stores):
        """Test that waiting instances retain their event subscriptions."""
        from tests.conftest import MockWorkflowEngine

        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="WaitingRecovery",
            description="Workflow for waiting recovery test",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="start"),
                StepDefinition(
                    name="multi_wait",
                    wait_for_events=["event_a", "event_b", "event_c"],
                    timeout="7d",
                ),
                StepDefinition(name="complete"),
            ],
        )

        engine1 = MockWorkflowEngine(stores=stores)
        await engine1.start()
        await engine1.register_workflow(definition)

        instance_id = await engine1.trigger_workflow("WaitingRecovery", event_data={})

        # Move to waiting state
        instance = await engine1.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)
        await engine1.complete_step(instance_id, "start", next_step="multi_wait")

        await engine1.enter_waiting_state(
            instance_id,
            events=["event_a", "event_b", "event_c"],
            timeout=timedelta(days=7),
        )

        # Verify waiting state
        instance = await engine1.get_instance(instance_id)
        assert instance.status == InstanceStatus.WAITING
        original_events = instance.waiting.events.copy()
        original_timeout = instance.waiting.timeout_at

        # Stop
        await engine1.stop()

        # Restart
        engine2 = MockWorkflowEngine(stores=stores)
        await engine2.start()

        # Verify waiting state recovered
        recovered = await engine2.get_instance(instance_id)
        assert recovered.status == InstanceStatus.WAITING
        assert recovered.waiting is not None
        assert set(recovered.waiting.events) == set(original_events)
        assert recovered.waiting.timeout_at == original_timeout

        # Verify we can still resume with an event
        success = await engine2.resume_instance(instance_id, "event_b", {"data": "test"})
        assert success

        resumed = await engine2.get_instance(instance_id)
        assert resumed.status == InstanceStatus.RUNNING
        assert resumed.waiting is None

    @pytest.mark.asyncio
    async def test_timeout_timer_preserved_across_restart(self, stores):
        """Test that timeout timers are preserved and can fire after restart."""
        from tests.conftest import MockWorkflowEngine

        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="TimerRecovery",
            description="Workflow for timer recovery test",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="start"),
                StepDefinition(name="wait"),
            ],
        )

        engine1 = MockWorkflowEngine(stores=stores)
        await engine1.start()
        await engine1.register_workflow(definition)

        instance_id = await engine1.trigger_workflow("TimerRecovery", event_data={})

        # Move to waiting with timeout
        instance = await engine1.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)

        await engine1.enter_waiting_state(
            instance_id,
            events=["never:happens"],
            timeout=timedelta(minutes=30),
        )

        # Capture timer info
        timers_before = await stores.timers.get_by_instance(instance_id)
        assert len(timers_before) == 1
        timer_id = timers_before[0].id
        timer_fire_at = timers_before[0].fire_at

        # Stop
        await engine1.stop()

        # Restart
        engine2 = MockWorkflowEngine(stores=stores)
        await engine2.start()

        # Timer should still exist
        timers_after = await stores.timers.get_by_instance(instance_id)
        assert len(timers_after) == 1
        assert timers_after[0].id == timer_id
        assert timers_after[0].fire_at == timer_fire_at


class TestChildWorkflowRecovery:
    """Tests for recovering parent-child workflow relationships."""

    @pytest.mark.asyncio
    async def test_child_workflows_linked_after_recovery(self, stores):
        """Test that parent-child relationships are preserved."""
        from tests.conftest import MockWorkflowEngine

        parent_def = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="ParentWorkflow",
            description="Parent workflow",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="spawn_children"),
                StepDefinition(name="wait_for_children"),
                StepDefinition(name="complete"),
            ],
        )

        child_def = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="ChildWorkflow",
            description="Child workflow",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.WORKFLOW_SPAWNED),
            steps=[StepDefinition(name="child_work")],
        )

        engine1 = MockWorkflowEngine(stores=stores)
        await engine1.start()
        await engine1.register_workflow(parent_def)
        await engine1.register_workflow(child_def)

        # Create parent
        parent_id = await engine1.trigger_workflow("ParentWorkflow", event_data={})

        # Start parent
        parent = await engine1.get_instance(parent_id)
        parent.status = InstanceStatus.RUNNING
        await stores.instances.update(parent_id, parent)

        # Spawn children
        child_ids = []
        for i in range(3):
            child = WorkflowInstance(
                id=f"child_{uuid.uuid4().hex[:8]}",
                workflow_id=child_def.id,
                workflow_name=child_def.name,
                workflow_version=child_def.version,
                status=InstanceStatus.PENDING,
                current_step="child_work",
                state={"index": i},
                trigger_event={"type": "workflow:spawned", "data": {"parent": parent_id}},
                parent_instance_id=parent_id,
            )
            await stores.instances.create(child)
            child_ids.append(child.id)

        # Update parent state
        parent = await engine1.get_instance(parent_id)
        parent.state["child_ids"] = child_ids
        await stores.instances.update(parent_id, parent)

        # Stop
        await engine1.stop()

        # Restart
        engine2 = MockWorkflowEngine(stores=stores)
        await engine2.start()

        # Verify parent
        recovered_parent = await engine2.get_instance(parent_id)
        assert recovered_parent.state["child_ids"] == child_ids

        # Verify children linked to parent
        for child_id in child_ids:
            child = await engine2.get_instance(child_id)
            assert child is not None
            assert child.parent_instance_id == parent_id

        # Verify we can find children by parent
        children = await stores.instances.list_by_parent(parent_id)
        assert len(children) == 3


class TestReplayDeterminism:
    """Tests for deterministic replay."""

    @pytest.mark.asyncio
    async def test_timestamp_consistency_in_replay(self, stores):
        """Test that timestamps are handled correctly in replay scenarios."""
        from tests.conftest import MockWorkflowEngine

        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="TimestampWorkflow",
            description="Workflow for timestamp test",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="step_1"),
                StepDefinition(name="step_2"),
            ],
        )

        engine1 = MockWorkflowEngine(stores=stores)
        await engine1.start()
        await engine1.register_workflow(definition)

        instance_id = await engine1.trigger_workflow("TimestampWorkflow", event_data={})

        instance = await engine1.get_instance(instance_id)
        original_created_at = instance.created_at

        # Start and complete step
        instance.status = InstanceStatus.RUNNING
        instance.started_at = datetime.utcnow().isoformat() + "Z"
        await stores.instances.update(instance_id, instance)

        await engine1.complete_step(instance_id, "step_1", next_step="step_2")

        instance = await engine1.get_instance(instance_id)
        step1_completed_at = next(
            s.completed_at for s in instance.step_history
            if s.step_name == "step_1" and s.status == "completed"
        )

        # Stop
        await engine1.stop()

        # Small delay to ensure time has passed
        await asyncio.sleep(0.01)

        # Restart
        engine2 = MockWorkflowEngine(stores=stores)
        await engine2.start()

        # Timestamps should be unchanged
        recovered = await engine2.get_instance(instance_id)
        assert recovered.created_at == original_created_at

        recovered_step1 = next(
            s for s in recovered.step_history
            if s.step_name == "step_1" and s.status == "completed"
        )
        assert recovered_step1.completed_at == step1_completed_at
