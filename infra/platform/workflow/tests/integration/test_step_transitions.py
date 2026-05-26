"""
Step Transitions Integration Tests

Tests all step transition types:
- `return self.next_step()` - normal transition
- `return self.complete()` - workflow completion
- `return self.wait_for_event()` - enter waiting state
- `return [self.process(item) for item in items]` - parallel fork
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


class TestNormalTransitions:
    """Tests for normal step-to-step transitions."""

    @pytest.mark.asyncio
    async def test_transition_to_next_step(self, mock_engine, stores):
        """Test basic transition from one step to the next."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="TransitionWorkflow",
            description="Basic transition test",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="step_a"),
                StepDefinition(name="step_b"),
                StepDefinition(name="step_c"),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("TransitionWorkflow", event_data={})

        # Start running
        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)

        # Transition: step_a -> step_b
        await mock_engine.complete_step(instance_id, "step_a", output="a_done", next_step="step_b")

        instance = await mock_engine.get_instance(instance_id)
        assert instance.current_step == "step_b"
        assert instance.status == InstanceStatus.RUNNING

        # Transition: step_b -> step_c
        await mock_engine.complete_step(instance_id, "step_b", output="b_done", next_step="step_c")

        instance = await mock_engine.get_instance(instance_id)
        assert instance.current_step == "step_c"
        assert instance.status == InstanceStatus.RUNNING

    @pytest.mark.asyncio
    async def test_transition_preserves_state(self, mock_engine, stores):
        """Test that state is preserved across transitions."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="StateWorkflow",
            description="State preservation test",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="init"),
                StepDefinition(name="process"),
                StepDefinition(name="finalize"),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("StateWorkflow", event_data={})

        # Initialize state in init step
        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        instance.state = {"counter": 0, "items": []}
        await stores.instances.update(instance_id, instance)

        # Modify state in init
        instance = await mock_engine.get_instance(instance_id)
        instance.state["counter"] = 1
        instance.state["items"].append("item_1")
        await stores.instances.update(instance_id, instance)
        await mock_engine.complete_step(instance_id, "init", next_step="process")

        # Verify state persisted to process
        instance = await mock_engine.get_instance(instance_id)
        assert instance.state["counter"] == 1
        assert instance.state["items"] == ["item_1"]

        # Modify state in process
        instance.state["counter"] = 2
        instance.state["items"].append("item_2")
        await stores.instances.update(instance_id, instance)
        await mock_engine.complete_step(instance_id, "process", next_step="finalize")

        # Verify state persisted to finalize
        instance = await mock_engine.get_instance(instance_id)
        assert instance.state["counter"] == 2
        assert instance.state["items"] == ["item_1", "item_2"]

    @pytest.mark.asyncio
    async def test_transition_records_step_output(self, mock_engine, stores):
        """Test that step outputs are recorded in history."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="OutputWorkflow",
            description="Output recording test",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="compute"),
                StepDefinition(name="save"),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("OutputWorkflow", event_data={})

        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)

        # Complete with complex output
        await mock_engine.complete_step(
            instance_id, "compute",
            output={
                "result": 42,
                "details": {"computation": "complex", "duration_ms": 150}
            },
            next_step="save"
        )

        # Verify output recorded
        instance = await mock_engine.get_instance(instance_id)
        compute_step = next(
            s for s in instance.step_history
            if s.step_name == "compute" and s.status == "completed"
        )
        assert compute_step.output["result"] == 42
        assert compute_step.output["details"]["computation"] == "complex"


