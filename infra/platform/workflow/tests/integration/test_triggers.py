"""
Trigger Integration Tests

Tests all trigger types:
- `record:created` - new record triggers workflow
- `record:updated` with field filter
- `record:updated` with value filter
- `cell:changed` - spreadsheet trigger
- `schedule` - cron triggers
- `webhook` - HTTP POST triggers
- `manual` - explicit trigger
- Idempotency key prevents duplicates
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


class MockTriggerHandler:
    """Mock trigger handler for testing trigger logic."""

    def __init__(self, stores: InMemoryStores):
        self.stores = stores
        self.triggered_instances: List[str] = []

    async def handle_trigger(
        self,
        trigger_type: TriggerType,
        event_data: Dict[str, Any],
        idempotency_key: Optional[str] = None,
        **kwargs: Any,
    ) -> List[str]:
        """
        Handle an incoming trigger event.

        Args:
            trigger_type: Type of trigger
            event_data: Event payload
            idempotency_key: Optional key for deduplication
            **kwargs: Trigger-specific filters

        Returns:
            List of created instance IDs
        """
        # Check idempotency
        if idempotency_key:
            existing = await self.stores.instances.find_by_idempotency_key(idempotency_key)
            if existing:
                return [existing.id]

        # Find matching workflow definitions
        matching_workflows = await self.stores.workflows.find_by_trigger(
            trigger_type, **kwargs
        )

        instance_ids = []
        for workflow in matching_workflows:
            # Check additional filters
            if not self._matches_filters(workflow, event_data, kwargs):
                continue

            # Create instance
            first_step = workflow.steps[0].name if workflow.steps else None
            instance = WorkflowInstance(
                id=f"inst_{uuid.uuid4().hex[:8]}",
                workflow_id=workflow.id,
                workflow_name=workflow.name,
                workflow_version=workflow.version,
                status=InstanceStatus.PENDING,
                current_step=first_step,
                state={},
                trigger_event={
                    "type": trigger_type.value,
                    "data": event_data,
                    "triggered_at": datetime.utcnow().isoformat() + "Z",
                },
                idempotency_key=idempotency_key,
            )
            await self.stores.instances.create(instance)
            instance_ids.append(instance.id)
            self.triggered_instances.append(instance.id)

        return instance_ids

    def _matches_filters(
        self,
        workflow: WorkflowDefinition,
        event_data: Dict[str, Any],
        kwargs: Dict[str, Any],
    ) -> bool:
        """Check if event matches workflow trigger filters."""
        trigger = workflow.trigger

        # Check table filter
        if trigger.table and kwargs.get("table") != trigger.table:
            return False

        # Check field filter
        if trigger.field:
            changed_fields = event_data.get("changed_fields", [])
            if trigger.field not in changed_fields:
                return False

        # Check value filter
        if trigger.value is not None:
            field_value = event_data.get("field_value")
            if field_value != trigger.value:
                return False

        return True


@pytest.fixture
def trigger_handler(stores: InMemoryStores) -> MockTriggerHandler:
    """Create a mock trigger handler."""
    return MockTriggerHandler(stores)


class TestRecordCreatedTrigger:
    """Tests for record:created trigger."""

    @pytest.mark.asyncio
    async def test_record_created_triggers_workflow(self, stores, trigger_handler):
        """Test that record creation triggers matching workflows."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="OnExpenseCreated",
            description="Triggered when expense is created",
            version="1.0.0",
            trigger=TriggerConfig(
                type=TriggerType.RECORD_CREATED,
                table="expenses",
            ),
            steps=[StepDefinition(name="process_expense")],
        )
        await stores.workflows.create(definition)

        # Trigger with matching table
        instance_ids = await trigger_handler.handle_trigger(
            trigger_type=TriggerType.RECORD_CREATED,
            event_data={
                "record_id": "rec_123",
                "fields": {"amount": 150.00, "category": "travel"},
            },
            table="expenses",
        )

        assert len(instance_ids) == 1

        instance = await stores.instances.get(instance_ids[0])
        assert instance.workflow_name == "OnExpenseCreated"
        assert instance.trigger_event["data"]["record_id"] == "rec_123"

    @pytest.mark.asyncio
    async def test_record_created_ignores_wrong_table(self, stores, trigger_handler):
        """Test that record creation ignores non-matching tables."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="OnExpenseCreated",
            description="Only expenses",
            version="1.0.0",
            trigger=TriggerConfig(
                type=TriggerType.RECORD_CREATED,
                table="expenses",
            ),
            steps=[StepDefinition(name="process")],
        )
        await stores.workflows.create(definition)

        # Trigger with different table
        instance_ids = await trigger_handler.handle_trigger(
            trigger_type=TriggerType.RECORD_CREATED,
            event_data={"record_id": "rec_456"},
            table="invoices",
        )

        assert len(instance_ids) == 0


class TestRecordUpdatedWithFieldFilter:
    """Tests for record:updated with field filter."""

    @pytest.mark.asyncio
    async def test_field_update_triggers_workflow(self, stores, trigger_handler):
        """Test that updating specific field triggers workflow."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="OnStatusChanged",
            description="Triggered when status changes",
            version="1.0.0",
            trigger=TriggerConfig(
                type=TriggerType.RECORD_UPDATED,
                table="orders",
                field="status",
            ),
            steps=[StepDefinition(name="handle_status")],
        )
        await stores.workflows.create(definition)

        # Trigger with status change
        instance_ids = await trigger_handler.handle_trigger(
            trigger_type=TriggerType.RECORD_UPDATED,
            event_data={
                "record_id": "order_123",
                "changed_fields": ["status", "updated_at"],
                "old_values": {"status": "pending"},
                "new_values": {"status": "approved"},
            },
            table="orders",
        )

        assert len(instance_ids) == 1

    @pytest.mark.asyncio
    async def test_other_field_update_ignored(self, stores, trigger_handler):
        """Test that updating other fields doesn't trigger."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="OnStatusChanged",
            description="Only status",
            version="1.0.0",
            trigger=TriggerConfig(
                type=TriggerType.RECORD_UPDATED,
                table="orders",
                field="status",
            ),
            steps=[StepDefinition(name="handle_status")],
        )
        await stores.workflows.create(definition)

        # Update different field
        instance_ids = await trigger_handler.handle_trigger(
            trigger_type=TriggerType.RECORD_UPDATED,
            event_data={
                "record_id": "order_123",
                "changed_fields": ["notes", "updated_at"],
            },
            table="orders",
        )

        assert len(instance_ids) == 0


class TestRecordUpdatedWithValueFilter:
    """Tests for record:updated with value filter."""

    @pytest.mark.asyncio
    async def test_specific_value_triggers_workflow(self, stores, trigger_handler):
        """Test that specific value change triggers workflow."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="OnApproved",
            description="Triggered when approved",
            version="1.0.0",
            trigger=TriggerConfig(
                type=TriggerType.RECORD_UPDATED,
                table="requests",
                field="status",
                value="approved",
            ),
            steps=[StepDefinition(name="on_approval")],
        )
        await stores.workflows.create(definition)

        # Trigger with approved status
        instance_ids = await trigger_handler.handle_trigger(
            trigger_type=TriggerType.RECORD_UPDATED,
            event_data={
                "record_id": "req_123",
                "changed_fields": ["status"],
                "field_value": "approved",
            },
            table="requests",
        )

        assert len(instance_ids) == 1

    @pytest.mark.asyncio
    async def test_different_value_ignored(self, stores, trigger_handler):
        """Test that different values don't trigger."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="OnApproved",
            description="Only approved",
            version="1.0.0",
            trigger=TriggerConfig(
                type=TriggerType.RECORD_UPDATED,
                table="requests",
                field="status",
                value="approved",
            ),
            steps=[StepDefinition(name="on_approval")],
        )
        await stores.workflows.create(definition)

        # Trigger with rejected status
        instance_ids = await trigger_handler.handle_trigger(
            trigger_type=TriggerType.RECORD_UPDATED,
            event_data={
                "record_id": "req_123",
                "changed_fields": ["status"],
                "field_value": "rejected",
            },
            table="requests",
        )

        assert len(instance_ids) == 0


class TestCellChangedTrigger:
    """Tests for cell:changed spreadsheet trigger."""

    @pytest.mark.asyncio
    async def test_cell_change_triggers_workflow(self, stores, trigger_handler):
        """Test that cell change triggers workflow."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="OnCellChange",
            description="Triggered on cell change",
            version="1.0.0",
            trigger=TriggerConfig(
                type=TriggerType.CELL_CHANGED,
                sheet="Budget",
            ),
            steps=[StepDefinition(name="recalculate")],
        )
        await stores.workflows.create(definition)

        instance_ids = await trigger_handler.handle_trigger(
            trigger_type=TriggerType.CELL_CHANGED,
            event_data={
                "sheet": "Budget",
                "cell": "B5",
                "old_value": 100,
                "new_value": 150,
            },
            sheet="Budget",
        )

        assert len(instance_ids) == 1

        instance = await stores.instances.get(instance_ids[0])
        assert instance.trigger_event["data"]["cell"] == "B5"

    @pytest.mark.asyncio
    async def test_cell_change_different_sheet_ignored(self, stores, trigger_handler):
        """Test that changes on other sheets are ignored."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="OnBudgetChange",
            description="Only Budget sheet",
            version="1.0.0",
            trigger=TriggerConfig(
                type=TriggerType.CELL_CHANGED,
                sheet="Budget",
            ),
            steps=[StepDefinition(name="recalculate")],
        )
        await stores.workflows.create(definition)

        instance_ids = await trigger_handler.handle_trigger(
            trigger_type=TriggerType.CELL_CHANGED,
            event_data={
                "sheet": "Summary",
                "cell": "A1",
                "new_value": "test",
            },
            sheet="Summary",
        )

        assert len(instance_ids) == 0


class TestScheduleTrigger:
    """Tests for schedule (cron) triggers."""

    @pytest.mark.asyncio
    async def test_schedule_triggers_workflow(self, stores, trigger_handler):
        """Test that schedule fires at correct time."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="DailyReport",
            description="Daily at 9 AM",
            version="1.0.0",
            trigger=TriggerConfig(
                type=TriggerType.SCHEDULE,
                cron="0 9 * * *",
                timezone="UTC",
            ),
            steps=[StepDefinition(name="generate_report")],
        )
        await stores.workflows.create(definition)

        # Simulate schedule fire
        instance_ids = await trigger_handler.handle_trigger(
            trigger_type=TriggerType.SCHEDULE,
            event_data={
                "scheduled_time": "2024-01-15T09:00:00Z",
                "cron": "0 9 * * *",
            },
        )

        assert len(instance_ids) == 1

        instance = await stores.instances.get(instance_ids[0])
        assert instance.workflow_name == "DailyReport"

    @pytest.mark.asyncio
    async def test_schedule_with_timezone(self, stores, trigger_handler):
        """Test schedule with timezone configuration."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="EndOfDayReport",
            description="5 PM Eastern",
            version="1.0.0",
            trigger=TriggerConfig(
                type=TriggerType.SCHEDULE,
                cron="0 17 * * *",
                timezone="America/New_York",
            ),
            steps=[StepDefinition(name="run")],
        )
        await stores.workflows.create(definition)

        # Verify timezone stored
        stored = await stores.workflows.get(definition.id)
        assert stored.trigger.timezone == "America/New_York"


class TestWebhookTrigger:
    """Tests for webhook triggers."""

    @pytest.mark.asyncio
    async def test_webhook_triggers_workflow(self, stores, trigger_handler):
        """Test that webhook POST triggers workflow."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="WebhookHandler",
            description="Handle webhook",
            version="1.0.0",
            trigger=TriggerConfig(
                type=TriggerType.WEBHOOK,
                path="/api/webhook/payment",
                method="POST",
            ),
            steps=[StepDefinition(name="process_webhook")],
        )
        await stores.workflows.create(definition)

        instance_ids = await trigger_handler.handle_trigger(
            trigger_type=TriggerType.WEBHOOK,
            event_data={
                "headers": {"content-type": "application/json"},
                "body": {"payment_id": "pay_123", "status": "completed"},
            },
            path="/api/webhook/payment",
        )

        assert len(instance_ids) == 1

        instance = await stores.instances.get(instance_ids[0])
        assert instance.trigger_event["data"]["body"]["payment_id"] == "pay_123"

    @pytest.mark.asyncio
    async def test_webhook_wrong_path_ignored(self, stores, trigger_handler):
        """Test that webhook to wrong path is ignored."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="PaymentWebhook",
            description="Only payment path",
            version="1.0.0",
            trigger=TriggerConfig(
                type=TriggerType.WEBHOOK,
                path="/api/webhook/payment",
            ),
            steps=[StepDefinition(name="process")],
        )
        await stores.workflows.create(definition)

        instance_ids = await trigger_handler.handle_trigger(
            trigger_type=TriggerType.WEBHOOK,
            event_data={"body": {}},
            path="/api/webhook/other",
        )

        assert len(instance_ids) == 0


class TestManualTrigger:
    """Tests for manual triggers."""

    @pytest.mark.asyncio
    async def test_manual_trigger_creates_instance(self, stores, trigger_handler):
        """Test that manual trigger creates instance."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="ManualWorkflow",
            description="Triggered manually",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="run")],
        )
        await stores.workflows.create(definition)

        instance_ids = await trigger_handler.handle_trigger(
            trigger_type=TriggerType.MANUAL,
            event_data={
                "triggered_by": "user_123",
                "input": {"param1": "value1"},
            },
        )

        assert len(instance_ids) == 1

        instance = await stores.instances.get(instance_ids[0])
        assert instance.trigger_event["data"]["triggered_by"] == "user_123"

    @pytest.mark.asyncio
    async def test_manual_trigger_with_custom_data(self, stores, trigger_handler):
        """Test manual trigger with custom input data."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="DataWorkflow",
            description="With custom data",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="process")],
        )
        await stores.workflows.create(definition)

        instance_ids = await trigger_handler.handle_trigger(
            trigger_type=TriggerType.MANUAL,
            event_data={
                "items": [1, 2, 3],
                "options": {"verbose": True, "limit": 100},
            },
        )

        instance = await stores.instances.get(instance_ids[0])
        assert instance.trigger_event["data"]["items"] == [1, 2, 3]
        assert instance.trigger_event["data"]["options"]["verbose"] is True


class TestIdempotencyKey:
    """Tests for idempotency key handling."""

    @pytest.mark.asyncio
    async def test_idempotency_key_prevents_duplicates(self, stores, trigger_handler):
        """Test that same idempotency key prevents duplicate instances."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="IdempotentWorkflow",
            description="Idempotent",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="run")],
        )
        await stores.workflows.create(definition)

        idempotency_key = f"key_{uuid.uuid4().hex[:8]}"

        # First trigger
        instance_ids_1 = await trigger_handler.handle_trigger(
            trigger_type=TriggerType.MANUAL,
            event_data={"attempt": 1},
            idempotency_key=idempotency_key,
        )

        # Second trigger with same key
        instance_ids_2 = await trigger_handler.handle_trigger(
            trigger_type=TriggerType.MANUAL,
            event_data={"attempt": 2},  # Different data
            idempotency_key=idempotency_key,
        )

        # Should return same instance
        assert instance_ids_1 == instance_ids_2
        assert len(instance_ids_1) == 1

        # Only one instance exists
        all_instances = await stores.instances.list_all()
        assert len(all_instances) == 1

    @pytest.mark.asyncio
    async def test_different_idempotency_keys_create_separate_instances(
        self, stores, trigger_handler
    ):
        """Test that different keys create separate instances."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="MultiWorkflow",
            description="Multiple instances",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="run")],
        )
        await stores.workflows.create(definition)

        keys = [f"key_{i}_{uuid.uuid4().hex[:8]}" for i in range(5)]

        for i, key in enumerate(keys):
            await trigger_handler.handle_trigger(
                trigger_type=TriggerType.MANUAL,
                event_data={"index": i},
                idempotency_key=key,
            )

        # 5 separate instances
        all_instances = await stores.instances.list_all()
        assert len(all_instances) == 5

    @pytest.mark.asyncio
    async def test_no_idempotency_key_allows_duplicates(self, stores, trigger_handler):
        """Test that without idempotency key, duplicates are allowed."""
        definition = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="DuplicateWorkflow",
            description="Allows duplicates",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="run")],
        )
        await stores.workflows.create(definition)

        # Multiple triggers without idempotency key
        for i in range(5):
            await trigger_handler.handle_trigger(
                trigger_type=TriggerType.MANUAL,
                event_data={"index": i},
                # No idempotency_key
            )

        # All 5 created
        all_instances = await stores.instances.list_all()
        assert len(all_instances) == 5


class TestMultipleWorkflowsTrigger:
    """Tests for triggering multiple workflows from one event."""

    @pytest.mark.asyncio
    async def test_event_triggers_multiple_workflows(self, stores, trigger_handler):
        """Test that one event can trigger multiple matching workflows."""
        # Two workflows watching same table
        wf1 = WorkflowDefinition(
            id=f"wf_1_{uuid.uuid4().hex[:8]}",
            name="AuditLogger",
            description="Log all changes",
            version="1.0.0",
            trigger=TriggerConfig(
                type=TriggerType.RECORD_CREATED,
                table="products",
            ),
            steps=[StepDefinition(name="log")],
        )
        wf2 = WorkflowDefinition(
            id=f"wf_2_{uuid.uuid4().hex[:8]}",
            name="NotifyTeam",
            description="Send notification",
            version="1.0.0",
            trigger=TriggerConfig(
                type=TriggerType.RECORD_CREATED,
                table="products",
            ),
            steps=[StepDefinition(name="notify")],
        )

        await stores.workflows.create(wf1)
        await stores.workflows.create(wf2)

        # One event
        instance_ids = await trigger_handler.handle_trigger(
            trigger_type=TriggerType.RECORD_CREATED,
            event_data={"record_id": "prod_123"},
            table="products",
        )

        # Both workflows triggered
        assert len(instance_ids) == 2

        names = set()
        for inst_id in instance_ids:
            inst = await stores.instances.get(inst_id)
            names.add(inst.workflow_name)

        assert names == {"AuditLogger", "NotifyTeam"}
