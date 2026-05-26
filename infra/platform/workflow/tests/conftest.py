"""
Shared fixtures for workflow engine integration tests.

This module provides common fixtures used across all integration tests,
including in-memory stores, sample workflows, and test utilities.
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, List, Optional, Type

import pytest

# Import stores
from workflow_engine.stores.memory import (
    InMemoryWorkflowDefinitionStore,
    InMemoryInstanceStore,
    InMemoryTimerStore,
    InMemoryEventLogStore,
    InMemoryDeadLetterStore,
    InMemoryStores,
)

# Import base types
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
    WorkflowEvent,
    EventType,
    DeadLetterEntry,
    VersioningStrategy,
)


# =============================================================================
# Fixtures - Stores
# =============================================================================


@pytest.fixture
def stores() -> InMemoryStores:
    """Create a fresh set of in-memory stores for each test."""
    return InMemoryStores()


@pytest.fixture
def workflow_store(stores: InMemoryStores) -> InMemoryWorkflowDefinitionStore:
    """Get workflow definition store."""
    return stores.workflows


@pytest.fixture
def instance_store(stores: InMemoryStores) -> InMemoryInstanceStore:
    """Get instance store."""
    return stores.instances


@pytest.fixture
def timer_store(stores: InMemoryStores) -> InMemoryTimerStore:
    """Get timer store."""
    return stores.timers


@pytest.fixture
def event_store(stores: InMemoryStores) -> InMemoryEventLogStore:
    """Get event log store."""
    return stores.events


@pytest.fixture
def dead_letter_store(stores: InMemoryStores) -> InMemoryDeadLetterStore:
    """Get dead letter store."""
    return stores.dead_letters


# =============================================================================
# Fixtures - ID Generation
# =============================================================================


@pytest.fixture
def id_generator() -> Callable[[], str]:
    """Generate unique IDs for tests."""
    counter = [0]

    def generate() -> str:
        counter[0] += 1
        return f"test_{counter[0]:08d}"

    return generate


@pytest.fixture
def workflow_id(id_generator: Callable[[], str]) -> str:
    """Generate a unique workflow ID."""
    return f"wf_{id_generator()}"


@pytest.fixture
def instance_id(id_generator: Callable[[], str]) -> str:
    """Generate a unique instance ID."""
    return f"inst_{id_generator()}"


# =============================================================================
# Fixtures - Sample Workflow Definitions
# =============================================================================


@pytest.fixture
def simple_workflow_definition(workflow_id: str) -> WorkflowDefinition:
    """Create a simple workflow definition with two steps."""
    return WorkflowDefinition(
        id=workflow_id,
        name="SimpleWorkflow",
        description="A simple two-step workflow for testing",
        version="1.0.0",
        trigger=TriggerConfig(
            type=TriggerType.MANUAL,
        ),
        steps=[
            StepDefinition(name="step_one"),
            StepDefinition(name="step_two"),
        ],
        runtime="auto",
        versioning_strategy=VersioningStrategy.REPLACE,
    )


@pytest.fixture
def multi_step_workflow_definition(workflow_id: str) -> WorkflowDefinition:
    """Create a workflow with multiple steps."""
    return WorkflowDefinition(
        id=workflow_id,
        name="MultiStepWorkflow",
        description="A workflow with 5 steps for testing",
        version="1.0.0",
        trigger=TriggerConfig(
            type=TriggerType.MANUAL,
        ),
        steps=[
            StepDefinition(name="step_1"),
            StepDefinition(name="step_2"),
            StepDefinition(name="step_3"),
            StepDefinition(name="step_4"),
            StepDefinition(name="step_5"),
        ],
    )


@pytest.fixture
def wait_for_workflow_definition(workflow_id: str) -> WorkflowDefinition:
    """Create a workflow that waits for events."""
    return WorkflowDefinition(
        id=workflow_id,
        name="WaitForWorkflow",
        description="A workflow that waits for external events",
        version="1.0.0",
        trigger=TriggerConfig(
            type=TriggerType.MANUAL,
        ),
        steps=[
            StepDefinition(name="start"),
            StepDefinition(
                name="wait_for_approval",
                wait_for_events=["approval:granted", "approval:denied"],
                timeout="7d",
            ),
            StepDefinition(name="complete"),
        ],
    )


@pytest.fixture
def retry_workflow_definition(workflow_id: str) -> WorkflowDefinition:
    """Create a workflow with retry configuration."""
    return WorkflowDefinition(
        id=workflow_id,
        name="RetryWorkflow",
        description="A workflow with retry logic",
        version="1.0.0",
        trigger=TriggerConfig(
            type=TriggerType.MANUAL,
        ),
        steps=[
            StepDefinition(name="start"),
            StepDefinition(
                name="flaky_step",
                retry_max_attempts=5,
                retry_backoff="exponential",
                retry_initial_delay="1s",
                retry_max_delay="30s",
            ),
            StepDefinition(name="complete"),
        ],
    )


@pytest.fixture
def parallel_workflow_definition(workflow_id: str) -> WorkflowDefinition:
    """Create a workflow with parallel execution."""
    return WorkflowDefinition(
        id=workflow_id,
        name="ParallelWorkflow",
        description="A workflow with parallel step execution",
        version="1.0.0",
        trigger=TriggerConfig(
            type=TriggerType.MANUAL,
        ),
        steps=[
            StepDefinition(name="start"),
            StepDefinition(
                name="parallel_process",
                parallel_max_concurrency=3,
            ),
            StepDefinition(name="aggregate"),
            StepDefinition(name="complete"),
        ],
    )


@pytest.fixture
def record_trigger_workflow_definition(workflow_id: str) -> WorkflowDefinition:
    """Create a workflow triggered by record creation."""
    return WorkflowDefinition(
        id=workflow_id,
        name="RecordTriggerWorkflow",
        description="A workflow triggered by record creation",
        version="1.0.0",
        trigger=TriggerConfig(
            type=TriggerType.RECORD_CREATED,
            table="expenses",
        ),
        steps=[
            StepDefinition(name="process"),
            StepDefinition(name="complete"),
        ],
    )


@pytest.fixture
def schedule_workflow_definition(workflow_id: str) -> WorkflowDefinition:
    """Create a scheduled workflow."""
    return WorkflowDefinition(
        id=workflow_id,
        name="ScheduledWorkflow",
        description="A workflow that runs on a schedule",
        version="1.0.0",
        trigger=TriggerConfig(
            type=TriggerType.SCHEDULE,
            cron="0 9 * * *",  # Daily at 9 AM
            timezone="UTC",
        ),
        steps=[
            StepDefinition(name="daily_task"),
        ],
    )


# =============================================================================
# Fixtures - Sample Workflow Instances
# =============================================================================


@pytest.fixture
def pending_instance(
    instance_id: str, simple_workflow_definition: WorkflowDefinition
) -> WorkflowInstance:
    """Create a pending workflow instance."""
    return WorkflowInstance(
        id=instance_id,
        workflow_id=simple_workflow_definition.id,
        workflow_name=simple_workflow_definition.name,
        workflow_version=simple_workflow_definition.version,
        status=InstanceStatus.PENDING,
        current_step="step_one",
        state={},
        trigger_event={"type": "manual", "data": {}},
    )


@pytest.fixture
def running_instance(
    instance_id: str, simple_workflow_definition: WorkflowDefinition
) -> WorkflowInstance:
    """Create a running workflow instance."""
    now = datetime.utcnow().isoformat() + "Z"
    return WorkflowInstance(
        id=instance_id,
        workflow_id=simple_workflow_definition.id,
        workflow_name=simple_workflow_definition.name,
        workflow_version=simple_workflow_definition.version,
        status=InstanceStatus.RUNNING,
        current_step="step_one",
        state={"progress": 0},
        trigger_event={"type": "manual", "data": {}},
        started_at=now,
        step_history=[
            StepHistory(
                step_name="step_one",
                started_at=now,
                status="running",
            )
        ],
    )


@pytest.fixture
def waiting_instance(
    instance_id: str, wait_for_workflow_definition: WorkflowDefinition
) -> WorkflowInstance:
    """Create a waiting workflow instance."""
    now = datetime.utcnow().isoformat() + "Z"
    timeout = (datetime.utcnow() + timedelta(days=7)).isoformat() + "Z"
    return WorkflowInstance(
        id=instance_id,
        workflow_id=wait_for_workflow_definition.id,
        workflow_name=wait_for_workflow_definition.name,
        workflow_version=wait_for_workflow_definition.version,
        status=InstanceStatus.WAITING,
        current_step="wait_for_approval",
        state={"submitted": True},
        trigger_event={"type": "manual", "data": {}},
        started_at=now,
        waiting=WaitingState(
            events=["approval:granted", "approval:denied"],
            timeout_at=timeout,
        ),
        step_history=[
            StepHistory(
                step_name="start",
                started_at=now,
                completed_at=now,
                status="completed",
            ),
        ],
    )


@pytest.fixture
def completed_instance(
    instance_id: str, simple_workflow_definition: WorkflowDefinition
) -> WorkflowInstance:
    """Create a completed workflow instance."""
    now = datetime.utcnow().isoformat() + "Z"
    return WorkflowInstance(
        id=instance_id,
        workflow_id=simple_workflow_definition.id,
        workflow_name=simple_workflow_definition.name,
        workflow_version=simple_workflow_definition.version,
        status=InstanceStatus.COMPLETED,
        current_step=None,
        state={"result": "success"},
        trigger_event={"type": "manual", "data": {}},
        started_at=now,
        completed_at=now,
        step_history=[
            StepHistory(
                step_name="step_one",
                started_at=now,
                completed_at=now,
                status="completed",
            ),
            StepHistory(
                step_name="step_two",
                started_at=now,
                completed_at=now,
                status="completed",
            ),
        ],
    )


@pytest.fixture
def failed_instance(
    instance_id: str, simple_workflow_definition: WorkflowDefinition
) -> WorkflowInstance:
    """Create a failed workflow instance."""
    now = datetime.utcnow().isoformat() + "Z"
    return WorkflowInstance(
        id=instance_id,
        workflow_id=simple_workflow_definition.id,
        workflow_name=simple_workflow_definition.name,
        workflow_version=simple_workflow_definition.version,
        status=InstanceStatus.FAILED,
        current_step="step_one",
        state={},
        trigger_event={"type": "manual", "data": {}},
        started_at=now,
        completed_at=now,
        error="Test error: something went wrong",
        step_history=[
            StepHistory(
                step_name="step_one",
                started_at=now,
                completed_at=now,
                status="failed",
                error="Test error: something went wrong",
            ),
        ],
    )


# =============================================================================
# Fixtures - Timers
# =============================================================================


@pytest.fixture
def timeout_timer(instance_id: str) -> Timer:
    """Create a timeout timer."""
    fire_at = (datetime.utcnow() + timedelta(days=7)).isoformat() + "Z"
    return Timer(
        id=f"timer_{uuid.uuid4().hex[:8]}",
        instance_id=instance_id,
        fire_at=fire_at,
        event_type="timeout",
        event_data={"step": "wait_for_approval"},
    )


@pytest.fixture
def sleep_timer(instance_id: str) -> Timer:
    """Create a sleep timer."""
    fire_at = (datetime.utcnow() + timedelta(hours=24)).isoformat() + "Z"
    return Timer(
        id=f"timer_{uuid.uuid4().hex[:8]}",
        instance_id=instance_id,
        fire_at=fire_at,
        event_type="sleep_completed",
        event_data={},
    )


# =============================================================================
# Fixtures - Events
# =============================================================================


@pytest.fixture
def approval_event() -> Dict[str, Any]:
    """Create an approval event."""
    return {
        "type": "approval:granted",
        "data": {
            "approved_by": "manager@example.com",
            "approved_at": datetime.utcnow().isoformat() + "Z",
        },
    }


@pytest.fixture
def record_created_event() -> Dict[str, Any]:
    """Create a record created event."""
    return {
        "type": "record:created",
        "data": {
            "table": "expenses",
            "record_id": f"rec_{uuid.uuid4().hex[:8]}",
            "fields": {
                "amount": 150.00,
                "description": "Office supplies",
                "status": "pending",
            },
        },
    }


# =============================================================================
# Fixtures - Dead Letter Entries
# =============================================================================


@pytest.fixture
def dead_letter_entry(failed_instance: WorkflowInstance) -> DeadLetterEntry:
    """Create a dead letter entry."""
    return DeadLetterEntry(
        id=f"dlq_{uuid.uuid4().hex[:8]}",
        instance=failed_instance,
        reason="Max retries exceeded",
        retry_count=0,
    )


# =============================================================================
# Helper Classes
# =============================================================================


@dataclass
class MockWorkflowEngine:
    """
    Mock workflow engine for testing.

    This provides a simplified engine interface for testing scenarios
    without the full engine implementation.
    """

    stores: InMemoryStores
    running: bool = False
    _registered_workflows: Dict[str, WorkflowDefinition] = field(default_factory=dict)

    async def start(self) -> None:
        """Start the engine."""
        self.running = True

    async def stop(self) -> None:
        """Stop the engine."""
        self.running = False

    async def register_workflow(self, definition: WorkflowDefinition) -> str:
        """Register a workflow definition."""
        workflow_id = await self.stores.workflows.create(definition)
        self._registered_workflows[definition.name] = definition
        return workflow_id

    async def trigger_workflow(
        self,
        workflow_name: str,
        event_data: Dict[str, Any],
        idempotency_key: Optional[str] = None,
    ) -> str:
        """Trigger a new workflow instance."""
        definition = self._registered_workflows.get(workflow_name)
        if not definition:
            definition = await self.stores.workflows.get_by_name(workflow_name)
        if not definition:
            raise ValueError(f"Workflow not found: {workflow_name}")

        # Check idempotency
        if idempotency_key:
            existing = await self.stores.instances.find_by_idempotency_key(
                idempotency_key
            )
            if existing:
                return existing.id

        first_step = definition.steps[0].name if definition.steps else None
        instance = WorkflowInstance(
            id=f"inst_{uuid.uuid4().hex[:8]}",
            workflow_id=definition.id,
            workflow_name=definition.name,
            workflow_version=definition.version,
            status=InstanceStatus.PENDING,
            current_step=first_step,
            state={},
            trigger_event={"type": definition.trigger.type.value, "data": event_data},
            idempotency_key=idempotency_key,
        )

        await self.stores.instances.create(instance)
        return instance.id

    async def get_instance(self, instance_id: str) -> Optional[WorkflowInstance]:
        """Get an instance by ID."""
        return await self.stores.instances.get(instance_id)

    async def resume_instance(
        self, instance_id: str, event_type: str, event_data: Dict[str, Any]
    ) -> bool:
        """Resume a waiting instance with an event."""
        instance = await self.stores.instances.get(instance_id)
        if not instance:
            return False

        if instance.status != InstanceStatus.WAITING:
            return False

        if instance.waiting and event_type in instance.waiting.events:
            instance.status = InstanceStatus.RUNNING
            instance.waiting = None
            instance.state["last_event"] = {"type": event_type, "data": event_data}
            await self.stores.instances.update(instance_id, instance)
            return True

        return False

    async def cancel_instance(self, instance_id: str, reason: str) -> bool:
        """Cancel an instance."""
        instance = await self.stores.instances.get(instance_id)
        if not instance:
            return False

        if instance.status in [InstanceStatus.COMPLETED, InstanceStatus.CANCELLED]:
            return False

        instance.status = InstanceStatus.CANCELLED
        instance.completed_at = datetime.utcnow().isoformat() + "Z"
        instance.metadata["cancellation_reason"] = reason
        await self.stores.instances.update(instance_id, instance)

        # Cancel any pending timers
        await self.stores.timers.delete_by_instance(instance_id)

        return True

    async def complete_step(
        self,
        instance_id: str,
        step_name: str,
        output: Any = None,
        next_step: Optional[str] = None,
    ) -> bool:
        """Complete a step and move to the next."""
        instance = await self.stores.instances.get(instance_id)
        if not instance:
            return False

        now = datetime.utcnow().isoformat() + "Z"

        # Update step history
        for step in instance.step_history:
            if step.step_name == step_name and step.status == "running":
                step.status = "completed"
                step.completed_at = now
                step.output = output
                break
        else:
            # Step not found, add it
            instance.step_history.append(
                StepHistory(
                    step_name=step_name,
                    started_at=now,
                    completed_at=now,
                    status="completed",
                    output=output,
                )
            )

        if next_step:
            instance.current_step = next_step
            instance.step_history.append(
                StepHistory(
                    step_name=next_step,
                    started_at=now,
                    status="running",
                )
            )
        else:
            instance.current_step = None
            instance.status = InstanceStatus.COMPLETED
            instance.completed_at = now

        await self.stores.instances.update(instance_id, instance)
        return True

    async def fail_step(
        self, instance_id: str, step_name: str, error: str
    ) -> bool:
        """Fail a step."""
        instance = await self.stores.instances.get(instance_id)
        if not instance:
            return False

        now = datetime.utcnow().isoformat() + "Z"

        # Update step history
        for step in instance.step_history:
            if step.step_name == step_name and step.status == "running":
                step.status = "failed"
                step.completed_at = now
                step.error = error
                break

        instance.status = InstanceStatus.FAILED
        instance.error = error
        instance.completed_at = now

        await self.stores.instances.update(instance_id, instance)
        return True

    async def enter_waiting_state(
        self,
        instance_id: str,
        events: List[str],
        timeout: Optional[timedelta] = None,
    ) -> bool:
        """Put instance into waiting state."""
        instance = await self.stores.instances.get(instance_id)
        if not instance:
            return False

        timeout_at = None
        timer_id = None

        if timeout:
            fire_at = datetime.utcnow() + timeout
            timeout_at = fire_at.isoformat() + "Z"
            timer = Timer(
                id=f"timer_{uuid.uuid4().hex[:8]}",
                instance_id=instance_id,
                fire_at=timeout_at,
                event_type="timeout",
                event_data={"step": instance.current_step},
            )
            timer_id = await self.stores.timers.create(timer)

        instance.status = InstanceStatus.WAITING
        instance.waiting = WaitingState(
            events=events,
            timeout_at=timeout_at,
            timer_id=timer_id,
        )

        await self.stores.instances.update(instance_id, instance)
        return True


@pytest.fixture
def mock_engine(stores: InMemoryStores) -> MockWorkflowEngine:
    """Create a mock workflow engine."""
    return MockWorkflowEngine(stores=stores)


# =============================================================================
# Async Test Utilities
# =============================================================================


@pytest.fixture
def event_loop():
    """Create an event loop for async tests."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


