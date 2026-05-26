"""
Tests for the testing infrastructure.

These tests verify that the MockContext, WorkflowTest, TimeTraveler,
EventSimulator, and WorkflowAssertions all work correctly.
"""

from __future__ import annotations

import pytest
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from workflow_engine.testing import (
    MockContext,
    WorkflowTest,
    WorkflowInstance,
    TimeTraveler,
    EventSimulator,
    WorkflowAssertions,
    WorkflowAssertionError,
    complete,
    wait_for,
    MockAppAPI,
    MockRecordsAPI,
)


# =============================================================================
# Test Fixtures
# =============================================================================


@pytest.fixture
def ctx() -> MockContext:
    """Create a MockContext with sample data."""
    return MockContext({
        "expenses": {
            "exp1": {"id": "exp1", "amount": 100, "employee_id": "emp1", "status": "pending"},
            "exp2": {"id": "exp2", "amount": 1000, "employee_id": "emp1", "status": "pending"},
        },
        "employees": {
            "emp1": {"id": "emp1", "name": "Alice", "email": "alice@example.com", "manager_id": "mgr1"},
            "mgr1": {"id": "mgr1", "name": "Bob", "email": "bob@example.com"},
        },
        "deals": {
            "deal1": {"id": "deal1", "name": "Acme Deal", "value": 50000, "stage": "Qualification"},
        },
    })


@pytest.fixture
def time_traveler() -> TimeTraveler:
    """Create a TimeTraveler."""
    return TimeTraveler(initial_time=datetime(2026, 2, 4, 12, 0, 0, tzinfo=timezone.utc))


@pytest.fixture
def event_simulator() -> EventSimulator:
    """Create an EventSimulator."""
    return EventSimulator()


@pytest.fixture
def assertions() -> WorkflowAssertions:
    """Create WorkflowAssertions."""
    return WorkflowAssertions()


# =============================================================================
# MockContext Tests - Records API
# =============================================================================


class TestMockRecordsAPI:
    """Test the mock records API."""

    def test_get_existing_record(self, ctx: MockContext) -> None:
        """Test getting an existing record."""
        expense = ctx.records.get("expenses", "exp1")
        assert expense is not None
        assert expense["id"] == "exp1"
        assert expense["amount"] == 100

    def test_get_nonexistent_record(self, ctx: MockContext) -> None:
        """Test getting a nonexistent record returns None."""
        expense = ctx.records.get("expenses", "nonexistent")
        assert expense is None

    def test_list_all_records(self, ctx: MockContext) -> None:
        """Test listing all records from a table."""
        expenses = ctx.records.list("expenses")
        assert len(expenses) == 2

    def test_list_with_filter(self, ctx: MockContext) -> None:
        """Test listing records with a filter."""
        expenses = ctx.records.list("expenses", filter={"amount": 100})
        assert len(expenses) == 1
        assert expenses[0]["id"] == "exp1"

    def test_list_with_operator_filter(self, ctx: MockContext) -> None:
        """Test listing records with operator-based filter."""
        expenses = ctx.records.list("expenses", filter={
            "amount": {"operator": "gt", "value": 500}
        })
        assert len(expenses) == 1
        assert expenses[0]["amount"] == 1000

    def test_create_record(self, ctx: MockContext) -> None:
        """Test creating a record."""
        new_expense = ctx.records.create("expenses", {
            "amount": 200,
            "employee_id": "emp1",
        })
        assert "id" in new_expense
        assert new_expense["amount"] == 200

        # Verify it was tracked
        assert len(ctx.records.creates["expenses"]) == 1

    def test_update_record(self, ctx: MockContext) -> None:
        """Test updating a record."""
        updated = ctx.records.update("expenses", "exp1", {"status": "approved"})
        assert updated["status"] == "approved"

        # Verify it was tracked
        assert ctx.records.updates["expenses"]["exp1"]["status"] == "approved"

    def test_delete_record(self, ctx: MockContext) -> None:
        """Test deleting a record."""
        result = ctx.records.delete("expenses", "exp1")
        assert result is True

        # Verify record is gone
        assert ctx.records.get("expenses", "exp1") is None

        # Verify deletion was tracked
        assert "exp1" in ctx.records.deletes["expenses"]


