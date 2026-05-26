"""
Dead Letter Queue Integration Tests

Tests DLQ handling:
- Workflow fails after max retries
- Instance moved to DLQ
- Manual retry from DLQ
- DLQ stats accurate
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


class MockDeadLetterQueue:
    """Mock dead letter queue handler for testing DLQ operations."""

    def __init__(self, stores: InMemoryStores):
        self.stores = stores

    async def move_to_dlq(
        self,
        instance: WorkflowInstance,
        reason: str,
    ) -> str:
        """
        Move a failed instance to the dead letter queue.

        Args:
            instance: The failed instance
            reason: Why it was moved to DLQ

        Returns:
            DLQ entry ID
        """
        # Update instance status
        instance.status = InstanceStatus.DEAD_LETTERED
        instance.completed_at = datetime.utcnow().isoformat() + "Z"
        await self.stores.instances.update(instance.id, instance)

        # Create DLQ entry
        entry = DeadLetterEntry(
            id=f"dlq_{uuid.uuid4().hex[:8]}",
            instance=instance,
            reason=reason,
            retry_count=0,
        )
        entry_id = await self.stores.dead_letters.add(entry)

        return entry_id

    async def retry_from_dlq(
        self,
        entry_id: str,
        reset_state: bool = False,
    ) -> Optional[str]:
        """
        Retry a workflow from the dead letter queue.

        Args:
            entry_id: The DLQ entry ID
            reset_state: Whether to reset state to initial

        Returns:
            New instance ID if retry started, None if failed
        """
        entry = await self.stores.dead_letters.get(entry_id)
        if entry is None:
            return None

        old_instance = entry.instance

        # Create new instance for retry
        new_instance = WorkflowInstance(
            id=f"retry_{uuid.uuid4().hex[:8]}",
            workflow_id=old_instance.workflow_id,
            workflow_name=old_instance.workflow_name,
            workflow_version=old_instance.workflow_version,
            status=InstanceStatus.PENDING,
            current_step=old_instance.current_step,
            state={} if reset_state else old_instance.state.copy(),
            trigger_event=old_instance.trigger_event,
            metadata={
                "retried_from_dlq": True,
                "original_instance_id": old_instance.id,
                "dlq_entry_id": entry_id,
                "retry_count": entry.retry_count + 1,
            },
        )
        await self.stores.instances.create(new_instance)

        # Update DLQ entry
        await self.stores.dead_letters.update_retry_count(
            entry_id,
            entry.retry_count + 1,
            datetime.utcnow().isoformat() + "Z",
        )

        return new_instance.id

    async def get_stats(
        self, workflow_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Get DLQ statistics.

        Args:
            workflow_id: Optional filter by workflow

        Returns:
            Stats dictionary
        """
        if workflow_id:
            entries = await self.stores.dead_letters.list_by_workflow(workflow_id)
        else:
            entries = await self.stores.dead_letters.list_all()

        total = len(entries)
        never_retried = len([e for e in entries if e.retry_count == 0])
        retried_once = len([e for e in entries if e.retry_count == 1])
        retried_multiple = len([e for e in entries if e.retry_count > 1])

        # Group by reason
        by_reason: Dict[str, int] = {}
        for entry in entries:
            reason = entry.reason
            by_reason[reason] = by_reason.get(reason, 0) + 1

        return {
            "total": total,
            "never_retried": never_retried,
            "retried_once": retried_once,
            "retried_multiple": retried_multiple,
            "by_reason": by_reason,
        }

    async def purge_old_entries(
        self, older_than_days: int = 30
    ) -> int:
        """
        Purge old DLQ entries.

        Args:
            older_than_days: Delete entries older than this many days

        Returns:
            Number of entries purged
        """
        cutoff = datetime.utcnow() - timedelta(days=older_than_days)
        cutoff_str = cutoff.isoformat() + "Z"

        entries = await self.stores.dead_letters.list_all()
        purged = 0

        for entry in entries:
            if entry.failed_at < cutoff_str:
                await self.stores.dead_letters.remove(entry.id)
                purged += 1

        return purged


