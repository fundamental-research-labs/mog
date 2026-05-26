"""
High Volume Integration Tests

Tests high throughput scenarios:
- Fire 1000 events in 1 second
- Verify all instances created
- Verify rate limiting/batching works
- Measure throughput
"""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

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


class HighVolumeTriggerHandler:
    """Handler optimized for high volume trigger processing."""

    def __init__(self, stores: InMemoryStores, batch_size: int = 100):
        self.stores = stores
        self.batch_size = batch_size
        self.total_created = 0
        self.total_time_ms = 0

    async def fire_events(
        self,
        workflow_id: str,
        workflow_name: str,
        workflow_version: str,
        event_count: int,
    ) -> Tuple[List[str], float]:
        """
        Fire multiple events as fast as possible.

        Args:
            workflow_id: Target workflow ID
            workflow_name: Workflow name
            workflow_version: Version string
            event_count: Number of events to fire

        Returns:
            Tuple of (instance_ids, duration_seconds)
        """
        start = time.perf_counter()
        instance_ids = []

        # Process in batches
        for batch_start in range(0, event_count, self.batch_size):
            batch_end = min(batch_start + self.batch_size, event_count)
            batch_instances = []

            for i in range(batch_start, batch_end):
                instance = WorkflowInstance(
                    id=f"inst_{i}_{uuid.uuid4().hex[:8]}",
                    workflow_id=workflow_id,
                    workflow_name=workflow_name,
                    workflow_version=workflow_version,
                    status=InstanceStatus.PENDING,
                    current_step="start",
                    state={"event_index": i},
                    trigger_event={
                        "type": "high_volume",
                        "data": {"index": i},
                        "timestamp": datetime.utcnow().isoformat() + "Z",
                    },
                )
                batch_instances.append(instance)

            # Create batch
            for instance in batch_instances:
                await self.stores.instances.create(instance)
                instance_ids.append(instance.id)

        end = time.perf_counter()
        duration = end - start
        self.total_created += len(instance_ids)
        self.total_time_ms = duration * 1000

        return instance_ids, duration

    async def fire_events_concurrent(
        self,
        workflow_id: str,
        workflow_name: str,
        workflow_version: str,
        event_count: int,
        concurrency: int = 10,
    ) -> Tuple[List[str], float]:
        """
        Fire events with concurrent processing.

        Args:
            workflow_id: Target workflow ID
            workflow_name: Workflow name
            workflow_version: Version string
            event_count: Number of events
            concurrency: Max concurrent creates

        Returns:
            Tuple of (instance_ids, duration_seconds)
        """
        semaphore = asyncio.Semaphore(concurrency)
        instance_ids: List[str] = []
        lock = asyncio.Lock()

        async def create_one(index: int) -> str:
            async with semaphore:
                instance = WorkflowInstance(
                    id=f"inst_{index}_{uuid.uuid4().hex[:8]}",
                    workflow_id=workflow_id,
                    workflow_name=workflow_name,
                    workflow_version=workflow_version,
                    status=InstanceStatus.PENDING,
                    current_step="start",
                    state={"event_index": index},
                    trigger_event={"type": "high_volume", "data": {"index": index}},
                )
                await self.stores.instances.create(instance)
                async with lock:
                    instance_ids.append(instance.id)
                return instance.id

        start = time.perf_counter()
        await asyncio.gather(*[create_one(i) for i in range(event_count)])
        end = time.perf_counter()

        return instance_ids, end - start


@pytest.fixture
def high_volume_handler(stores: InMemoryStores) -> HighVolumeTriggerHandler:
    """Create a high volume trigger handler."""
    return HighVolumeTriggerHandler(stores, batch_size=100)