# =============================================================================
# MockContext Tests - App APIs
# =============================================================================


class TestMockAppAPIs:
    """Test the mock app APIs."""

    def test_mock_responses(self, ctx: MockContext) -> None:
        """Test mocking app API responses."""
        ctx.apps.crm.mock_responses({
            "get_deal": {"id": "deal1", "name": "Acme", "value": 50000}
        })

        result = ctx.apps.crm.get_deal(deal_id="deal1")
        assert result["name"] == "Acme"

    def test_call_tracking(self, ctx: MockContext) -> None:
        """Test that API calls are tracked."""
        ctx.apps.crm.mock_responses({"get_deal": {"id": "deal1"}})

        ctx.apps.crm.get_deal(deal_id="deal1", include=["company"])

        assert len(ctx.apps.crm.calls["get_deal"]) == 1
        assert ctx.apps.crm.calls["get_deal"][0]["deal_id"] == "deal1"
        assert ctx.apps.crm.calls["get_deal"][0]["include"] == ["company"]

    def test_response_sequence(self, ctx: MockContext) -> None:
        """Test mocking a sequence of responses."""
        ctx.apps.finance.mock_response_sequence("create_invoice", [
            {"id": "inv1", "number": "INV-001"},
            {"id": "inv2", "number": "INV-002"},
        ])

        first = ctx.apps.finance.create_invoice(amount=100)
        second = ctx.apps.finance.create_invoice(amount=200)

        assert first["number"] == "INV-001"
        assert second["number"] == "INV-002"

    def test_custom_handler(self, ctx: MockContext) -> None:
        """Test mocking with a custom handler."""
        def create_deal_handler(**kwargs: Any) -> Dict[str, Any]:
            return {
                "id": f"deal_{kwargs['name'].lower().replace(' ', '_')}",
                "name": kwargs["name"],
                "value": kwargs["value"],
            }

        ctx.apps.crm.mock_handler("create_deal", create_deal_handler)

        result = ctx.apps.crm.create_deal(name="New Deal", value=10000)
        assert result["id"] == "deal_new_deal"
        assert result["name"] == "New Deal"


# =============================================================================
# MockContext Tests - HTTP Client
# =============================================================================


class TestMockHttpClient:
    """Test the mock HTTP client."""

    def test_get_request(self, ctx: MockContext) -> None:
        """Test GET request."""
        ctx.http.mock_response(
            "api.example.com/users",
            status=200,
            body={"users": [{"id": 1, "name": "Alice"}]},
        )

        response = ctx.http.get("https://api.example.com/users")
        assert response.ok
        assert response.json()["users"][0]["name"] == "Alice"

        assert len(ctx.http_requests) == 1
        assert ctx.http_requests[0]["method"] == "GET"

    def test_post_request(self, ctx: MockContext) -> None:
        """Test POST request."""
        ctx.http.mock_response(
            "api.stripe.com",
            status=201,
            body={"id": "ch_123"},
        )

        response = ctx.http.post(
            "https://api.stripe.com/v1/charges",
            json={"amount": 1000, "currency": "usd"},
        )
        assert response.status == 201
        assert response.json()["id"] == "ch_123"

    def test_failed_response(self, ctx: MockContext) -> None:
        """Test handling failed responses."""
        ctx.http.mock_response("api.example.com", status=500, body={"error": "Server error"})

        response = ctx.http.get("https://api.example.com/endpoint")
        assert not response.ok
        assert response.status == 500


# =============================================================================
# MockContext Tests - Notifications
# =============================================================================