@pytest.fixture
def dlq_handler(stores: InMemoryStores) -> MockDeadLetterQueue:
    """Create a mock DLQ handler."""
    return MockDeadLetterQueue(stores)


class TestMoveToDeadLetter:
    """Tests for moving instances to dead letter queue."""

    @pytest.mark.asyncio
    async def test_failed_workflow_moved_to_dlq(self, stores, dlq_handler):
        """Test that a failed workflow is moved to DLQ."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="FailingWorkflow",
            description="Will fail",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(
                    name="flaky_step",
                    retry_max_attempts=3,
                ),
            ],
        )
        await stores.workflows.create(definition)

        now = datetime.utcnow().isoformat() + "Z"
        instance = WorkflowInstance(
            id=f"inst_{uuid.uuid4().hex[:8]}",
            workflow_id=definition.id,
            workflow_name=definition.name,
            workflow_version=definition.version,
            status=InstanceStatus.FAILED,
            current_step="flaky_step",
            state={"last_error": "Connection timeout"},
            trigger_event={"type": "manual"},
            error="Max retries exceeded after 3 attempts",
            step_history=[
                StepHistory(step_name="flaky_step", started_at=now, completed_at=now,
                           status="failed", attempt=1, error="Timeout 1"),
                StepHistory(step_name="flaky_step", started_at=now, completed_at=now,
                           status="failed", attempt=2, error="Timeout 2"),
                StepHistory(step_name="flaky_step", started_at=now, completed_at=now,
                           status="failed", attempt=3, error="Timeout 3"),
            ],
        )
        await stores.instances.create(instance)

        # Move to DLQ
        entry_id = await dlq_handler.move_to_dlq(
            instance,
            reason="Max retries exceeded",
        )

        # Verify entry created
        entry = await stores.dead_letters.get(entry_id)
        assert entry is not None
        assert entry.reason == "Max retries exceeded"
        assert entry.instance.id == instance.id

        # Verify instance status updated
        updated = await stores.instances.get(instance.id)
        assert updated.status == InstanceStatus.DEAD_LETTERED

    @pytest.mark.asyncio
    async def test_dlq_preserves_full_instance_state(self, stores, dlq_handler):
        """Test that DLQ preserves the complete instance state."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="StateWorkflow",
            description="With state",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="step")],
        )
        await stores.workflows.create(definition)

        now = datetime.utcnow().isoformat() + "Z"
        instance = WorkflowInstance(
            id=f"inst_{uuid.uuid4().hex[:8]}",
            workflow_id=definition.id,
            workflow_name=definition.name,
            workflow_version=definition.version,
            status=InstanceStatus.FAILED,
            current_step="step",
            state={
                "accumulated_data": [1, 2, 3],
                "processed_items": {"a": True, "b": False},
                "metadata": {"user_id": "u123"},
            },
            trigger_event={"type": "manual", "data": {"input": "value"}},
            error="Some error",
            started_at=now,
            step_history=[
                StepHistory(step_name="step", started_at=now, completed_at=now,
                           status="failed", error="Error details"),
            ],
        )
        await stores.instances.create(instance)

        entry_id = await dlq_handler.move_to_dlq(instance, "Test failure")

        entry = await stores.dead_letters.get(entry_id)

        # Verify full state preserved
        assert entry.instance.state["accumulated_data"] == [1, 2, 3]
        assert entry.instance.state["processed_items"]["a"] is True
        assert entry.instance.trigger_event["data"]["input"] == "value"
        assert entry.instance.started_at == now
        assert len(entry.instance.step_history) == 1