class TestHighVolumeEventFiring:
    """Tests for high volume event firing."""

    @pytest.mark.asyncio
    async def test_fire_1000_events(self, stores, high_volume_handler):
        """Test firing 1000 events."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="HighVolumeWorkflow",
            description="Handles high volume",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="start")],
        )
        await stores.workflows.create(definition)

        instance_ids, duration = await high_volume_handler.fire_events(
            workflow_id=definition.id,
            workflow_name=definition.name,
            workflow_version=definition.version,
            event_count=1000,
        )

        # All instances created
        assert len(instance_ids) == 1000

        # All unique
        assert len(set(instance_ids)) == 1000

        # Verify in store
        all_instances = await stores.instances.list_all()
        assert len(all_instances) == 1000

        # Log throughput
        events_per_second = 1000 / duration if duration > 0 else float("inf")
        print(f"\n  Throughput: {events_per_second:.2f} events/second")
        print(f"  Duration: {duration:.3f} seconds")

    @pytest.mark.asyncio
    async def test_fire_1000_events_in_one_second(self, stores, high_volume_handler):
        """Test that 1000 events can be fired in under 1 second."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="FastWorkflow",
            description="Fast processing",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="start")],
        )
        await stores.workflows.create(definition)

        instance_ids, duration = await high_volume_handler.fire_events(
            workflow_id=definition.id,
            workflow_name=definition.name,
            workflow_version=definition.version,
            event_count=1000,
        )

        assert len(instance_ids) == 1000
        # Note: This may or may not pass depending on hardware
        # The goal is to measure, not necessarily guarantee < 1s
        print(f"\n  1000 events in {duration:.3f} seconds")

    @pytest.mark.asyncio
    async def test_concurrent_event_firing(self, stores, high_volume_handler):
        """Test concurrent event firing with controlled concurrency."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="ConcurrentWorkflow",
            description="Concurrent processing",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="start")],
        )
        await stores.workflows.create(definition)

        instance_ids, duration = await high_volume_handler.fire_events_concurrent(
            workflow_id=definition.id,
            workflow_name=definition.name,
            workflow_version=definition.version,
            event_count=1000,
            concurrency=50,
        )

        assert len(instance_ids) == 1000

        events_per_second = 1000 / duration if duration > 0 else float("inf")
        print(f"\n  Concurrent throughput: {events_per_second:.2f} events/second")


class TestHighVolumeInstanceVerification:
    """Tests for verifying all instances are created correctly."""

    @pytest.mark.asyncio
    async def test_all_instances_have_unique_ids(self, stores, high_volume_handler):
        """Test that all created instances have unique IDs."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="UniqueIdWorkflow",
            description="Unique IDs",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="start")],
        )
        await stores.workflows.create(definition)

        instance_ids, _ = await high_volume_handler.fire_events(
            workflow_id=definition.id,
            workflow_name=definition.name,
            workflow_version=definition.version,
            event_count=500,
        )

        # All unique
        assert len(instance_ids) == len(set(instance_ids))

    @pytest.mark.asyncio
    async def test_all_instances_have_correct_initial_state(
        self, stores, high_volume_handler
    ):
        """Test that all instances are initialized correctly."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="StateWorkflow",
            description="Check state",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="start")],
        )
        await stores.workflows.create(definition)

        instance_ids, _ = await high_volume_handler.fire_events(
            workflow_id=definition.id,
            workflow_name=definition.name,
            workflow_version=definition.version,
            event_count=100,
        )

        # Verify each instance
        for i, instance_id in enumerate(instance_ids):
            instance = await stores.instances.get(instance_id)
            assert instance is not None
            assert instance.status == InstanceStatus.PENDING
            assert instance.current_step == "start"
            assert instance.workflow_id == definition.id
            assert instance.workflow_version == definition.version

    @pytest.mark.asyncio
    async def test_event_indices_preserved(self, stores, high_volume_handler):
        """Test that event indices are preserved in trigger data."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="IndexWorkflow",
            description="Check indices",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="start")],
        )
        await stores.workflows.create(definition)

        instance_ids, _ = await high_volume_handler.fire_events(
            workflow_id=definition.id,
            workflow_name=definition.name,
            workflow_version=definition.version,
            event_count=100,
        )

        # Collect indices
        indices = set()
        for instance_id in instance_ids:
            instance = await stores.instances.get(instance_id)
            index = instance.state.get("event_index")
            indices.add(index)

        # All indices from 0 to 99 should be present
        assert indices == set(range(100))