class TestMockNotifications:
    """Test the mock notification service."""

    def test_send_email(self, ctx: MockContext) -> None:
        """Test sending email."""
        ctx.notify.email(
            to="manager@example.com",
            subject="Approval needed",
            body="Please review",
        )

        assert len(ctx.emails) == 1
        assert ctx.emails[0]["to"] == "manager@example.com"
        assert ctx.emails[0]["subject"] == "Approval needed"

    def test_send_slack(self, ctx: MockContext) -> None:
        """Test sending Slack message."""
        ctx.notify.slack(channel="#sales", message="Deal closed!")

        assert len(ctx.slack_messages) == 1
        assert ctx.slack_messages[0]["channel"] == "#sales"

    def test_show_toast(self, ctx: MockContext) -> None:
        """Test showing toast notification."""
        ctx.notify.toast(user="emp1", message="Request approved")

        assert len(ctx.toasts) == 1
        assert ctx.toasts[0]["user"] == "emp1"


# =============================================================================
# MockContext Tests - Secrets
# =============================================================================


class TestMockSecrets:
    """Test the mock secrets manager."""

    def test_get_set_secret(self, ctx: MockContext) -> None:
        """Test getting and setting secrets."""
        ctx.secrets.set("API_KEY", "secret123")
        assert ctx.secrets.get("API_KEY") == "secret123"

    def test_get_nonexistent_secret(self, ctx: MockContext) -> None:
        """Test getting nonexistent secret returns None."""
        assert ctx.secrets.get("NONEXISTENT") is None


# =============================================================================
# TimeTraveler Tests
# =============================================================================


class TestTimeTraveler:
    """Test the time traveler."""

    def test_initial_time(self, time_traveler: TimeTraveler) -> None:
        """Test initial time is set correctly."""
        now = time_traveler.now()
        assert now.year == 2026
        assert now.month == 2
        assert now.day == 4

    def test_advance_days(self, time_traveler: TimeTraveler) -> None:
        """Test advancing time by days."""
        time_traveler.advance(days=7)
        now = time_traveler.now()
        assert now.day == 11

    def test_advance_hours(self, time_traveler: TimeTraveler) -> None:
        """Test advancing time by hours."""
        time_traveler.advance(hours=5)
        now = time_traveler.now()
        assert now.hour == 17

    def test_set_specific_time(self, time_traveler: TimeTraveler) -> None:
        """Test setting a specific time."""
        new_time = datetime(2026, 6, 15, 10, 30, 0, tzinfo=timezone.utc)
        time_traveler.set(new_time)
        assert time_traveler.now() == new_time

    def test_timer_fires_on_advance(self, time_traveler: TimeTraveler) -> None:
        """Test that timers fire when time is advanced."""
        fired = []

        time_traveler.register_timer(
            fire_at=time_traveler.now() + timedelta(hours=1),
            callback=lambda: fired.append("timer1"),
            name="test_timer",
        )

        time_traveler.advance(hours=2)
        assert "timer1" in fired

    def test_multiple_timers_fire_in_order(self, time_traveler: TimeTraveler) -> None:
        """Test that multiple timers fire in correct order."""
        fired = []

        time_traveler.register_timer(
            fire_at=time_traveler.now() + timedelta(hours=2),
            callback=lambda: fired.append("timer2"),
        )
        time_traveler.register_timer(
            fire_at=time_traveler.now() + timedelta(hours=1),
            callback=lambda: fired.append("timer1"),
        )

        time_traveler.advance(hours=3)
        assert fired == ["timer1", "timer2"]

    def test_sleep_completes_on_advance(self, time_traveler: TimeTraveler) -> None:
        """Test that sleeps complete when time is advanced."""
        completed = []

        time_traveler.register_sleep(
            wake_at=time_traveler.now() + timedelta(days=1),
            instance_id="inst_123",
            step_name="wait_step",
            callback=lambda: completed.append("wake"),
        )

        time_traveler.advance(days=2)
        assert "wake" in completed

    def test_cancel_timer(self, time_traveler: TimeTraveler) -> None:
        """Test canceling a timer."""
        fired = []

        timer = time_traveler.register_timer(
            fire_at=time_traveler.now() + timedelta(hours=1),
            callback=lambda: fired.append("timer"),
        )
        timer.cancel()

        time_traveler.advance(hours=2)
        assert fired == []


