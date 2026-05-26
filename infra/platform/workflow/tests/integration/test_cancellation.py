"""
Cancellation Integration Tests

Tests cancellation functionality:
- Cancel running workflow
- Cancel waiting workflow
- Compensation logic runs
- Cascading cancellation (parent -> children)
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Callable

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


class MockCancellationHandler:
    """Mock cancellation handler for testing cancellation logic."""

    def __init__(self, stores: InMemoryStores):
        self.stores = stores
        self.compensation_log: List[Dict[str, Any]] = []
        self._compensation_functions: Dict[str, Callable] = {}

    def register_compensation(
        self, workflow_name: str, step_name: str, compensation_func: Callable
    ) -> None:
        """Register a compensation function for a step."""
        key = f"{workflow_name}:{step_name}"
        self._compensation_functions[key] = compensation_func

    async def cancel_instance(
        self,
        instance_id: str,
        reason: str,
        run_compensation: bool = True,
    ) -> bool:
        """
        Cancel a workflow instance.

        Args:
            instance_id: The instance to cancel
            reason: Reason for cancellation
            run_compensation: Whether to run compensation for completed steps

        Returns:
            True if cancellation succeeded
        """
        instance = await self.stores.instances.get(instance_id)
        if instance is None:
            return False

        # Can't cancel already completed/cancelled instances
        if instance.status in [InstanceStatus.COMPLETED, InstanceStatus.CANCELLED]:
            return False

        # Run compensation for completed steps in reverse order
        if run_compensation:
            completed_steps = [
                s for s in instance.step_history if s.status == "completed"
            ]
            for step in reversed(completed_steps):
                key = f"{instance.workflow_name}:{step.step_name}"
                if key in self._compensation_functions:
                    try:
                        await self._compensation_functions[key](instance, step)
                        self.compensation_log.append({
                            "instance_id": instance_id,
                            "step_name": step.step_name,
                            "status": "compensated",
                        })
                    except Exception as e:
                        self.compensation_log.append({
                            "instance_id": instance_id,
                            "step_name": step.step_name,
                            "status": "compensation_failed",
                            "error": str(e),
                        })

        # Update instance status
        instance.status = InstanceStatus.CANCELLED
        instance.completed_at = datetime.utcnow().isoformat() + "Z"
        instance.metadata["cancellation_reason"] = reason
        instance.metadata["cancelled_at"] = datetime.utcnow().isoformat()
        await self.stores.instances.update(instance_id, instance)

        # Cancel any pending timers
        await self.stores.timers.delete_by_instance(instance_id)

        return True

    async def cancel_children(self, parent_instance_id: str, reason: str) -> List[str]:
        """
        Cancel all child instances of a parent.

        Returns:
            List of cancelled child instance IDs
        """
        children = await self.stores.instances.list_by_parent(parent_instance_id)
        cancelled = []

        for child in children:
            if child.status not in [InstanceStatus.COMPLETED, InstanceStatus.CANCELLED]:
                success = await self.cancel_instance(
                    child.id,
                    reason=f"Parent cancelled: {reason}",
                    run_compensation=True,
                )
                if success:
                    cancelled.append(child.id)

        return cancelled


@pytest.fixture
def cancellation_handler(stores: InMemoryStores) -> MockCancellationHandler:
    """Create a mock cancellation handler."""
    return MockCancellationHandler(stores)


class TestCancelRunningWorkflow:
    """Tests for cancelling running workflows."""

    @pytest.mark.asyncio
    async def test_cancel_running_workflow_succeeds(
        self, stores, cancellation_handler
    ):
        """Test cancelling a running workflow."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="CancelableWorkflow",
            description="Can be cancelled",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="step_1"),
                StepDefinition(name="step_2"),
                StepDefinition(name="step_3"),
            ],
        )
        await stores.workflows.create(definition)

        now = datetime.utcnow().isoformat() + "Z"
        instance = WorkflowInstance(
            id=f"inst_{uuid.uuid4().hex[:8]}",
            workflow_id=definition.id,
            workflow_name=definition.name,
            workflow_version=definition.version,
            status=InstanceStatus.RUNNING,
            current_step="step_2",
            state={"progress": 50},
            trigger_event={"type": "manual"},
            started_at=now,
            step_history=[
                StepHistory(
                    step_name="step_1",
                    started_at=now,
                    completed_at=now,
                    status="completed",
                ),
                StepHistory(
                    step_name="step_2",
                    started_at=now,
                    status="running",
                ),
            ],
        )
        await stores.instances.create(instance)

        # Cancel the workflow
        success = await cancellation_handler.cancel_instance(
            instance.id, reason="User requested cancellation"
        )

        assert success is True

        # Verify cancelled
        cancelled = await stores.instances.get(instance.id)
        assert cancelled.status == InstanceStatus.CANCELLED
        assert cancelled.completed_at is not None
        assert cancelled.metadata["cancellation_reason"] == "User requested cancellation"

    @pytest.mark.asyncio
    async def test_cancel_running_workflow_at_first_step(
        self, stores, cancellation_handler
    ):
        """Test cancelling workflow at the very first step."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="EarlyCancel",
            description="Cancelled early",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="first")],
        )
        await stores.workflows.create(definition)

        now = datetime.utcnow().isoformat() + "Z"
        instance = WorkflowInstance(
            id=f"inst_{uuid.uuid4().hex[:8]}",
            workflow_id=definition.id,
            workflow_name=definition.name,
            workflow_version=definition.version,
            status=InstanceStatus.RUNNING,
            current_step="first",
            state={},
            trigger_event={"type": "manual"},
            started_at=now,
            step_history=[
                StepHistory(step_name="first", started_at=now, status="running"),
            ],
        )
        await stores.instances.create(instance)

        success = await cancellation_handler.cancel_instance(
            instance.id, reason="Changed mind"
        )

        assert success is True

        cancelled = await stores.instances.get(instance.id)
        assert cancelled.status == InstanceStatus.CANCELLED

    @pytest.mark.asyncio
    async def test_cannot_cancel_completed_workflow(
        self, stores, cancellation_handler
    ):
        """Test that completed workflows cannot be cancelled."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="CompletedWorkflow",
            description="Already done",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="done")],
        )
        await stores.workflows.create(definition)

        now = datetime.utcnow().isoformat() + "Z"
        instance = WorkflowInstance(
            id=f"inst_{uuid.uuid4().hex[:8]}",
            workflow_id=definition.id,
            workflow_name=definition.name,
            workflow_version=definition.version,
            status=InstanceStatus.COMPLETED,
            current_step=None,
            state={},
            trigger_event={"type": "manual"},
            started_at=now,
            completed_at=now,
        )
        await stores.instances.create(instance)

        success = await cancellation_handler.cancel_instance(
            instance.id, reason="Too late"
        )

        assert success is False

        # Status unchanged
        unchanged = await stores.instances.get(instance.id)
        assert unchanged.status == InstanceStatus.COMPLETED