class TestWorkflowCompletion:
    """Tests for workflow completion transitions."""

    @pytest.mark.asyncio
    async def test_complete_workflow_from_final_step(self, mock_engine, stores):
        """Test that workflow completes when final step completes without next_step."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="CompletionWorkflow",
            description="Workflow completion test",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="work"),
                StepDefinition(name="finalize"),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("CompletionWorkflow", event_data={})

        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)

        # Complete work step
        await mock_engine.complete_step(instance_id, "work", next_step="finalize")

        # Complete finalize with no next_step (workflow completion)
        await mock_engine.complete_step(instance_id, "finalize", output="done")

        # Verify workflow completed
        instance = await mock_engine.get_instance(instance_id)
        assert instance.status == InstanceStatus.COMPLETED
        assert instance.current_step is None
        assert instance.completed_at is not None

    @pytest.mark.asyncio
    async def test_completed_workflow_has_all_steps_recorded(self, mock_engine, stores):
        """Test that completed workflow has all steps in history."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="FullHistoryWorkflow",
            description="Full history test",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="step_1"),
                StepDefinition(name="step_2"),
                StepDefinition(name="step_3"),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("FullHistoryWorkflow", event_data={})

        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)

        await mock_engine.complete_step(instance_id, "step_1", next_step="step_2")
        await mock_engine.complete_step(instance_id, "step_2", next_step="step_3")
        await mock_engine.complete_step(instance_id, "step_3")

        # Verify all steps recorded
        instance = await mock_engine.get_instance(instance_id)
        completed_steps = [s.step_name for s in instance.step_history if s.status == "completed"]
        assert completed_steps == ["step_1", "step_2", "step_3"]

    @pytest.mark.asyncio
    async def test_single_step_workflow_completion(self, mock_engine, stores):
        """Test that single-step workflow completes correctly."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="SingleStepWorkflow",
            description="Single step workflow",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="only_step")],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("SingleStepWorkflow", event_data={})

        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)

        # Complete only step
        await mock_engine.complete_step(instance_id, "only_step", output="single_done")

        instance = await mock_engine.get_instance(instance_id)
        assert instance.status == InstanceStatus.COMPLETED


class TestWaitingTransitions:
    """Tests for transitions to waiting state."""

    @pytest.mark.asyncio
    async def test_transition_to_waiting_for_single_event(self, mock_engine, stores):
        """Test transition to waiting for a single event type."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="WaitSingleEvent",
            description="Wait for single event",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="prepare"),
                StepDefinition(name="wait"),
                StepDefinition(name="continue"),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("WaitSingleEvent", event_data={})

        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)

        await mock_engine.complete_step(instance_id, "prepare", next_step="wait")

        # Enter waiting state
        await mock_engine.enter_waiting_state(instance_id, events=["approval:complete"])

        # Verify waiting state
        instance = await mock_engine.get_instance(instance_id)
        assert instance.status == InstanceStatus.WAITING
        assert instance.waiting is not None
        assert "approval:complete" in instance.waiting.events

    @pytest.mark.asyncio
    async def test_transition_to_waiting_for_multiple_events(self, mock_engine, stores):
        """Test transition to waiting for multiple event types (first one wins)."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="WaitMultipleEvents",
            description="Wait for multiple events",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="prepare"),
                StepDefinition(name="wait"),
                StepDefinition(name="continue"),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("WaitMultipleEvents", event_data={})

        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)

        await mock_engine.complete_step(instance_id, "prepare", next_step="wait")

        # Enter waiting for multiple events
        await mock_engine.enter_waiting_state(
            instance_id,
            events=["approval:granted", "approval:denied", "approval:timeout"]
        )

        instance = await mock_engine.get_instance(instance_id)
        assert instance.status == InstanceStatus.WAITING
        assert len(instance.waiting.events) == 3

    @pytest.mark.asyncio
    async def test_waiting_state_with_timeout(self, mock_engine, stores):
        """Test waiting state with timeout configured."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="WaitWithTimeout",
            description="Wait with timeout",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="prepare"),
                StepDefinition(name="wait"),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("WaitWithTimeout", event_data={})

        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)

        await mock_engine.complete_step(instance_id, "prepare", next_step="wait")

        # Enter waiting with timeout
        timeout = timedelta(hours=24)
        await mock_engine.enter_waiting_state(
            instance_id,
            events=["response:received"],
            timeout=timeout
        )

        # Verify timeout configured
        instance = await mock_engine.get_instance(instance_id)
        assert instance.waiting.timeout_at is not None

        # Verify timer created
        timers = await stores.timers.get_by_instance(instance_id)
        assert len(timers) == 1
        assert timers[0].event_type == "timeout"

    @pytest.mark.asyncio
    async def test_resume_from_waiting_with_event(self, mock_engine, stores):
        """Test resuming from waiting state when event arrives."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="ResumeWorkflow",
            description="Resume from waiting",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="prepare"),
                StepDefinition(name="wait"),
                StepDefinition(name="complete"),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("ResumeWorkflow", event_data={})

        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)

        await mock_engine.complete_step(instance_id, "prepare", next_step="wait")
        await mock_engine.enter_waiting_state(instance_id, events=["data:ready"])

        # Resume with event
        success = await mock_engine.resume_instance(
            instance_id,
            "data:ready",
            {"value": 42}
        )

        assert success

        instance = await mock_engine.get_instance(instance_id)
        assert instance.status == InstanceStatus.RUNNING
        assert instance.waiting is None
        assert instance.state["last_event"]["type"] == "data:ready"

    @pytest.mark.asyncio
    async def test_resume_ignores_non_matching_events(self, mock_engine, stores):
        """Test that non-matching events don't resume waiting instances."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="FilteredResumeWorkflow",
            description="Filtered resume test",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="wait"),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("FilteredResumeWorkflow", event_data={})

        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)

        await mock_engine.enter_waiting_state(instance_id, events=["specific:event"])

        # Try to resume with wrong event
        success = await mock_engine.resume_instance(
            instance_id,
            "wrong:event",
            {}
        )

        assert not success

        # Instance should still be waiting
        instance = await mock_engine.get_instance(instance_id)
        assert instance.status == InstanceStatus.WAITING