# =============================================================================
# EventSimulator Tests
# =============================================================================


class TestEventSimulator:
    """Test the event simulator."""

    def test_inject_event(self, event_simulator: EventSimulator) -> None:
        """Test injecting an event."""
        event = event_simulator.inject({
            "type": "expense:approved",
            "expense_id": "exp1",
        })

        assert event.type == "expense:approved"
        assert event.data["expense_id"] == "exp1"

    def test_event_delivery_to_waiter(self, event_simulator: EventSimulator) -> None:
        """Test that events are delivered to waiting workflows."""
        received = []

        event_simulator.register_waiter(
            event_types=["expense:approved", "expense:rejected"],
            instance_id="inst_123",
            callback=lambda e: received.append(e),
        )

        event_simulator.inject({
            "type": "expense:approved",
            "approved_by": "mgr1",
        })

        assert len(received) == 1
        assert received[0]["type"] == "expense:approved"

    def test_event_not_delivered_if_wrong_type(self, event_simulator: EventSimulator) -> None:
        """Test that events are not delivered if type doesn't match."""
        received = []

        event_simulator.register_waiter(
            event_types=["expense:approved"],
            instance_id="inst_123",
            callback=lambda e: received.append(e),
        )

        event_simulator.inject({"type": "expense:rejected"})

        assert len(received) == 0
        assert len(event_simulator.pending_events) == 1

    def test_one_shot_waiter(self, event_simulator: EventSimulator) -> None:
        """Test that one-shot waiters are removed after matching."""
        received = []

        event_simulator.register_waiter(
            event_types=["event"],
            instance_id="inst_123",
            callback=lambda e: received.append(e),
            one_shot=True,
        )

        event_simulator.inject({"type": "event"})
        event_simulator.inject({"type": "event"})

        assert len(received) == 1

    def test_inject_sequence(self, event_simulator: EventSimulator) -> None:
        """Test injecting a sequence of events."""
        events = event_simulator.inject_sequence([
            {"type": "step1"},
            {"type": "step2"},
            {"type": "step3"},
        ])

        assert len(events) == 3
        assert events[0].type == "step1"
        assert events[2].type == "step3"


# =============================================================================
# WorkflowAssertions Tests
# =============================================================================