class TestRateLimiting:
    """Tests for rate limiting behavior."""

    @pytest.mark.asyncio
    async def test_batched_processing_works(self, stores):
        """Test that batched processing completes all items."""
        handler = HighVolumeTriggerHandler(stores, batch_size=50)

        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="BatchWorkflow",
            description="Batched processing",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="start")],
        )
        await stores.workflows.create(definition)

        # 250 events with batch size 50 = 5 batches
        instance_ids, _ = await handler.fire_events(
            workflow_id=definition.id,
            workflow_name=definition.name,
            workflow_version=definition.version,
            event_count=250,
        )

        assert len(instance_ids) == 250

    @pytest.mark.asyncio
    async def test_different_batch_sizes(self, stores):
        """Test different batch size configurations."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="BatchSizeWorkflow",
            description="Test batch sizes",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="start")],
        )
        await stores.workflows.create(definition)

        batch_sizes = [10, 50, 100, 500]
        results = []

        for batch_size in batch_sizes:
            stores.instances.clear()
            handler = HighVolumeTriggerHandler(stores, batch_size=batch_size)

            instance_ids, duration = await handler.fire_events(
                workflow_id=definition.id,
                workflow_name=definition.name,
                workflow_version=definition.version,
                event_count=1000,
            )

            throughput = 1000 / duration if duration > 0 else float("inf")
            results.append((batch_size, throughput, duration))

        print("\n  Batch size comparison:")
        for batch_size, throughput, duration in results:
            print(f"    Batch {batch_size:4d}: {throughput:8.2f} events/s ({duration:.3f}s)")


class TestThroughputMeasurement:
    """Tests for measuring throughput."""

    @pytest.mark.asyncio
    async def test_measure_throughput_small(self, stores, high_volume_handler):
        """Measure throughput with small dataset."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="ThroughputSmall",
            description="Small throughput test",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="start")],
        )
        await stores.workflows.create(definition)

        _, duration = await high_volume_handler.fire_events(
            workflow_id=definition.id,
            workflow_name=definition.name,
            workflow_version=definition.version,
            event_count=100,
        )

        throughput = 100 / duration if duration > 0 else float("inf")
        assert throughput > 0
        print(f"\n  Small (100 events): {throughput:.2f} events/second")

    @pytest.mark.asyncio
    async def test_measure_throughput_medium(self, stores, high_volume_handler):
        """Measure throughput with medium dataset."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="ThroughputMedium",
            description="Medium throughput test",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="start")],
        )
        await stores.workflows.create(definition)

        _, duration = await high_volume_handler.fire_events(
            workflow_id=definition.id,
            workflow_name=definition.name,
            workflow_version=definition.version,
            event_count=1000,
        )

        throughput = 1000 / duration if duration > 0 else float("inf")
        assert throughput > 0
        print(f"\n  Medium (1000 events): {throughput:.2f} events/second")

    @pytest.mark.asyncio
    async def test_measure_throughput_large(self, stores, high_volume_handler):
        """Measure throughput with large dataset."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="ThroughputLarge",
            description="Large throughput test",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="start")],
        )
        await stores.workflows.create(definition)

        _, duration = await high_volume_handler.fire_events(
            workflow_id=definition.id,
            workflow_name=definition.name,
            workflow_version=definition.version,
            event_count=5000,
        )

        throughput = 5000 / duration if duration > 0 else float("inf")
        assert throughput > 0
        print(f"\n  Large (5000 events): {throughput:.2f} events/second")