class TestParallelFork:
    """Tests for parallel fork transitions."""

    @pytest.mark.asyncio
    async def test_parallel_fork_creates_child_work_items(self, mock_engine, stores):
        """Test that parallel fork creates work items for each input."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="ParallelForkWorkflow",
            description="Parallel fork test",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="prepare_items"),
                StepDefinition(name="process_parallel", parallel_max_concurrency=5),
                StepDefinition(name="aggregate"),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("ParallelForkWorkflow", event_data={})

        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        instance.state = {"items_to_process": ["A", "B", "C", "D", "E"]}
        await stores.instances.update(instance_id, instance)

        await mock_engine.complete_step(instance_id, "prepare_items", next_step="process_parallel")

        # Simulate parallel fork by tracking work items in state
        instance = await mock_engine.get_instance(instance_id)
        instance.state["parallel_work"] = {
            "items": instance.state["items_to_process"],
            "results": {},
            "pending": instance.state["items_to_process"].copy(),
            "completed": [],
        }
        await stores.instances.update(instance_id, instance)

        # Verify parallel work items tracked
        instance = await mock_engine.get_instance(instance_id)
        assert len(instance.state["parallel_work"]["items"]) == 5
        assert len(instance.state["parallel_work"]["pending"]) == 5

    @pytest.mark.asyncio
    async def test_parallel_results_collected(self, mock_engine, stores):
        """Test that parallel execution results are collected."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="ParallelCollect",
            description="Parallel results collection",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="parallel_work", parallel_max_concurrency=3),
                StepDefinition(name="collect"),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("ParallelCollect", event_data={})

        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        instance.state = {
            "parallel_work": {
                "items": ["X", "Y", "Z"],
                "results": {},
                "pending": ["X", "Y", "Z"],
                "completed": [],
            }
        }
        await stores.instances.update(instance_id, instance)

        # Simulate parallel completion
        for item in ["X", "Y", "Z"]:
            instance = await mock_engine.get_instance(instance_id)
            instance.state["parallel_work"]["results"][item] = f"processed_{item}"
            instance.state["parallel_work"]["pending"].remove(item)
            instance.state["parallel_work"]["completed"].append(item)
            await stores.instances.update(instance_id, instance)

        # All parallel work complete, move to collect
        await mock_engine.complete_step(instance_id, "parallel_work", next_step="collect")

        instance = await mock_engine.get_instance(instance_id)
        assert instance.current_step == "collect"
        assert len(instance.state["parallel_work"]["results"]) == 3
        assert instance.state["parallel_work"]["results"]["X"] == "processed_X"


class TestConditionalTransitions:
    """Tests for conditional step transitions."""

    @pytest.mark.asyncio
    async def test_conditional_branch_based_on_output(self, mock_engine, stores):
        """Test conditional branching based on step output."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="ConditionalWorkflow",
            description="Conditional branching test",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="check_condition"),
                StepDefinition(name="path_a"),
                StepDefinition(name="path_b"),
                StepDefinition(name="merge"),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        # Test path A
        instance_id_a = await mock_engine.trigger_workflow(
            "ConditionalWorkflow",
            event_data={"condition": True}
        )

        instance = await mock_engine.get_instance(instance_id_a)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id_a, instance)

        # Condition true -> path_a
        await mock_engine.complete_step(instance_id_a, "check_condition", next_step="path_a")

        instance = await mock_engine.get_instance(instance_id_a)
        assert instance.current_step == "path_a"

        # Test path B
        instance_id_b = await mock_engine.trigger_workflow(
            "ConditionalWorkflow",
            event_data={"condition": False}
        )

        instance = await mock_engine.get_instance(instance_id_b)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id_b, instance)

        # Condition false -> path_b
        await mock_engine.complete_step(instance_id_b, "check_condition", next_step="path_b")

        instance = await mock_engine.get_instance(instance_id_b)
        assert instance.current_step == "path_b"

    @pytest.mark.asyncio
    async def test_conditional_early_completion(self, mock_engine, stores):
        """Test conditional early workflow completion."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="EarlyComplete",
            description="Early completion test",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="validate"),
                StepDefinition(name="process"),
                StepDefinition(name="complete"),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow(
            "EarlyComplete",
            event_data={"skip_processing": True}
        )

        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)

        # Validation fails, complete early (skip remaining steps)
        await mock_engine.complete_step(
            instance_id, "validate",
            output={"valid": False, "reason": "Skipping"}
        )

        # Verify workflow completed without running process step
        instance = await mock_engine.get_instance(instance_id)
        assert instance.status == InstanceStatus.COMPLETED
        executed_steps = [s.step_name for s in instance.step_history if s.status == "completed"]
        assert "validate" in executed_steps
        assert "process" not in executed_steps


class TestErrorTransitions:
    """Tests for error transitions."""

    @pytest.mark.asyncio
    async def test_step_failure_transitions_to_failed(self, mock_engine, stores):
        """Test that step failure transitions workflow to FAILED."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="FailureWorkflow",
            description="Failure transition test",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="step_1"),
                StepDefinition(name="step_2"),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("FailureWorkflow", event_data={})

        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        await stores.instances.update(instance_id, instance)

        # Fail step_1
        await mock_engine.fail_step(instance_id, "step_1", "Critical error occurred")

        # Verify failure state
        instance = await mock_engine.get_instance(instance_id)
        assert instance.status == InstanceStatus.FAILED
        assert instance.error == "Critical error occurred"

        # Verify step recorded as failed
        failed_step = next(
            s for s in instance.step_history
            if s.step_name == "step_1" and s.status == "failed"
        )
        assert failed_step.error == "Critical error occurred"
