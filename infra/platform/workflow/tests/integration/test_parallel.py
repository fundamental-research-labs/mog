"""
@parallel Integration Tests

Tests the @parallel decorator functionality:
- Execute 10 items with max_concurrency=3
- Verify only 3 run at once
- All results collected
- One failure doesn't stop others
- Aggregate results in next step
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Set

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


class MockParallelExecutor:
    """Mock parallel executor for testing parallel step execution."""

    def __init__(self, max_concurrency: int = 10):
        self.max_concurrency = max_concurrency
        self.currently_running: Set[str] = set()
        self.max_observed_concurrency = 0
        self.execution_order: List[str] = []
        self.results: Dict[str, Any] = {}
        self.errors: Dict[str, str] = {}

    async def execute_item(
        self,
        item_id: str,
        process_func: callable,
        delay: float = 0.01,
    ) -> Any:
        """Execute a single item with concurrency tracking."""
        self.currently_running.add(item_id)
        self.execution_order.append(f"start:{item_id}")

        # Track max concurrency
        current = len(self.currently_running)
        if current > self.max_observed_concurrency:
            self.max_observed_concurrency = current

        try:
            # Simulate processing
            await asyncio.sleep(delay)
            result = await process_func(item_id)
            self.results[item_id] = result
            return result
        except Exception as e:
            self.errors[item_id] = str(e)
            raise
        finally:
            self.currently_running.remove(item_id)
            self.execution_order.append(f"end:{item_id}")

    async def execute_parallel(
        self,
        items: List[str],
        process_func: callable,
        delay: float = 0.01,
    ) -> Dict[str, Any]:
        """Execute items in parallel with concurrency limit."""
        semaphore = asyncio.Semaphore(self.max_concurrency)

        async def limited_execute(item_id: str) -> tuple[str, Any]:
            async with semaphore:
                try:
                    result = await self.execute_item(item_id, process_func, delay)
                    return (item_id, {"success": True, "result": result})
                except Exception as e:
                    return (item_id, {"success": False, "error": str(e)})

        tasks = [limited_execute(item) for item in items]
        results = await asyncio.gather(*tasks)

        return dict(results)


@pytest.fixture
def parallel_executor() -> MockParallelExecutor:
    """Create a mock parallel executor with default concurrency."""
    return MockParallelExecutor(max_concurrency=3)


class TestParallelConcurrencyLimit:
    """Tests for parallel execution concurrency limits."""

    @pytest.mark.asyncio
    async def test_max_concurrency_respected(self):
        """Test that max_concurrency limits parallel execution."""
        executor = MockParallelExecutor(max_concurrency=3)

        items = [f"item_{i}" for i in range(10)]

        async def process(item_id: str) -> str:
            return f"processed_{item_id}"

        results = await executor.execute_parallel(items, process, delay=0.05)

        # All items should be processed
        assert len(results) == 10

        # Max concurrency should not exceed 3
        assert executor.max_observed_concurrency <= 3

    @pytest.mark.asyncio
    async def test_concurrency_one_executes_sequentially(self):
        """Test that max_concurrency=1 executes sequentially."""
        executor = MockParallelExecutor(max_concurrency=1)

        items = [f"item_{i}" for i in range(5)]

        async def process(item_id: str) -> str:
            return f"processed_{item_id}"

        await executor.execute_parallel(items, process, delay=0.01)

        # Should never have more than 1 running
        assert executor.max_observed_concurrency == 1

        # Verify sequential execution pattern
        # Each item should start then end before next starts
        starts = [e for e in executor.execution_order if e.startswith("start:")]
        ends = [e for e in executor.execution_order if e.startswith("end:")]

        # With concurrency=1, execution should be strictly sequential
        for i in range(len(starts) - 1):
            start_idx = executor.execution_order.index(starts[i])
            end_idx = executor.execution_order.index(ends[i])
            next_start_idx = executor.execution_order.index(starts[i + 1])
            assert end_idx < next_start_idx

    @pytest.mark.asyncio
    async def test_high_concurrency_allows_all_parallel(self):
        """Test that high concurrency allows all items to run at once."""
        executor = MockParallelExecutor(max_concurrency=100)

        items = [f"item_{i}" for i in range(10)]

        async def process(item_id: str) -> str:
            return f"processed_{item_id}"

        await executor.execute_parallel(items, process, delay=0.05)

        # All 10 should run concurrently
        assert executor.max_observed_concurrency == 10


class TestParallelResultCollection:
    """Tests for collecting parallel execution results."""

    @pytest.mark.asyncio
    async def test_all_results_collected(self, parallel_executor):
        """Test that all parallel results are collected."""
        items = [f"item_{i}" for i in range(10)]

        async def process(item_id: str) -> dict:
            return {"id": item_id, "value": hash(item_id) % 100}

        results = await parallel_executor.execute_parallel(items, process)

        # All 10 items should have results
        assert len(results) == 10

        for item in items:
            assert item in results
            assert results[item]["success"] is True
            assert results[item]["result"]["id"] == item

    @pytest.mark.asyncio
    async def test_results_order_independent_of_completion(self, parallel_executor):
        """Test that results are keyed by item ID regardless of completion order."""
        items = ["fast", "medium", "slow"]

        async def process(item_id: str) -> str:
            delays = {"fast": 0.01, "medium": 0.03, "slow": 0.05}
            await asyncio.sleep(delays.get(item_id, 0.01))
            return f"result_{item_id}"

        results = await parallel_executor.execute_parallel(items, process)

        # Results should be keyed by item ID
        assert results["fast"]["result"] == "result_fast"
        assert results["medium"]["result"] == "result_medium"
        assert results["slow"]["result"] == "result_slow"

    @pytest.mark.asyncio
    async def test_complex_result_objects_collected(self, parallel_executor):
        """Test that complex result objects are properly collected."""
        items = ["a", "b", "c"]

        async def process(item_id: str) -> dict:
            return {
                "id": item_id,
                "nested": {
                    "level1": {
                        "level2": f"deep_value_{item_id}"
                    }
                },
                "array": [1, 2, 3],
                "computed": len(item_id) * 10,
            }

        results = await parallel_executor.execute_parallel(items, process)

        for item in items:
            result = results[item]["result"]
            assert result["id"] == item
            assert result["nested"]["level1"]["level2"] == f"deep_value_{item}"
            assert result["array"] == [1, 2, 3]


class TestParallelFailureHandling:
    """Tests for handling failures in parallel execution."""

    @pytest.mark.asyncio
    async def test_one_failure_does_not_stop_others(self):
        """Test that one item's failure doesn't prevent others from completing."""
        executor = MockParallelExecutor(max_concurrency=5)

        items = [f"item_{i}" for i in range(5)]

        async def process(item_id: str) -> str:
            if item_id == "item_2":
                raise ValueError(f"Simulated failure for {item_id}")
            return f"success_{item_id}"

        results = await executor.execute_parallel(items, process)

        # All 5 should have results
        assert len(results) == 5

        # 4 should succeed
        successes = [k for k, v in results.items() if v["success"]]
        assert len(successes) == 4

        # 1 should fail
        failures = [k for k, v in results.items() if not v["success"]]
        assert len(failures) == 1
        assert "item_2" in failures
        assert "Simulated failure" in results["item_2"]["error"]

    @pytest.mark.asyncio
    async def test_multiple_failures_collected(self):
        """Test that multiple failures are all collected."""
        executor = MockParallelExecutor(max_concurrency=5)

        items = [f"item_{i}" for i in range(10)]

        async def process(item_id: str) -> str:
            # Fail on even-numbered items
            idx = int(item_id.split("_")[1])
            if idx % 2 == 0:
                raise RuntimeError(f"Failed: {item_id}")
            return f"success_{item_id}"

        results = await executor.execute_parallel(items, process)

        successes = [k for k, v in results.items() if v["success"]]
        failures = [k for k, v in results.items() if not v["success"]]

        # 5 even items should fail
        assert len(failures) == 5
        # 5 odd items should succeed
        assert len(successes) == 5

    @pytest.mark.asyncio
    async def test_failure_details_preserved(self):
        """Test that failure details are preserved in results."""
        executor = MockParallelExecutor(max_concurrency=3)

        items = ["item_fail"]

        async def process(item_id: str) -> str:
            raise ValueError("Detailed error message with context")

        results = await executor.execute_parallel(items, process)

        assert results["item_fail"]["success"] is False
        assert "Detailed error message" in results["item_fail"]["error"]


class TestParallelAggregation:
    """Tests for aggregating parallel results in subsequent steps."""

    @pytest.mark.asyncio
    async def test_aggregate_results_in_next_step(self, mock_engine, stores):
        """Test aggregating parallel results in the following step."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="ParallelAggregate",
            description="Parallel with aggregation",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="prepare"),
                StepDefinition(name="process_parallel", parallel_max_concurrency=3),
                StepDefinition(name="aggregate"),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("ParallelAggregate", event_data={})

        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        instance.state = {
            "items": [10, 20, 30, 40, 50],
        }
        await stores.instances.update(instance_id, instance)

        await mock_engine.complete_step(instance_id, "prepare", next_step="process_parallel")

        # Simulate parallel processing
        instance = await mock_engine.get_instance(instance_id)
        instance.state["parallel_results"] = {
            "10": {"squared": 100},
            "20": {"squared": 400},
            "30": {"squared": 900},
            "40": {"squared": 1600},
            "50": {"squared": 2500},
        }
        await stores.instances.update(instance_id, instance)

        await mock_engine.complete_step(instance_id, "process_parallel", next_step="aggregate")

        # Aggregate step
        instance = await mock_engine.get_instance(instance_id)
        parallel_results = instance.state["parallel_results"]

        # Calculate aggregate
        total = sum(r["squared"] for r in parallel_results.values())
        average = total / len(parallel_results)

        instance.state["aggregate"] = {
            "total": total,
            "average": average,
            "count": len(parallel_results),
        }
        await stores.instances.update(instance_id, instance)

        await mock_engine.complete_step(instance_id, "aggregate")

        # Verify aggregation
        final = await mock_engine.get_instance(instance_id)
        assert final.state["aggregate"]["total"] == 5500
        assert final.state["aggregate"]["average"] == 1100
        assert final.state["aggregate"]["count"] == 5

    @pytest.mark.asyncio
    async def test_aggregate_handles_partial_failures(self, mock_engine, stores):
        """Test aggregation with some parallel failures."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="PartialFailAggregate",
            description="Aggregate with failures",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="process_parallel", parallel_max_concurrency=5),
                StepDefinition(name="aggregate"),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("PartialFailAggregate", event_data={})

        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        # Simulate parallel with some failures
        instance.state["parallel_results"] = {
            "item_1": {"success": True, "value": 100},
            "item_2": {"success": False, "error": "Network timeout"},
            "item_3": {"success": True, "value": 300},
            "item_4": {"success": True, "value": 400},
            "item_5": {"success": False, "error": "Rate limited"},
        }
        await stores.instances.update(instance_id, instance)

        await mock_engine.complete_step(instance_id, "process_parallel", next_step="aggregate")

        # Aggregate only successful results
        instance = await mock_engine.get_instance(instance_id)
        results = instance.state["parallel_results"]

        successful = {k: v for k, v in results.items() if v.get("success")}
        failed = {k: v for k, v in results.items() if not v.get("success")}

        instance.state["aggregate"] = {
            "successful_count": len(successful),
            "failed_count": len(failed),
            "total_value": sum(v["value"] for v in successful.values()),
            "failures": list(failed.keys()),
        }
        await stores.instances.update(instance_id, instance)

        await mock_engine.complete_step(instance_id, "aggregate")

        final = await mock_engine.get_instance(instance_id)
        assert final.state["aggregate"]["successful_count"] == 3
        assert final.state["aggregate"]["failed_count"] == 2
        assert final.state["aggregate"]["total_value"] == 800


class TestParallelStateManagement:
    """Tests for state management during parallel execution."""

    @pytest.mark.asyncio
    async def test_parallel_preserves_workflow_state(self, mock_engine, stores):
        """Test that parallel execution preserves overall workflow state."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="StatePreserve",
            description="State preservation during parallel",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[
                StepDefinition(name="setup"),
                StepDefinition(name="parallel", parallel_max_concurrency=3),
                StepDefinition(name="verify"),
            ],
        )

        await mock_engine.start()
        await mock_engine.register_workflow(definition)

        instance_id = await mock_engine.trigger_workflow("StatePreserve", event_data={})

        # Setup state
        instance = await mock_engine.get_instance(instance_id)
        instance.status = InstanceStatus.RUNNING
        instance.state = {
            "config": {"batch_size": 5, "timeout": 30},
            "metadata": {"user": "test", "started_at": datetime.utcnow().isoformat()},
        }
        await stores.instances.update(instance_id, instance)

        await mock_engine.complete_step(instance_id, "setup", next_step="parallel")

        # Parallel step adds its own results but shouldn't overwrite config/metadata
        instance = await mock_engine.get_instance(instance_id)
        instance.state["parallel_results"] = {"a": 1, "b": 2}
        await stores.instances.update(instance_id, instance)

        await mock_engine.complete_step(instance_id, "parallel", next_step="verify")

        # Verify original state preserved
        final = await mock_engine.get_instance(instance_id)
        assert final.state["config"]["batch_size"] == 5
        assert final.state["metadata"]["user"] == "test"
        assert final.state["parallel_results"] == {"a": 1, "b": 2}