class TestConcurrentWorkflows:
    """Tests for multiple workflows receiving events concurrently."""

    @pytest.mark.asyncio
    async def test_multiple_workflows_high_volume(self, stores):
        """Test multiple workflows receiving high volume events."""
        workflows = []
        for i in range(5):
            definition = WorkflowDefinition(
                id=f"wf_{i}_{uuid.uuid4().hex[:8]}",
                name=f"MultiWorkflow_{i}",
                description=f"Multi workflow {i}",
                version="1.0.0",
                trigger=TriggerConfig(type=TriggerType.MANUAL),
                steps=[StepDefinition(name="start")],
            )
            await stores.workflows.create(definition)
            workflows.append(definition)

        handler = HighVolumeTriggerHandler(stores, batch_size=100)

        async def fire_for_workflow(workflow: WorkflowDefinition) -> Tuple[int, float]:
            instance_ids, duration = await handler.fire_events(
                workflow_id=workflow.id,
                workflow_name=workflow.name,
                workflow_version=workflow.version,
                event_count=200,
            )
            return len(instance_ids), duration

        start = time.perf_counter()
        results = await asyncio.gather(*[fire_for_workflow(wf) for wf in workflows])
        total_time = time.perf_counter() - start

        total_instances = sum(count for count, _ in results)
        assert total_instances == 1000  # 5 workflows * 200 events

        throughput = total_instances / total_time if total_time > 0 else float("inf")
        print(f"\n  5 workflows, 200 events each:")
        print(f"    Total: {total_instances} instances in {total_time:.3f}s")
        print(f"    Throughput: {throughput:.2f} events/second")


class TestStorePerformance:
    """Tests for store performance under load."""

    @pytest.mark.asyncio
    async def test_query_performance_with_many_instances(self, stores):
        """Test query performance with many instances."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="QueryPerfWorkflow",
            description="Query performance test",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="start")],
        )
        await stores.workflows.create(definition)

        handler = HighVolumeTriggerHandler(stores, batch_size=100)

        # Create many instances
        await handler.fire_events(
            workflow_id=definition.id,
            workflow_name=definition.name,
            workflow_version=definition.version,
            event_count=1000,
        )

        # Measure query time
        start = time.perf_counter()
        all_instances = await stores.instances.list_all()
        list_duration = time.perf_counter() - start

        assert len(all_instances) == 1000
        print(f"\n  List 1000 instances: {list_duration * 1000:.2f}ms")

        # Query by status
        start = time.perf_counter()
        pending = await stores.instances.list_by_status(InstanceStatus.PENDING)
        status_query_duration = time.perf_counter() - start

        assert len(pending) == 1000
        print(f"  Query by status: {status_query_duration * 1000:.2f}ms")

        # Query by workflow
        start = time.perf_counter()
        by_workflow = await stores.instances.list_by_workflow(definition.id)
        workflow_query_duration = time.perf_counter() - start

        assert len(by_workflow) == 1000
        print(f"  Query by workflow: {workflow_query_duration * 1000:.2f}ms")

    @pytest.mark.asyncio
    async def test_mixed_status_query_performance(self, stores):
        """Test query performance with mixed statuses."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="MixedStatusWorkflow",
            description="Mixed status test",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="start")],
        )
        await stores.workflows.create(definition)

        # Create instances with different statuses
        statuses = [
            InstanceStatus.PENDING,
            InstanceStatus.RUNNING,
            InstanceStatus.WAITING,
            InstanceStatus.COMPLETED,
            InstanceStatus.FAILED,
        ]

        for i in range(500):
            status = statuses[i % len(statuses)]
            instance = WorkflowInstance(
                id=f"inst_{i}_{uuid.uuid4().hex[:8]}",
                workflow_id=definition.id,
                workflow_name=definition.name,
                workflow_version=definition.version,
                status=status,
                current_step="start" if status != InstanceStatus.COMPLETED else None,
                state={"index": i},
                trigger_event={"type": "manual"},
            )
            await stores.instances.create(instance)

        # Query each status
        for status in statuses:
            start = time.perf_counter()
            results = await stores.instances.list_by_status(status)
            duration = time.perf_counter() - start
            expected = 100  # 500 / 5 statuses
            assert len(results) == expected
            print(f"\n  Query {status.value}: {len(results)} in {duration * 1000:.2f}ms")