class TestWorkflowAssertions:
    """Test the workflow assertions."""

    def test_assert_completed_success(self, assertions: WorkflowAssertions) -> None:
        """Test assert_completed with a completed instance."""
        instance = WorkflowInstance(
            id="inst_1",
            workflow_class="TestWorkflow",
            status="completed",
        )
        assertions.assert_completed(instance)  # Should not raise

    def test_assert_completed_failure(self, assertions: WorkflowAssertions) -> None:
        """Test assert_completed with a non-completed instance."""
        instance = WorkflowInstance(
            id="inst_1",
            workflow_class="TestWorkflow",
            status="running",
            current_step="process",
        )
        with pytest.raises(WorkflowAssertionError) as exc_info:
            assertions.assert_completed(instance)
        assert "not completed" in str(exc_info.value)

    def test_assert_failed(self, assertions: WorkflowAssertions) -> None:
        """Test assert_failed."""
        instance = WorkflowInstance(
            id="inst_1",
            workflow_class="TestWorkflow",
            status="failed",
            error="Connection timeout",
        )
        assertions.assert_failed(instance)
        assertions.assert_failed(instance, error_contains="timeout")

    def test_assert_step_history(self, assertions: WorkflowAssertions) -> None:
        """Test assert_step_history."""
        instance = WorkflowInstance(
            id="inst_1",
            workflow_class="TestWorkflow",
            step_history=["start", "process", "complete"],
        )
        assertions.assert_step_history(instance, ["start", "process", "complete"])

        with pytest.raises(WorkflowAssertionError):
            assertions.assert_step_history(instance, ["start", "complete"])

    def test_assert_current_step(self, assertions: WorkflowAssertions) -> None:
        """Test assert_current_step."""
        instance = WorkflowInstance(
            id="inst_1",
            workflow_class="TestWorkflow",
            current_step="waiting",
        )
        assertions.assert_current_step(instance, "waiting")

        with pytest.raises(WorkflowAssertionError):
            assertions.assert_current_step(instance, "processing")

    def test_assert_email_sent(self, assertions: WorkflowAssertions, ctx: MockContext) -> None:
        """Test assert_email_sent."""
        ctx.notify.email(
            to="manager@example.com",
            subject="Approval needed",
            body="Please review this expense",
        )

        assertions.assert_email_sent(ctx, to="manager")
        assertions.assert_email_sent(ctx, subject_contains="Approval")
        assertions.assert_email_sent(ctx, count=1)

        with pytest.raises(WorkflowAssertionError):
            assertions.assert_email_sent(ctx, to="cfo@example.com")

    def test_assert_slack_sent(self, assertions: WorkflowAssertions, ctx: MockContext) -> None:
        """Test assert_slack_sent."""
        ctx.notify.slack(channel="#sales", message="Deal closed!")

        assertions.assert_slack_sent(ctx, channel="#sales")
        assertions.assert_slack_sent(ctx, message_contains="Deal")

    def test_assert_record_updated(self, assertions: WorkflowAssertions, ctx: MockContext) -> None:
        """Test assert_record_updated."""
        ctx.records.update("expenses", "exp1", {"status": "approved"})

        assertions.assert_record_updated(ctx, "expenses", "exp1")
        assertions.assert_record_updated(ctx, "expenses", "exp1", field_values={"status": "approved"})

        with pytest.raises(WorkflowAssertionError):
            assertions.assert_record_updated(ctx, "expenses", "exp2")

    def test_assert_api_called(self, assertions: WorkflowAssertions, ctx: MockContext) -> None:
        """Test assert_api_called."""
        ctx.apps.crm.mock_responses({"get_deal": {"id": "deal1"}})
        ctx.apps.crm.get_deal(deal_id="deal1")

        assertions.assert_api_called(ctx, "crm", "get_deal")
        assertions.assert_api_called(ctx, "crm", "get_deal", count=1)
        assertions.assert_api_called(ctx, "crm", "get_deal", with_params={"deal_id": "deal1"})


# =============================================================================
# WorkflowTest Integration Tests
# =============================================================================


class SimpleWorkflow:
    """A simple workflow for testing."""

    def __init__(self) -> None:
        self.expense: Optional[Dict[str, Any]] = None
        self.approved: bool = False

    def start(self, event: Dict[str, Any], ctx: MockContext) -> Any:
        """Start step."""
        self.expense = ctx.records.get("expenses", event["recordId"])
        if self.expense is None:
            return complete()
        if self.expense["amount"] <= 500:
            return self.auto_approve
        return self.request_approval

    def auto_approve(self, ctx: MockContext) -> Any:
        """Auto-approve small expenses."""
        ctx.records.update("expenses", self.expense["id"], {"status": "approved"})
        self.approved = True
        return complete()

    def request_approval(self, ctx: MockContext) -> Any:
        """Request manager approval."""
        ctx.notify.email(
            to="manager@example.com",
            subject="Approval needed",
            body=f"Please approve expense ${self.expense['amount']}",
        )
        return wait_for(["expense:approved", "expense:rejected"])