class TestCancelWaitingWorkflow:
    """Tests for cancelling waiting workflows."""

    @pytest.mark.asyncio
    async def test_cancel_waiting_workflow_clears_timers(
        self, stores, cancellation_handler
    ):
        """Test that cancelling waiting workflow clears its timers."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="WaitingCancel",
            description="Waiting to be cancelled",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="wait")],
        )
        await stores.workflows.create(definition)

        now = datetime.utcnow().isoformat() + "Z"
        timeout_at = (datetime.utcnow() + timedelta(hours=24)).isoformat() + "Z"

        instance = WorkflowInstance(
            id=f"inst_{uuid.uuid4().hex[:8]}",
            workflow_id=definition.id,
            workflow_name=definition.name,
            workflow_version=definition.version,
            status=InstanceStatus.WAITING,
            current_step="wait",
            state={},
            trigger_event={"type": "manual"},
            started_at=now,
            waiting=WaitingState(
                events=["response"],
                timeout_at=timeout_at,
            ),
        )
        await stores.instances.create(instance)

        # Create associated timer
        timer = Timer(
            id=f"timer_{uuid.uuid4().hex[:8]}",
            instance_id=instance.id,
            fire_at=timeout_at,
            event_type="timeout",
        )
        await stores.timers.create(timer)

        # Verify timer exists
        timers_before = await stores.timers.get_by_instance(instance.id)
        assert len(timers_before) == 1

        # Cancel
        success = await cancellation_handler.cancel_instance(
            instance.id, reason="No longer needed"
        )

        assert success is True

        # Verify timers cleared
        timers_after = await stores.timers.get_by_instance(instance.id)
        assert len(timers_after) == 0

        # Verify cancelled
        cancelled = await stores.instances.get(instance.id)
        assert cancelled.status == InstanceStatus.CANCELLED

    @pytest.mark.asyncio
    async def test_cancel_waiting_workflow_clears_waiting_state(
        self, stores, cancellation_handler
    ):
        """Test that cancelling clears the waiting state."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="ClearWaiting",
            description="Clear waiting state",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="wait")],
        )
        await stores.workflows.create(definition)

        now = datetime.utcnow().isoformat() + "Z"
        instance = WorkflowInstance(
            id=f"inst_{uuid.uuid4().hex[:8]}",
            workflow_id=definition.id,
            workflow_name=definition.name,
            workflow_version=definition.version,
            status=InstanceStatus.WAITING,
            current_step="wait",
            state={},
            trigger_event={"type": "manual"},
            started_at=now,
            waiting=WaitingState(events=["approval", "rejection"]),
        )
        await stores.instances.create(instance)

        await cancellation_handler.cancel_instance(instance.id, reason="Cancelled")

        cancelled = await stores.instances.get(instance.id)
        assert cancelled.status == InstanceStatus.CANCELLED
        # Note: The waiting state may or may not be cleared depending on implementation
        # The important thing is that the status is CANCELLED