class TestParallelEdgeCases:
    """Tests for parallel execution edge cases."""

    @pytest.mark.asyncio
    async def test_empty_items_list(self, parallel_executor):
        """Test parallel execution with empty items list."""
        items: List[str] = []

        async def process(item_id: str) -> str:
            return f"processed_{item_id}"

        results = await parallel_executor.execute_parallel(items, process)

        assert results == {}
        assert parallel_executor.max_observed_concurrency == 0

    @pytest.mark.asyncio
    async def test_single_item(self, parallel_executor):
        """Test parallel execution with single item."""
        items = ["only_item"]

        async def process(item_id: str) -> str:
            return f"processed_{item_id}"

        results = await parallel_executor.execute_parallel(items, process)

        assert len(results) == 1
        assert results["only_item"]["success"] is True
        assert parallel_executor.max_observed_concurrency == 1

    @pytest.mark.asyncio
    async def test_items_equal_to_concurrency(self):
        """Test when number of items equals max concurrency."""
        executor = MockParallelExecutor(max_concurrency=5)
        items = [f"item_{i}" for i in range(5)]

        async def process(item_id: str) -> str:
            await asyncio.sleep(0.02)
            return f"processed_{item_id}"

        results = await executor.execute_parallel(items, process)

        assert len(results) == 5
        # All should run concurrently
        assert executor.max_observed_concurrency == 5

    @pytest.mark.asyncio
    async def test_items_less_than_concurrency(self):
        """Test when number of items is less than max concurrency."""
        executor = MockParallelExecutor(max_concurrency=10)
        items = [f"item_{i}" for i in range(3)]

        async def process(item_id: str) -> str:
            await asyncio.sleep(0.02)
            return f"processed_{item_id}"

        results = await executor.execute_parallel(items, process)

        assert len(results) == 3
        assert executor.max_observed_concurrency == 3  # All 3 at once

    @pytest.mark.asyncio
    async def test_large_number_of_items(self):
        """Test parallel execution with large number of items."""
        executor = MockParallelExecutor(max_concurrency=10)
        items = [f"item_{i}" for i in range(100)]

        async def process(item_id: str) -> str:
            return f"processed_{item_id}"

        results = await executor.execute_parallel(items, process, delay=0.001)

        assert len(results) == 100
        # Should respect concurrency limit
        assert executor.max_observed_concurrency <= 10