class TestRetryFromDeadLetter:
    """Tests for retrying from dead letter queue."""

    @pytest.mark.asyncio
    async def test_retry_creates_new_instance(self, stores, dlq_handler):
        """Test that retrying creates a new instance."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="RetryWorkflow",
            description="Can retry",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="step")],
        )
        await stores.workflows.create(definition)

        now = datetime.utcnow().isoformat() + "Z"
        instance = WorkflowInstance(
            id=f"original_{uuid.uuid4().hex[:8]}",
            workflow_id=definition.id,
            workflow_name=definition.name,
            workflow_version=definition.version,
            status=InstanceStatus.FAILED,
            current_step="step",
            state={"value": 42},
            trigger_event={"type": "manual"},
            error="Failed",
        )
        await stores.instances.create(instance)

        entry_id = await dlq_handler.move_to_dlq(instance, "Test")

        # Retry
        new_instance_id = await dlq_handler.retry_from_dlq(entry_id)

        assert new_instance_id is not None
        assert new_instance_id != instance.id

        # Verify new instance
        new_instance = await stores.instances.get(new_instance_id)
        assert new_instance.status == InstanceStatus.PENDING
        assert new_instance.state["value"] == 42  # State preserved
        assert new_instance.metadata["retried_from_dlq"] is True
        assert new_instance.metadata["original_instance_id"] == instance.id

    @pytest.mark.asyncio
    async def test_retry_increments_counter(self, stores, dlq_handler):
        """Test that retry increments the retry counter."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="CounterWorkflow",
            description="Count retries",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="step")],
        )
        await stores.workflows.create(definition)

        instance = WorkflowInstance(
            id=f"inst_{uuid.uuid4().hex[:8]}",
            workflow_id=definition.id,
            workflow_name=definition.name,
            workflow_version=definition.version,
            status=InstanceStatus.FAILED,
            current_step="step",
            state={},
            trigger_event={"type": "manual"},
            error="Failed",
        )
        await stores.instances.create(instance)

        entry_id = await dlq_handler.move_to_dlq(instance, "Test")

        # Initial retry count is 0
        entry = await stores.dead_letters.get(entry_id)
        assert entry.retry_count == 0

        # First retry
        await dlq_handler.retry_from_dlq(entry_id)
        entry = await stores.dead_letters.get(entry_id)
        assert entry.retry_count == 1

        # Second retry
        await dlq_handler.retry_from_dlq(entry_id)
        entry = await stores.dead_letters.get(entry_id)
        assert entry.retry_count == 2

    @pytest.mark.asyncio
    async def test_retry_with_reset_state(self, stores, dlq_handler):
        """Test retrying with state reset."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="ResetWorkflow",
            description="Reset state",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="step")],
        )
        await stores.workflows.create(definition)

        instance = WorkflowInstance(
            id=f"inst_{uuid.uuid4().hex[:8]}",
            workflow_id=definition.id,
            workflow_name=definition.name,
            workflow_version=definition.version,
            status=InstanceStatus.FAILED,
            current_step="step",
            state={"corrupted": True, "bad_data": "xyz"},
            trigger_event={"type": "manual"},
            error="State corruption",
        )
        await stores.instances.create(instance)

        entry_id = await dlq_handler.move_to_dlq(instance, "Corrupted")

        # Retry with state reset
        new_instance_id = await dlq_handler.retry_from_dlq(entry_id, reset_state=True)

        new_instance = await stores.instances.get(new_instance_id)
        assert new_instance.state == {}  # State reset
        assert new_instance.trigger_event == instance.trigger_event  # Trigger preserved

    @pytest.mark.asyncio
    async def test_retry_nonexistent_entry_fails(self, dlq_handler):
        """Test that retrying non-existent entry returns None."""
        result = await dlq_handler.retry_from_dlq("nonexistent_entry_id")
        assert result is None


class TestDeadLetterStats:
    """Tests for DLQ statistics."""

    @pytest.mark.asyncio
    async def test_stats_total_count(self, stores, dlq_handler):
        """Test total count in stats."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="StatsWorkflow",
            description="For stats",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="step")],
        )
        await stores.workflows.create(definition)

        # Add multiple entries
        for i in range(5):
            instance = WorkflowInstance(
                id=f"inst_{i}_{uuid.uuid4().hex[:8]}",
                workflow_id=definition.id,
                workflow_name=definition.name,
                workflow_version=definition.version,
                status=InstanceStatus.FAILED,
                current_step="step",
                state={},
                trigger_event={"type": "manual"},
                error=f"Error {i}",
            )
            await stores.instances.create(instance)
            await dlq_handler.move_to_dlq(instance, "Test failure")

        stats = await dlq_handler.get_stats()

        assert stats["total"] == 5
        assert stats["never_retried"] == 5

    @pytest.mark.asyncio
    async def test_stats_by_retry_count(self, stores, dlq_handler):
        """Test stats breakdown by retry count."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="RetryStatsWorkflow",
            description="Retry stats",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="step")],
        )
        await stores.workflows.create(definition)

        # Create entries with different retry counts
        entry_ids = []
        for i in range(4):
            instance = WorkflowInstance(
                id=f"inst_{i}_{uuid.uuid4().hex[:8]}",
                workflow_id=definition.id,
                workflow_name=definition.name,
                workflow_version=definition.version,
                status=InstanceStatus.FAILED,
                current_step="step",
                state={},
                trigger_event={"type": "manual"},
                error=f"Error {i}",
            )
            await stores.instances.create(instance)
            entry_id = await dlq_handler.move_to_dlq(instance, "Test")
            entry_ids.append(entry_id)

        # Retry some entries
        await dlq_handler.retry_from_dlq(entry_ids[1])  # 1 retry
        await dlq_handler.retry_from_dlq(entry_ids[2])  # 1 retry
        await dlq_handler.retry_from_dlq(entry_ids[2])  # 2 retries
        await dlq_handler.retry_from_dlq(entry_ids[3])  # 1 retry
        await dlq_handler.retry_from_dlq(entry_ids[3])  # 2 retries
        await dlq_handler.retry_from_dlq(entry_ids[3])  # 3 retries

        stats = await dlq_handler.get_stats()

        assert stats["total"] == 4
        assert stats["never_retried"] == 1  # entry_ids[0]
        assert stats["retried_once"] == 1   # entry_ids[1]
        assert stats["retried_multiple"] == 2  # entry_ids[2] and [3]

    @pytest.mark.asyncio
    async def test_stats_by_reason(self, stores, dlq_handler):
        """Test stats grouped by failure reason."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="ReasonStatsWorkflow",
            description="Reason stats",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="step")],
        )
        await stores.workflows.create(definition)

        # Add entries with different reasons
        reasons = [
            "Max retries exceeded",
            "Max retries exceeded",
            "Max retries exceeded",
            "NonRetryableError: Invalid input",
            "NonRetryableError: Invalid input",
            "Connection timeout",
        ]

        for i, reason in enumerate(reasons):
            instance = WorkflowInstance(
                id=f"inst_{i}_{uuid.uuid4().hex[:8]}",
                workflow_id=definition.id,
                workflow_name=definition.name,
                workflow_version=definition.version,
                status=InstanceStatus.FAILED,
                current_step="step",
                state={},
                trigger_event={"type": "manual"},
                error=reason,
            )
            await stores.instances.create(instance)
            await dlq_handler.move_to_dlq(instance, reason)

        stats = await dlq_handler.get_stats()

        assert stats["by_reason"]["Max retries exceeded"] == 3
        assert stats["by_reason"]["NonRetryableError: Invalid input"] == 2
        assert stats["by_reason"]["Connection timeout"] == 1

    @pytest.mark.asyncio
    async def test_stats_filtered_by_workflow(self, stores, dlq_handler):
        """Test stats filtered by workflow."""
        wf_a = WorkflowDefinition(
            id=f"wf_a_{uuid.uuid4().hex[:8]}",
            name="WorkflowA",
            description="A",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="step")],
        )
        wf_b = WorkflowDefinition(
            id=f"wf_b_{uuid.uuid4().hex[:8]}",
            name="WorkflowB",
            description="B",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="step")],
        )
        await stores.workflows.create(wf_a)
        await stores.workflows.create(wf_b)

        # Add 3 entries for workflow A
        for i in range(3):
            instance = WorkflowInstance(
                id=f"inst_a_{i}_{uuid.uuid4().hex[:8]}",
                workflow_id=wf_a.id,
                workflow_name=wf_a.name,
                workflow_version=wf_a.version,
                status=InstanceStatus.FAILED,
                current_step="step",
                state={},
                trigger_event={"type": "manual"},
                error="Error",
            )
            await stores.instances.create(instance)
            await dlq_handler.move_to_dlq(instance, "A failure")

        # Add 2 entries for workflow B
        for i in range(2):
            instance = WorkflowInstance(
                id=f"inst_b_{i}_{uuid.uuid4().hex[:8]}",
                workflow_id=wf_b.id,
                workflow_name=wf_b.name,
                workflow_version=wf_b.version,
                status=InstanceStatus.FAILED,
                current_step="step",
                state={},
                trigger_event={"type": "manual"},
                error="Error",
            )
            await stores.instances.create(instance)
            await dlq_handler.move_to_dlq(instance, "B failure")

        # Total stats
        all_stats = await dlq_handler.get_stats()
        assert all_stats["total"] == 5

        # Filtered stats
        a_stats = await dlq_handler.get_stats(workflow_id=wf_a.id)
        assert a_stats["total"] == 3

        b_stats = await dlq_handler.get_stats(workflow_id=wf_b.id)
        assert b_stats["total"] == 2


