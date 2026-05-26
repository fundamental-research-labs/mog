"""
Engine Lifecycle Integration Tests

Tests the full workflow engine lifecycle:
- Start engine, register workflows
- Fire events, verify instances created
- Stop engine gracefully
- Restart and verify pending instances resume
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


class TestEngineStartup:
    """Tests for engine startup behavior."""

    @pytest.mark.asyncio
    async def test_engine_starts_successfully(
        self, mock_engine, simple_workflow_definition
    ):
        """Test that engine starts and accepts workflow registrations."""
        # Start engine
        await mock_engine.start()
        assert mock_engine.running is True

        # Register workflow
        workflow_id = await mock_engine.register_workflow(simple_workflow_definition)
        assert workflow_id is not None

        # Verify workflow is registered
        stored = await mock_engine.stores.workflows.get(workflow_id)
        assert stored is not None
        assert stored.name == simple_workflow_definition.name

    @pytest.mark.asyncio
    async def test_register_multiple_workflows(self, mock_engine, id_generator):
        """Test registering multiple workflows."""
        await mock_engine.start()

        workflows = []
        for i in range(5):
            definition = WorkflowDefinition(
                id=f"wf_{id_generator()}",
                name=f"Workflow_{i}",
                description=f"Test workflow {i}",
                version="1.0.0",
                trigger=TriggerConfig(type=TriggerType.MANUAL),
                steps=[StepDefinition(name="step_1")],
            )
            workflows.append(definition)
            await mock_engine.register_workflow(definition)

        # Verify all registered
        all_workflows = await mock_engine.stores.workflows.list_all()
        assert len(all_workflows) == 5

    @pytest.mark.asyncio
    async def test_engine_rejects_duplicate_workflow_version(
        self, mock_engine, simple_workflow_definition
    ):
        """Test that duplicate workflow name+version is rejected."""
        await mock_engine.start()
        await mock_engine.register_workflow(simple_workflow_definition)

        # Try to register same workflow again
        with pytest.raises(ValueError, match="already exists"):
            await mock_engine.register_workflow(simple_workflow_definition)


class TestEngineTriggers:
    """Tests for engine triggering workflows."""

    @pytest.mark.asyncio
    async def test_manual_trigger_creates_instance(
        self, mock_engine, simple_workflow_definition
    ):
        """Test that manual trigger creates a workflow instance."""
        await mock_engine.start()
        await mock_engine.register_workflow(simple_workflow_definition)

        # Trigger workflow
        instance_id = await mock_engine.trigger_workflow(
            simple_workflow_definition.name,
            event_data={"input": "test"},
        )

        # Verify instance created
        instance = await mock_engine.get_instance(instance_id)
        assert instance is not None
        assert instance.status == InstanceStatus.PENDING
        assert instance.workflow_name == simple_workflow_definition.name
        assert instance.trigger_event["data"]["input"] == "test"

    @pytest.mark.asyncio
    async def test_idempotent_triggers(self, mock_engine, simple_workflow_definition):
        """Test that idempotent triggers don't create duplicate instances."""
        await mock_engine.start()
        await mock_engine.register_workflow(simple_workflow_definition)

        idempotency_key = f"key_{uuid.uuid4().hex[:8]}"

        # First trigger
        instance_id_1 = await mock_engine.trigger_workflow(
            simple_workflow_definition.name,
            event_data={"input": "test"},
            idempotency_key=idempotency_key,
        )

        # Second trigger with same key
        instance_id_2 = await mock_engine.trigger_workflow(
            simple_workflow_definition.name,
            event_data={"input": "different"},
            idempotency_key=idempotency_key,
        )

        # Should return same instance
        assert instance_id_1 == instance_id_2

        # Only one instance should exist
        all_instances = await mock_engine.stores.instances.list_all()
        assert len(all_instances) == 1

    @pytest.mark.asyncio
    async def test_multiple_triggers_create_multiple_instances(
        self, mock_engine, simple_workflow_definition
    ):
        """Test that multiple triggers create separate instances."""
        await mock_engine.start()
        await mock_engine.register_workflow(simple_workflow_definition)

        instance_ids = []
        for i in range(10):
            instance_id = await mock_engine.trigger_workflow(
                simple_workflow_definition.name,
                event_data={"index": i},
            )
            instance_ids.append(instance_id)

        # All IDs should be unique
        assert len(set(instance_ids)) == 10

        # All instances should exist
        all_instances = await mock_engine.stores.instances.list_all()
        assert len(all_instances) == 10

    @pytest.mark.asyncio
    async def test_trigger_nonexistent_workflow_raises(self, mock_engine):
        """Test that triggering a non-existent workflow raises an error."""
        await mock_engine.start()

        with pytest.raises(ValueError, match="Workflow not found"):
            await mock_engine.trigger_workflow(
                "NonExistentWorkflow",
                event_data={},
            )