# =============================================================================
# Test Data Generators
# =============================================================================


def generate_workflow_definitions(count: int) -> List[WorkflowDefinition]:
    """Generate multiple workflow definitions."""
    definitions = []
    for i in range(count):
        definitions.append(
            WorkflowDefinition(
                id=f"wf_{uuid.uuid4().hex[:8]}",
                name=f"TestWorkflow_{i}",
                description=f"Test workflow {i}",
                version="1.0.0",
                trigger=TriggerConfig(type=TriggerType.MANUAL),
                steps=[
                    StepDefinition(name="step_1"),
                    StepDefinition(name="step_2"),
                ],
            )
        )
    return definitions


def generate_instances(
    definition: WorkflowDefinition, count: int
) -> List[WorkflowInstance]:
    """Generate multiple workflow instances."""
    instances = []
    for i in range(count):
        instances.append(
            WorkflowInstance(
                id=f"inst_{uuid.uuid4().hex[:8]}",
                workflow_id=definition.id,
                workflow_name=definition.name,
                workflow_version=definition.version,
                status=InstanceStatus.PENDING,
                current_step=definition.steps[0].name if definition.steps else None,
                state={"index": i},
                trigger_event={"type": "manual", "data": {"batch": i}},
            )
        )
    return instances


def generate_events(count: int, event_type: str = "test:event") -> List[Dict[str, Any]]:
    """Generate multiple events."""
    events = []
    for i in range(count):
        events.append(
            {
                "type": event_type,
                "data": {
                    "index": i,
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                },
            }
        )
    return events