class TestDeadLetterMaintenance:
    """Tests for DLQ maintenance operations."""

    @pytest.mark.asyncio
    async def test_purge_old_entries(self, stores, dlq_handler):
        """Test purging old DLQ entries."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="PurgeWorkflow",
            description="For purge",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="step")],
        )
        await stores.workflows.create(definition)

        # Create entries with different ages
        old_time = (datetime.utcnow() - timedelta(days=60)).isoformat() + "Z"
        recent_time = datetime.utcnow().isoformat() + "Z"

        # Old entry
        old_instance = WorkflowInstance(
            id=f"old_inst_{uuid.uuid4().hex[:8]}",
            workflow_id=definition.id,
            workflow_name=definition.name,
            workflow_version=definition.version,
            status=InstanceStatus.FAILED,
            current_step="step",
            state={},
            trigger_event={"type": "manual"},
            error="Old error",
        )
        await stores.instances.create(old_instance)

        old_entry = DeadLetterEntry(
            id=f"old_dlq_{uuid.uuid4().hex[:8]}",
            instance=old_instance,
            reason="Old failure",
            failed_at=old_time,
        )
        await stores.dead_letters.add(old_entry)

        # Recent entry
        recent_instance = WorkflowInstance(
            id=f"recent_inst_{uuid.uuid4().hex[:8]}",
            workflow_id=definition.id,
            workflow_name=definition.name,
            workflow_version=definition.version,
            status=InstanceStatus.FAILED,
            current_step="step",
            state={},
            trigger_event={"type": "manual"},
            error="Recent error",
        )
        await stores.instances.create(recent_instance)

        recent_entry = DeadLetterEntry(
            id=f"recent_dlq_{uuid.uuid4().hex[:8]}",
            instance=recent_instance,
            reason="Recent failure",
            failed_at=recent_time,
        )
        await stores.dead_letters.add(recent_entry)

        # Verify both exist
        all_entries = await stores.dead_letters.list_all()
        assert len(all_entries) == 2

        # Purge entries older than 30 days
        purged = await dlq_handler.purge_old_entries(older_than_days=30)

        assert purged == 1

        # Only recent entry should remain
        remaining = await stores.dead_letters.list_all()
        assert len(remaining) == 1
        assert remaining[0].id == recent_entry.id

    @pytest.mark.asyncio
    async def test_remove_dlq_entry(self, stores, dlq_handler):
        """Test removing a DLQ entry."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="RemoveWorkflow",
            description="Remove entry",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="step")],
        )
        await stores.workflows.create(definition)

        instance = WorkflowInstance(
            id=f"inst_{uuid.uuid4().hex[:8]}",
            workflow_id=definition.id,
            workflow_name=definition.name,
            workflow_version=definition.version,
            status=InstanceStatus.FAILED,
            current_step="step",
            state={},
            trigger_event={"type": "manual"},
            error="Error",
        )
        await stores.instances.create(instance)

        entry_id = await dlq_handler.move_to_dlq(instance, "Test")

        # Verify exists
        entry = await stores.dead_letters.get(entry_id)
        assert entry is not None

        # Remove
        await stores.dead_letters.remove(entry_id)

        # Verify removed
        removed = await stores.dead_letters.get(entry_id)
        assert removed is None