class TestEngineShutdown:
    """Tests for engine shutdown behavior."""

    @pytest.mark.asyncio
    async def test_engine_stops_gracefully(
        self, mock_engine, simple_workflow_definition
    ):
        """Test that engine stops gracefully."""
        await mock_engine.start()
        await mock_engine.register_workflow(simple_workflow_definition)

        # Create some instances
        for i in range(3):
            await mock_engine.trigger_workflow(
                simple_workflow_definition.name,
                event_data={"index": i},
            )

        # Stop engine
        await mock_engine.stop()
        assert mock_engine.running is False

        # Data should still be accessible
        all_instances = await mock_engine.stores.instances.list_all()
        assert len(all_instances) == 3

    @pytest.mark.asyncio
    async def test_pending_instances_preserved_on_shutdown(
        self, mock_engine, simple_workflow_definition
    ):
        """Test that pending instances are preserved when engine stops."""
        await mock_engine.start()
        await mock_engine.register_workflow(simple_workflow_definition)

        # Create instances
        instance_ids = []
        for i in range(5):
            instance_id = await mock_engine.trigger_workflow(
                simple_workflow_definition.name,
                event_data={"index": i},
            )
            instance_ids.append(instance_id)

        # Stop engine
        await mock_engine.stop()

        # All instances should still be pending
        for instance_id in instance_ids:
            instance = await mock_engine.stores.instances.get(instance_id)
            assert instance is not None
            assert instance.status == InstanceStatus.PENDING


class TestEngineRecovery:
    """Tests for engine recovery after restart."""

    @pytest.mark.asyncio
    async def test_engine_resumes_pending_instances(self, stores):
        """Test that engine can resume pending instances after restart."""
        # Create first engine and start workflow
        from tests.conftest import MockWorkflowEngine

        engine1 = MockWorkflowEngine(stores=stores)
        await engine1.start()

        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="ResumableWorkflow",
            description="Workflow that can be resumed",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="step_1"),
                StepDefinition(name="step_2"),
                StepDefinition(name="step_3"),
            ],
        )
        await engine1.register_workflow(definition)

        instance_id = await engine1.trigger_workflow(
            "ResumableWorkflow",
            event_data={"value": 123},
        )

        # Complete first step
        instance = await engine1.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)
        await engine1.complete_step(instance_id, "step_1", output="step1_done", next_step="step_2")

        # Simulate crash by stopping engine
        await engine1.stop()

        # Create new engine with same stores (simulating restart)
        engine2 = MockWorkflowEngine(stores=stores)
        await engine2.start()

        # Re-register workflow (in real engine, this would be automatic)
        engine2._registered_workflows["ResumableWorkflow"] = definition

        # Instance should still exist with step_1 completed
        recovered_instance = await engine2.get_instance(instance_id)
        assert recovered_instance is not None
        assert recovered_instance.current_step == "step_2"
        assert len(recovered_instance.step_history) == 2  # step_1 completed, step_2 started

        # Verify step_1 is completed
        step_1_history = next(
            (s for s in recovered_instance.step_history if s.step_name == "step_1"),
            None,
        )
        assert step_1_history is not None
        assert step_1_history.status == "completed"

    @pytest.mark.asyncio
    async def test_waiting_instances_preserved_across_restart(self, stores):
        """Test that waiting instances are preserved across restart."""
        from tests.conftest import MockWorkflowEngine

        engine1 = MockWorkflowEngine(stores=stores)
        await engine1.start()

        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="WaitingWorkflow",
            description="Workflow that waits",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="start"),
                StepDefinition(name="wait"),
                StepDefinition(name="complete"),
            ],
        )
        await engine1.register_workflow(definition)

        instance_id = await engine1.trigger_workflow(
            "WaitingWorkflow",
            event_data={},
        )

        # Move to running and then waiting state
        instance = await engine1.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)

        await engine1.complete_step(instance_id, "start", next_step="wait")
        await engine1.enter_waiting_state(
            instance_id,
            events=["approval:granted"],
            timeout=timedelta(days=7),
        )

        # Stop engine
        await engine1.stop()

        # Create new engine
        engine2 = MockWorkflowEngine(stores=stores)
        await engine2.start()

        # Instance should still be waiting
        recovered = await engine2.get_instance(instance_id)
        assert recovered is not None
        assert recovered.status == InstanceStatus.WAITING
        assert recovered.waiting is not None
        assert "approval:granted" in recovered.waiting.events

    @pytest.mark.asyncio
    async def test_timers_preserved_across_restart(self, stores):
        """Test that timers are preserved across restart."""
        from tests.conftest import MockWorkflowEngine

        engine1 = MockWorkflowEngine(stores=stores)
        await engine1.start()

        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="TimerWorkflow",
            description="Workflow with timer",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="start"),
                StepDefinition(name="wait"),
            ],
        )
        await engine1.register_workflow(definition)

        instance_id = await engine1.trigger_workflow(
            "TimerWorkflow",
            event_data={},
        )

        # Set up waiting with timeout
        instance = await engine1.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)

        await engine1.enter_waiting_state(
            instance_id,
            events=["never:happens"],
            timeout=timedelta(hours=1),
        )

        # Verify timer was created
        timers_before = await stores.timers.get_by_instance(instance_id)
        assert len(timers_before) == 1

        # Stop engine
        await engine1.stop()

        # Create new engine
        engine2 = MockWorkflowEngine(stores=stores)
        await engine2.start()

        # Timer should still exist
        timers_after = await stores.timers.get_by_instance(instance_id)
        assert len(timers_after) == 1
        assert timers_after[0].id == timers_before[0].id