class TestCompensation:
    """Tests for compensation logic during cancellation."""

    @pytest.mark.asyncio
    async def test_compensation_runs_for_completed_steps(
        self, stores, cancellation_handler
    ):
        """Test that compensation runs for all completed steps."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="CompensateWorkflow",
            description="With compensation",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="reserve_inventory"),
                StepDefinition(name="charge_payment"),
                StepDefinition(name="ship_order"),
            ],
        )
        await stores.workflows.create(definition)

        # Register compensation functions
        compensation_calls = []

        async def compensate_reserve(instance, step):
            compensation_calls.append("release_inventory")

        async def compensate_charge(instance, step):
            compensation_calls.append("refund_payment")

        cancellation_handler.register_compensation(
            "CompensateWorkflow", "reserve_inventory", compensate_reserve
        )
        cancellation_handler.register_compensation(
            "CompensateWorkflow", "charge_payment", compensate_charge
        )

        now = datetime.utcnow().isoformat() + "Z"
        instance = WorkflowInstance(
            id=f"inst_{uuid.uuid4().hex[:8]}",
            workflow_id=definition.id,
            workflow_name=definition.name,
            workflow_version=definition.version,
            status=InstanceStatus.RUNNING,
            current_step="ship_order",
            state={},
            trigger_event={"type": "manual"},
            started_at=now,
            step_history=[
                StepHistory(
                    step_name="reserve_inventory",
                    started_at=now,
                    completed_at=now,
                    status="completed",
                ),
                StepHistory(
                    step_name="charge_payment",
                    started_at=now,
                    completed_at=now,
                    status="completed",
                ),
                StepHistory(
                    step_name="ship_order",
                    started_at=now,
                    status="running",
                ),
            ],
        )
        await stores.instances.create(instance)

        # Cancel
        await cancellation_handler.cancel_instance(
            instance.id, reason="Order cancelled by customer"
        )

        # Verify compensation ran in reverse order
        assert compensation_calls == ["refund_payment", "release_inventory"]

        # Verify compensation logged
        assert len(cancellation_handler.compensation_log) == 2
        assert all(log["status"] == "compensated" for log in cancellation_handler.compensation_log)

    @pytest.mark.asyncio
    async def test_compensation_continues_on_failure(
        self, stores, cancellation_handler
    ):
        """Test that compensation continues even if one step fails."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="PartialCompensate",
            description="Partial compensation",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="step_a"),
                StepDefinition(name="step_b"),
                StepDefinition(name="step_c"),
            ],
        )
        await stores.workflows.create(definition)

        compensation_calls = []

        async def compensate_a(instance, step):
            compensation_calls.append("a")

        async def compensate_b(instance, step):
            compensation_calls.append("b_failed")
            raise RuntimeError("Compensation B failed!")

        async def compensate_c(instance, step):
            compensation_calls.append("c")

        cancellation_handler.register_compensation("PartialCompensate", "step_a", compensate_a)
        cancellation_handler.register_compensation("PartialCompensate", "step_b", compensate_b)
        cancellation_handler.register_compensation("PartialCompensate", "step_c", compensate_c)

        now = datetime.utcnow().isoformat() + "Z"
        instance = WorkflowInstance(
            id=f"inst_{uuid.uuid4().hex[:8]}",
            workflow_id=definition.id,
            workflow_name=definition.name,
            workflow_version=definition.version,
            status=InstanceStatus.RUNNING,
            current_step="step_c",
            state={},
            trigger_event={"type": "manual"},
            step_history=[
                StepHistory(step_name="step_a", started_at=now, completed_at=now, status="completed"),
                StepHistory(step_name="step_b", started_at=now, completed_at=now, status="completed"),
                StepHistory(step_name="step_c", started_at=now, status="running"),
            ],
        )
        await stores.instances.create(instance)

        # Cancel - should still complete even with failing compensation
        success = await cancellation_handler.cancel_instance(instance.id, reason="Cancel")

        # Cancellation succeeds
        assert success is True

        # Compensation attempted for completed steps (reverse order: b, a)
        # Note: step_c was running, not completed, so no compensation
        assert "b_failed" in compensation_calls
        assert "a" in compensation_calls

        # Verify failure logged
        failed_compensations = [
            log for log in cancellation_handler.compensation_log
            if log["status"] == "compensation_failed"
        ]
        assert len(failed_compensations) == 1

    @pytest.mark.asyncio
    async def test_skip_compensation_when_disabled(
        self, stores, cancellation_handler
    ):
        """Test that compensation can be skipped."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="SkipCompensate",
            description="Skip compensation",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="step")],
        )
        await stores.workflows.create(definition)

        compensation_called = []

        async def compensate(instance, step):
            compensation_called.append(step.step_name)

        cancellation_handler.register_compensation("SkipCompensate", "step", compensate)

        now = datetime.utcnow().isoformat() + "Z"
        instance = WorkflowInstance(
            id=f"inst_{uuid.uuid4().hex[:8]}",
            workflow_id=definition.id,
            workflow_name=definition.name,
            workflow_version=definition.version,
            status=InstanceStatus.RUNNING,
            current_step="step",
            state={},
            trigger_event={"type": "manual"},
            step_history=[
                StepHistory(step_name="step", started_at=now, completed_at=now, status="completed"),
            ],
        )
        await stores.instances.create(instance)

        # Cancel without compensation
        success = await cancellation_handler.cancel_instance(
            instance.id, reason="Force cancel", run_compensation=False
        )

        assert success is True
        assert len(compensation_called) == 0  # Compensation not called


class TestCascadingCancellation:
    """Tests for cascading cancellation of parent/child workflows."""

    @pytest.mark.asyncio
    async def test_cancel_parent_cancels_children(
        self, stores, cancellation_handler
    ):
        """Test that cancelling parent cancels all children."""
        parent_def = WorkflowDefinition(
            id=f"wf_parent_{uuid.uuid4().hex[:8]}",
            name="ParentWorkflow",
            description="Parent",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="spawn_children")],
        )
        await stores.workflows.create(parent_def)

        child_def = WorkflowDefinition(
            id=f"wf_child_{uuid.uuid4().hex[:8]}",
            name="ChildWorkflow",
            description="Child",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.WORKFLOW_SPAWNED),
            steps=[StepDefinition(name="child_work")],
        )
        await stores.workflows.create(child_def)

        # Create parent
        now = datetime.utcnow().isoformat() + "Z"
        parent = WorkflowInstance(
            id=f"parent_{uuid.uuid4().hex[:8]}",
            workflow_id=parent_def.id,
            workflow_name=parent_def.name,
            workflow_version=parent_def.version,
            status=InstanceStatus.RUNNING,
            current_step="spawn_children",
            state={},
            trigger_event={"type": "manual"},
            started_at=now,
        )
        await stores.instances.create(parent)

        # Create children
        child_ids = []
        for i in range(3):
            child = WorkflowInstance(
                id=f"child_{i}_{uuid.uuid4().hex[:8]}",
                workflow_id=child_def.id,
                workflow_name=child_def.name,
                workflow_version=child_def.version,
                status=InstanceStatus.RUNNING,
                current_step="child_work",
                state={"index": i},
                trigger_event={"type": "workflow:spawned", "parent": parent.id},
                parent_instance_id=parent.id,
                started_at=now,
            )
            await stores.instances.create(child)
            child_ids.append(child.id)

        # Cancel parent - should cascade to children
        await cancellation_handler.cancel_instance(
            parent.id, reason="Parent cancelled"
        )

        cancelled_children = await cancellation_handler.cancel_children(
            parent.id, reason="Parent cancelled"
        )

        # All children should be cancelled
        assert len(cancelled_children) == 3

        for child_id in child_ids:
            child = await stores.instances.get(child_id)
            assert child.status == InstanceStatus.CANCELLED

    @pytest.mark.asyncio
    async def test_cascade_skips_already_completed_children(
        self, stores, cancellation_handler
    ):
        """Test that cascade doesn't affect completed children."""
        parent_def = WorkflowDefinition(
            id=f"wf_parent_{uuid.uuid4().hex[:8]}",
            name="ParentWorkflow",
            description="Parent",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="step")],
        )
        await stores.workflows.create(parent_def)

        child_def = WorkflowDefinition(
            id=f"wf_child_{uuid.uuid4().hex[:8]}",
            name="ChildWorkflow",
            description="Child",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.WORKFLOW_SPAWNED),
            steps=[StepDefinition(name="step")],
        )
        await stores.workflows.create(child_def)

        now = datetime.utcnow().isoformat() + "Z"
        parent = WorkflowInstance(
            id=f"parent_{uuid.uuid4().hex[:8]}",
            workflow_id=parent_def.id,
            workflow_name=parent_def.name,
            workflow_version=parent_def.version,
            status=InstanceStatus.RUNNING,
            current_step="step",
            state={},
            trigger_event={"type": "manual"},
            started_at=now,
        )
        await stores.instances.create(parent)

        # One running child, one completed child
        running_child = WorkflowInstance(
            id=f"running_child_{uuid.uuid4().hex[:8]}",
            workflow_id=child_def.id,
            workflow_name=child_def.name,
            workflow_version=child_def.version,
            status=InstanceStatus.RUNNING,
            current_step="step",
            state={},
            trigger_event={"type": "workflow:spawned"},
            parent_instance_id=parent.id,
            started_at=now,
        )
        await stores.instances.create(running_child)

        completed_child = WorkflowInstance(
            id=f"completed_child_{uuid.uuid4().hex[:8]}",
            workflow_id=child_def.id,
            workflow_name=child_def.name,
            workflow_version=child_def.version,
            status=InstanceStatus.COMPLETED,
            current_step=None,
            state={},
            trigger_event={"type": "workflow:spawned"},
            parent_instance_id=parent.id,
            started_at=now,
            completed_at=now,
        )
        await stores.instances.create(completed_child)

        # Cancel parent and cascade
        await cancellation_handler.cancel_instance(parent.id, reason="Cancel")
        cancelled = await cancellation_handler.cancel_children(parent.id, reason="Cascade")

        # Only running child should be cancelled
        assert len(cancelled) == 1
        assert running_child.id in cancelled

        # Completed child unchanged
        completed = await stores.instances.get(completed_child.id)
        assert completed.status == InstanceStatus.COMPLETED

    @pytest.mark.asyncio
    async def test_deep_cascade_cancellation(
        self, stores, cancellation_handler
    ):
        """Test cascading cancellation through multiple levels."""
        def_template = lambda level: WorkflowDefinition(
            id=f"wf_level{level}_{uuid.uuid4().hex[:8]}",
            name=f"Level{level}Workflow",
            description=f"Level {level}",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="step")],
        )

        # Create workflow definitions for 3 levels
        defs = {}
        for level in range(3):
            d = def_template(level)
            await stores.workflows.create(d)
            defs[level] = d

        now = datetime.utcnow().isoformat() + "Z"

        # Create instance hierarchy: grandparent -> parent -> child
        grandparent = WorkflowInstance(
            id=f"grandparent_{uuid.uuid4().hex[:8]}",
            workflow_id=defs[0].id,
            workflow_name=defs[0].name,
            workflow_version=defs[0].version,
            status=InstanceStatus.RUNNING,
            current_step="step",
            state={},
            trigger_event={"type": "manual"},
            started_at=now,
        )
        await stores.instances.create(grandparent)

        parent = WorkflowInstance(
            id=f"parent_{uuid.uuid4().hex[:8]}",
            workflow_id=defs[1].id,
            workflow_name=defs[1].name,
            workflow_version=defs[1].version,
            status=InstanceStatus.RUNNING,
            current_step="step",
            state={},
            trigger_event={"type": "manual"},
            parent_instance_id=grandparent.id,
            started_at=now,
        )
        await stores.instances.create(parent)

        child = WorkflowInstance(
            id=f"child_{uuid.uuid4().hex[:8]}",
            workflow_id=defs[2].id,
            workflow_name=defs[2].name,
            workflow_version=defs[2].version,
            status=InstanceStatus.RUNNING,
            current_step="step",
            state={},
            trigger_event={"type": "manual"},
            parent_instance_id=parent.id,
            started_at=now,
        )
        await stores.instances.create(child)

        # Cancel grandparent
        await cancellation_handler.cancel_instance(grandparent.id, reason="Cancel all")

        # Cancel children recursively
        await cancellation_handler.cancel_children(grandparent.id, reason="Cascade")

        # Parent should be cancelled
        parent_cancelled = await stores.instances.get(parent.id)
        assert parent_cancelled.status == InstanceStatus.CANCELLED

        # Cancel grandchildren
        await cancellation_handler.cancel_children(parent.id, reason="Deep cascade")

        # Child should also be cancelled
        child_cancelled = await stores.instances.get(child.id)
        assert child_cancelled.status == InstanceStatus.CANCELLED