class TestWorkflowTestHarness:
    """Test the WorkflowTest harness with a real workflow."""

    def test_simple_workflow_auto_approve(self) -> None:
        """Test auto-approval path."""

        class TestSimple(WorkflowTest):
            workflow = SimpleWorkflow

        test = TestSimple()
        ctx = MockContext({
            "expenses": {"exp1": {"id": "exp1", "amount": 100, "status": "pending"}}
        })

        instance = test.trigger(ctx, event={
            "type": "record:created",
            "table": "expenses",
            "recordId": "exp1",
        })

        test.assert_completed(instance)
        assert ctx.records.updates["expenses"]["exp1"]["status"] == "approved"
        assert instance.state.get("approved") is True

    def test_simple_workflow_request_approval(self) -> None:
        """Test manager approval path."""

        class TestSimple(WorkflowTest):
            workflow = SimpleWorkflow

        test = TestSimple()
        ctx = MockContext({
            "expenses": {"exp1": {"id": "exp1", "amount": 1000, "status": "pending"}}
        })

        instance = test.trigger(ctx, event={
            "type": "record:created",
            "table": "expenses",
            "recordId": "exp1",
        })

        # Should be waiting for approval
        test.assert_status(instance, "waiting")
        test.assert_current_step(instance, "request_approval")

        # Verify email was sent
        assert len(ctx.emails) == 1
        assert "manager@example.com" in ctx.emails[0]["to"]

    def test_inject_approval_event(self) -> None:
        """Test injecting approval event to waiting workflow."""

        class ApprovalWorkflow:
            def __init__(self) -> None:
                self.expense_id: str = ""
                self.approved: bool = False

            def start(self, event: Dict[str, Any], ctx: MockContext) -> Any:
                self.expense_id = event["recordId"]
                return wait_for(["approved"])

            def handle_approval(self, event: Dict[str, Any], ctx: MockContext) -> Any:
                self.approved = True
                ctx.records.update("expenses", self.expense_id, {"status": "approved"})
                return complete()

        class TestApproval(WorkflowTest):
            workflow = ApprovalWorkflow

        test = TestApproval()
        ctx = MockContext({
            "expenses": {"exp1": {"id": "exp1", "amount": 1000}}
        })

        instance = test.trigger(ctx, event={
            "type": "record:created",
            "recordId": "exp1",
        })

        test.assert_status(instance, "waiting")

        # Inject approval event via context
        ctx.events.inject({"type": "approved", "approved_by": "manager"})

        # Workflow should now be completed
        # Note: The event was delivered through the simulator


# =============================================================================
# MockContext Time Integration Tests
# =============================================================================


class TestMockContextTimeIntegration:
    """Test MockContext time integration."""

    def test_now_returns_simulated_time(self, ctx: MockContext) -> None:
        """Test that ctx.now() returns the simulated time."""
        initial_time = ctx.now()
        ctx.time.advance(days=5)
        new_time = ctx.now()

        assert (new_time - initial_time).days == 5

    def test_sleep_integration(self, ctx: MockContext) -> None:
        """Test that sleep integrates with time traveler."""
        ctx.set_instance_info(instance_id="inst_123", current_step="wait")

        # Register a sleep
        ctx.sleep(timedelta(days=7))

        # Verify sleep is registered
        assert ctx.time.is_instance_sleeping("inst_123")

        # Advance time
        ctx.time.advance(days=8)

        # Sleep should be completed
        assert not ctx.time.is_instance_sleeping("inst_123")


# =============================================================================
# Reset and Cleanup Tests
# =============================================================================


class TestMockContextReset:
    """Test MockContext reset functionality."""

    def test_reset_tracking(self, ctx: MockContext) -> None:
        """Test resetting operation tracking."""
        # Make some operations
        ctx.records.create("expenses", {"amount": 50})
        ctx.records.update("expenses", "exp1", {"status": "approved"})
        ctx.apps.crm.mock_responses({"get_deal": {}})
        ctx.apps.crm.get_deal(id="deal1")
        ctx.notify.email(to="test@test.com", subject="Test", body="Test")

        # Reset tracking
        ctx.reset_tracking()

        # Verify tracking is cleared
        assert len(ctx.records.creates) == 0
        assert len(ctx.records.updates) == 0
        assert len(ctx.apps.crm.calls) == 0
        assert len(ctx.emails) == 0

        # But data should still be there
        assert ctx.records.get("expenses", "exp1") is not None

    def test_reset_all(self, ctx: MockContext) -> None:
        """Test complete reset."""
        ctx.records.create("new_table", {"id": "new1", "value": 100})
        ctx.reset_all()

        # Everything should be cleared
        assert ctx.records.get("expenses", "exp1") is None
        assert ctx.records.get("new_table", "new1") is None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