class TestEngineInstanceState:
    """Tests for instance state management through lifecycle."""

    @pytest.mark.asyncio
    async def test_instance_state_persisted_between_steps(
        self, mock_engine, multi_step_workflow_definition
    ):
        """Test that instance state is persisted between steps."""
        await mock_engine.start()
        await mock_engine.register_workflow(multi_step_workflow_definition)

        instance_id = await mock_engine.trigger_workflow(
            multi_step_workflow_definition.name,
            event_data={"initial": "data"},
        )

        # Update state during step execution
        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        instance.state["accumulated"] = []
        await mock_engine.stores.instances.update(instance_id, instance)

        # Complete steps, accumulating state
        for i in range(1, 5):
            instance = await mock_engine.get_instance(instance_id)
            instance.state["accumulated"].append(f"step_{i}")
            await mock_engine.stores.instances.update(instance_id, instance)
            await mock_engine.complete_step(
                instance_id,
                f"step_{i}",
                output=f"output_{i}",
                next_step=f"step_{i+1}" if i < 5 else None,
            )

        # Complete final step
        instance = await mock_engine.get_instance(instance_id)
        instance.state["accumulated"].append("step_5")
        await mock_engine.stores.instances.update(instance_id, instance)
        await mock_engine.complete_step(instance_id, "step_5", output="final")

        # Verify final state
        final_instance = await mock_engine.get_instance(instance_id)
        assert final_instance.status == InstanceStatus.COMPLETED
        assert final_instance.state["accumulated"] == [
            "step_1", "step_2", "step_3", "step_4", "step_5"
        ]

    @pytest.mark.asyncio
    async def test_step_history_preserved(
        self, mock_engine, multi_step_workflow_definition
    ):
        """Test that step history is preserved throughout execution."""
        await mock_engine.start()
        await mock_engine.register_workflow(multi_step_workflow_definition)

        instance_id = await mock_engine.trigger_workflow(
            multi_step_workflow_definition.name,
            event_data={},
        )

        # Run through steps
        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await mock_engine.stores.instances.update(instance_id, instance)

        for i in range(1, 6):
            next_step = f"step_{i+1}" if i < 5 else None
            await mock_engine.complete_step(
                instance_id, f"step_{i}", output={"step": i}, next_step=next_step
            )

        # Verify history
        final_instance = await mock_engine.get_instance(instance_id)
        completed_steps = [
            s for s in final_instance.step_history if s.status == "completed"
        ]
        assert len(completed_steps) == 5

        for i, step in enumerate(completed_steps, 1):
            assert step.step_name == f"step_{i}"
            assert step.output == {"step": i}


class TestEngineConcurrency:
    """Tests for concurrent operations."""

    @pytest.mark.asyncio
    async def test_concurrent_triggers(self, mock_engine, simple_workflow_definition):
        """Test concurrent workflow triggers."""
        await mock_engine.start()
        await mock_engine.register_workflow(simple_workflow_definition)

        # Trigger workflows concurrently
        async def trigger_one(index: int) -> str:
            return await mock_engine.trigger_workflow(
                simple_workflow_definition.name,
                event_data={"index": index},
            )

        tasks = [trigger_one(i) for i in range(20)]
        instance_ids = await asyncio.gather(*tasks)

        # All should succeed
        assert len(instance_ids) == 20
        assert len(set(instance_ids)) == 20  # All unique

        # All instances should exist
        for instance_id in instance_ids:
            instance = await mock_engine.get_instance(instance_id)
            assert instance is not None

    @pytest.mark.asyncio
    async def test_concurrent_workflow_registrations(self, stores):
        """Test that workflow registrations are thread-safe."""
        from tests.conftest import MockWorkflowEngine

        engine = MockWorkflowEngine(stores=stores)
        await engine.start()

        async def register_workflow(index: int) -> str:
            definition = WorkflowDefinition(
                id=f"wf_{uuid.uuid4().hex[:8]}",
                name=f"ConcurrentWorkflow_{index}",
                description=f"Concurrent workflow {index}",
                version="1.0.0",
                trigger=TriggerConfig(type=TriggerType.MANUAL),
                steps=[StepDefinition(name="step_1")],
            )
            return await engine.register_workflow(definition)

        tasks = [register_workflow(i) for i in range(10)]
        workflow_ids = await asyncio.gather(*tasks)

        # All should succeed
        assert len(workflow_ids) == 10
        assert len(set(workflow_ids)) == 10  # All unique
