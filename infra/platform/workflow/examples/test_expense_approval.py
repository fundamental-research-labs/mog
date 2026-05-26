"""
Comprehensive tests for the Expense Approval workflow.

These tests validate the complete workflow architecture end-to-end:

1. Auto-approval path (small expenses)
2. Manager approval path (large expenses)
3. Manager rejection path
4. Timeout escalation to CFO
5. CFO approval
6. CFO rejection
7. CFO timeout (auto-reject)
8. Notification verification (email, toast)
9. Idempotency
10. State persistence between steps
11. Time travel for testing timeouts

This validation example proves the entire architecture works.
"""

from __future__ import annotations

import pytest
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

from workflow_engine.testing import (
    MockContext,
    WorkflowTest,
    WorkflowInstance,
    WorkflowAssertions,
    WorkflowAssertionError,
    complete,
    wait_for,
)
from workflow_engine.examples.expense_approval import ExpenseApproval


# =============================================================================
# Test Fixtures
# =============================================================================


@pytest.fixture
def sample_data() -> Dict[str, Dict[str, Dict[str, Any]]]:
    """Sample data for expense approval tests."""
    return {
        "expenses": {
            "exp_small": {
                "id": "exp_small",
                "amount": 100,
                "employee_id": "emp_alice",
                "description": "Office supplies",
                "status": "pending",
            },
            "exp_medium": {
                "id": "exp_medium",
                "amount": 300,
                "employee_id": "emp_alice",
                "description": "Software subscription",
                "status": "pending",
            },
            "exp_large": {
                "id": "exp_large",
                "amount": 1000,
                "employee_id": "emp_alice",
                "description": "Conference ticket",
                "status": "pending",
            },
            "exp_boundary": {
                "id": "exp_boundary",
                "amount": 500,
                "employee_id": "emp_alice",
                "description": "Exactly at boundary",
                "status": "pending",
            },
            "exp_just_over": {
                "id": "exp_just_over",
                "amount": 501,
                "employee_id": "emp_alice",
                "description": "Just over boundary",
                "status": "pending",
            },
            "exp_no_manager": {
                "id": "exp_no_manager",
                "amount": 1000,
                "employee_id": "emp_ceo",
                "description": "CEO expense",
                "status": "pending",
            },
        },
        "employees": {
            "emp_alice": {
                "id": "emp_alice",
                "name": "Alice Smith",
                "email": "alice@company.com",
                "manager_id": "emp_bob",
            },
            "emp_bob": {
                "id": "emp_bob",
                "name": "Bob Manager",
                "email": "bob@company.com",
                "manager_id": "emp_ceo",
            },
            "emp_ceo": {
                "id": "emp_ceo",
                "name": "Carol CEO",
                "email": "carol@company.com",
                "manager_id": None,  # No manager
            },
        },
    }


@pytest.fixture
def ctx(sample_data: Dict[str, Dict[str, Dict[str, Any]]]) -> MockContext:
    """Create MockContext with sample data."""
    return MockContext(
        initial_data=sample_data,
        initial_time=datetime(2026, 2, 4, 10, 0, 0, tzinfo=timezone.utc),
    )


@pytest.fixture
def assertions() -> WorkflowAssertions:
    """Create WorkflowAssertions."""
    return WorkflowAssertions()


# =============================================================================
# Test Helper Class
# =============================================================================


class TestExpenseApproval(WorkflowTest):
    """Test harness for ExpenseApproval workflow."""

    workflow = ExpenseApproval


# =============================================================================
# Auto-Approval Tests (< $500)
# =============================================================================


class TestAutoApproval:
    """Tests for the auto-approval path (expenses <= $500)."""

    def test_auto_approve_small_expense(
        self, ctx: MockContext, assertions: WorkflowAssertions
    ) -> None:
        """Small expenses should be auto-approved immediately."""
        test = TestExpenseApproval()

        instance = test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp_small",
            },
        )

        # Should complete immediately (auto-approve path)
        test.assert_completed(instance)

        # Verify expense was updated
        assertions.assert_record_updated(
            ctx,
            "expenses",
            "exp_small",
            field_values={"status": "approved", "approved_by": "auto"},
        )

        # Verify toast was shown to employee
        assertions.assert_toast_shown(
            ctx,
            user="emp_alice",
            message_contains="auto-approved",
        )

        # No emails should be sent for auto-approve
        assert len(ctx.emails) == 0

    def test_auto_approve_at_boundary(
        self, ctx: MockContext, assertions: WorkflowAssertions
    ) -> None:
        """Expense exactly at $500 should be auto-approved."""
        test = TestExpenseApproval()

        instance = test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp_boundary",
            },
        )

        test.assert_completed(instance)
        assertions.assert_record_updated(
            ctx, "expenses", "exp_boundary", field_values={"status": "approved"}
        )

    def test_auto_approve_step_history(self, ctx: MockContext) -> None:
        """Verify the step history for auto-approval path."""
        test = TestExpenseApproval()

        instance = test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp_small",
            },
        )

        # Should go through evaluate -> auto_approve
        test.assert_step_history(instance, ["evaluate", "auto_approve"])

    def test_auto_approve_preserves_workflow_state(self, ctx: MockContext) -> None:
        """Verify workflow state is properly maintained."""
        test = TestExpenseApproval()

        instance = test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp_small",
            },
        )

        # Verify workflow instance captured the expense
        assert instance.state.get("expense") is not None
        assert instance.state["expense"]["id"] == "exp_small"
        assert instance.state["expense"]["amount"] == 100


# =============================================================================
# Manager Approval Path Tests (> $500)
# =============================================================================


class TestManagerApprovalPath:
    """Tests for the manager approval path (expenses > $500)."""

    def test_requires_manager_approval_over_500(
        self, ctx: MockContext, assertions: WorkflowAssertions
    ) -> None:
        """Expenses just over $500 should require manager approval."""
        test = TestExpenseApproval()

        instance = test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp_just_over",
            },
        )

        # Should be waiting for approval
        test.assert_status(instance, "waiting")
        test.assert_current_step(instance, "wait_for_decision")

    def test_manager_approval_sends_email(
        self, ctx: MockContext, assertions: WorkflowAssertions
    ) -> None:
        """Manager should receive approval email with action buttons."""
        test = TestExpenseApproval()

        test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp_large",
            },
        )

        # Verify email sent to manager
        assertions.assert_email_sent(
            ctx,
            to="bob@company.com",
            subject_contains="Expense approval needed",
            count=1,
        )

        # Verify email has action buttons
        email = ctx.emails[0]
        assert email["actions"] is not None
        assert len(email["actions"]) == 2
        assert email["actions"][0]["label"] == "Approve"
        assert email["actions"][1]["label"] == "Reject"

    def test_manager_approval_updates_expense_status(
        self, ctx: MockContext, assertions: WorkflowAssertions
    ) -> None:
        """Expense status should be updated to pending_approval."""
        test = TestExpenseApproval()

        test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp_large",
            },
        )

        assertions.assert_record_updated(
            ctx,
            "expenses",
            "exp_large",
            field_values={"status": "pending_approval", "approver_id": "emp_bob"},
        )

    def test_manager_approval_notifies_employee(
        self, ctx: MockContext, assertions: WorkflowAssertions
    ) -> None:
        """Employee should be notified that approval is pending."""
        test = TestExpenseApproval()

        test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp_large",
            },
        )

        assertions.assert_toast_shown(
            ctx,
            user="emp_alice",
            message_contains="pending manager approval",
        )


# =============================================================================
# Manager Approval/Rejection Event Tests
# =============================================================================


class TestManagerDecision:
    """Tests for manager approval/rejection events."""

    def test_manager_approves(
        self, ctx: MockContext, assertions: WorkflowAssertions
    ) -> None:
        """Manager approval should complete the workflow."""
        test = TestExpenseApproval()

        instance = test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp_large",
            },
        )

        # Waiting for approval
        test.assert_status(instance, "waiting")

        # Inject approval event
        test.inject_event(instance, {"type": "expense:approved"})

        # Should be completed
        test.assert_completed(instance)

        # Verify expense approved
        assertions.assert_record_updated(
            ctx,
            "expenses",
            "exp_large",
            field_values={"status": "approved", "approved_by": "emp_bob"},
        )

        # Employee should get approval toast
        toasts = [t for t in ctx.toasts if "approved" in t.get("message", "").lower()]
        assert len(toasts) >= 1

    def test_manager_rejects(
        self, ctx: MockContext, assertions: WorkflowAssertions
    ) -> None:
        """Manager rejection should complete the workflow with rejection."""
        test = TestExpenseApproval()

        instance = test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp_large",
            },
        )

        test.assert_status(instance, "waiting")

        # Inject rejection event with reason
        test.inject_event(
            instance,
            {"type": "expense:rejected", "reason": "Not a valid business expense"},
        )

        test.assert_completed(instance)

        # Verify expense rejected
        assertions.assert_record_updated(
            ctx,
            "expenses",
            "exp_large",
            field_values={
                "status": "rejected",
                "rejection_reason": "Not a valid business expense",
            },
        )

    def test_manager_rejection_sends_email_to_employee(
        self, ctx: MockContext, assertions: WorkflowAssertions
    ) -> None:
        """Employee should receive rejection email."""
        test = TestExpenseApproval()

        instance = test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp_large",
            },
        )

        test.inject_event(
            instance, {"type": "expense:rejected", "reason": "Budget exceeded"}
        )

        # First email is to manager, second to employee on rejection
        rejection_emails = [
            e for e in ctx.emails if "rejected" in e.get("subject", "").lower()
        ]
        assert len(rejection_emails) == 1
        assert rejection_emails[0]["to"] == "alice@company.com"

    def test_manager_rejection_default_reason(
        self, ctx: MockContext, assertions: WorkflowAssertions
    ) -> None:
        """Rejection without reason should use default reason."""
        test = TestExpenseApproval()

        instance = test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp_large",
            },
        )

        # Inject rejection without explicit reason
        test.inject_event(instance, {"type": "expense:rejected"})

        assertions.assert_record_updated(
            ctx,
            "expenses",
            "exp_large",
            field_values={"rejection_reason": "Rejected by manager"},
        )


# =============================================================================
# Timeout and Escalation Tests
# =============================================================================


class TestTimeoutEscalation:
    """Tests for timeout handling and CFO escalation."""

    def test_timeout_escalates_to_cfo(
        self, ctx: MockContext, assertions: WorkflowAssertions
    ) -> None:
        """7-day timeout should escalate to CFO."""
        test = TestExpenseApproval()

        instance = test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp_large",
            },
        )

        test.assert_status(instance, "waiting")
        test.assert_current_step(instance, "wait_for_decision")

        # Advance time by 7 days to trigger timeout
        ctx.time.advance(days=7)

        # Re-trigger the waiting step with timeout (simulating engine behavior)
        # In the real engine, this would happen automatically
        test.inject_event(instance, None)  # None = timeout

        # Now should be waiting for CFO
        test.assert_status(instance, "waiting")
        test.assert_current_step(instance, "wait_for_cfo")

    def test_escalation_notifies_cfo(
        self, ctx: MockContext, assertions: WorkflowAssertions
    ) -> None:
        """CFO should receive escalation email."""
        test = TestExpenseApproval()

        instance = test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp_large",
            },
        )

        # Trigger timeout
        test.inject_event(instance, None)

        # Find CFO email
        cfo_emails = [e for e in ctx.emails if e["to"] == "cfo@company.com"]
        assert len(cfo_emails) == 1
        assert "Escalation" in cfo_emails[0]["subject"]
        assert "hasn't responded" in cfo_emails[0]["body"]

    def test_escalation_notifies_manager(
        self, ctx: MockContext, assertions: WorkflowAssertions
    ) -> None:
        """Manager should be notified of escalation."""
        test = TestExpenseApproval()

        instance = test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp_large",
            },
        )

        # Trigger timeout
        test.inject_event(instance, None)

        # Find manager escalation notification
        manager_emails = [
            e
            for e in ctx.emails
            if e["to"] == "bob@company.com" and "Escalated" in e.get("subject", "")
        ]
        assert len(manager_emails) == 1

    def test_escalation_notifies_employee(
        self, ctx: MockContext, assertions: WorkflowAssertions
    ) -> None:
        """Employee should be notified of escalation."""
        test = TestExpenseApproval()

        instance = test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp_large",
            },
        )

        # Trigger timeout
        test.inject_event(instance, None)

        # Find escalation toast
        escalation_toasts = [
            t for t in ctx.toasts if "escalated" in t.get("message", "").lower()
        ]
        assert len(escalation_toasts) >= 1

    def test_escalation_updates_expense_status(
        self, ctx: MockContext, assertions: WorkflowAssertions
    ) -> None:
        """Expense status should be updated to escalated."""
        test = TestExpenseApproval()

        instance = test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp_large",
            },
        )

        test.inject_event(instance, None)

        assertions.assert_record_updated(
            ctx, "expenses", "exp_large", field_values={"status": "escalated"}
        )


# =============================================================================
# CFO Decision Tests
# =============================================================================


class TestCFODecision:
    """Tests for CFO approval/rejection after escalation."""

    def test_cfo_approves(
        self, ctx: MockContext, assertions: WorkflowAssertions
    ) -> None:
        """CFO approval after escalation should complete workflow."""
        test = TestExpenseApproval()

        instance = test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp_large",
            },
        )

        # Timeout -> escalate
        test.inject_event(instance, None)
        test.assert_current_step(instance, "wait_for_cfo")

        # CFO approves
        test.inject_event(instance, {"type": "expense:approved"})

        test.assert_completed(instance)
        assertions.assert_record_updated(
            ctx,
            "expenses",
            "exp_large",
            field_values={"status": "approved", "approved_by": "cfo"},
        )

    def test_cfo_rejects(
        self, ctx: MockContext, assertions: WorkflowAssertions
    ) -> None:
        """CFO rejection after escalation should complete workflow."""
        test = TestExpenseApproval()

        instance = test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp_large",
            },
        )

        # Timeout -> escalate
        test.inject_event(instance, None)

        # CFO rejects
        test.inject_event(
            instance, {"type": "expense:rejected", "reason": "Company policy violation"}
        )

        test.assert_completed(instance)
        assertions.assert_record_updated(
            ctx,
            "expenses",
            "exp_large",
            field_values={
                "status": "rejected",
                "rejection_reason": "Company policy violation",
            },
        )

    def test_cfo_timeout_auto_rejects(
        self, ctx: MockContext, assertions: WorkflowAssertions
    ) -> None:
        """CFO timeout (3 days) should auto-reject."""
        test = TestExpenseApproval()

        instance = test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp_large",
            },
        )

        # Manager timeout -> escalate to CFO
        test.inject_event(instance, None)
        test.assert_current_step(instance, "wait_for_cfo")

        # CFO timeout
        test.inject_event(instance, None)

        test.assert_completed(instance)
        assertions.assert_record_updated(
            ctx,
            "expenses",
            "exp_large",
            field_values={
                "status": "rejected",
                "rejection_reason": "No response after escalation to CFO",
            },
        )


# =============================================================================
# Full Flow Time Travel Tests
# =============================================================================


class TestFullFlowWithTimeTravel:
    """End-to-end tests using time travel to simulate realistic timing."""

    def test_full_timeout_escalation_flow(
        self, ctx: MockContext, assertions: WorkflowAssertions
    ) -> None:
        """Test the complete 7d + 3d timeout flow."""
        test = TestExpenseApproval()

        instance = test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp_large",
            },
        )

        # Initially pending approval
        test.assert_status(instance, "waiting")

        # Wait 6 days - still pending
        ctx.time.advance(days=6)
        # (In real engine, workflow would still be waiting)

        # Day 7 - timeout, escalate
        ctx.time.advance(days=1)
        test.inject_event(instance, None)  # Timeout

        test.assert_current_step(instance, "wait_for_cfo")

        # Wait 2 more days
        ctx.time.advance(days=2)

        # Day 10 (7+3) - CFO timeout
        ctx.time.advance(days=1)
        test.inject_event(instance, None)  # CFO timeout

        # Should be auto-rejected
        test.assert_completed(instance)
        assertions.assert_record_updated(
            ctx, "expenses", "exp_large", field_values={"status": "rejected"}
        )


# =============================================================================
# Edge Cases and Special Scenarios
# =============================================================================


class TestEdgeCases:
    """Tests for edge cases and special scenarios."""

    def test_nonexistent_expense(self, ctx: MockContext) -> None:
        """Workflow should complete gracefully if expense doesn't exist."""
        test = TestExpenseApproval()

        instance = test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "nonexistent",
            },
        )

        test.assert_completed(instance)

    def test_nonexistent_employee(self, ctx: MockContext) -> None:
        """Workflow should complete gracefully if employee doesn't exist."""
        # Add expense with invalid employee
        ctx.records.create(
            "expenses",
            {
                "id": "exp_orphan",
                "amount": 100,
                "employee_id": "nonexistent",
            },
        )

        test = TestExpenseApproval()
        instance = test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp_orphan",
            },
        )

        test.assert_completed(instance)

    def test_employee_without_manager_auto_approves(
        self, ctx: MockContext, assertions: WorkflowAssertions
    ) -> None:
        """Employee without manager should have large expenses auto-approved."""
        test = TestExpenseApproval()

        instance = test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp_no_manager",
            },
        )

        # Should auto-approve because no manager
        test.assert_completed(instance)
        assertions.assert_record_updated(
            ctx,
            "expenses",
            "exp_no_manager",
            field_values={"status": "approved", "approved_by": "auto"},
        )

    def test_zero_amount_expense(
        self, ctx: MockContext, assertions: WorkflowAssertions
    ) -> None:
        """Zero amount expense should be auto-approved."""
        ctx.records.create(
            "expenses",
            {
                "id": "exp_zero",
                "amount": 0,
                "employee_id": "emp_alice",
            },
        )

        test = TestExpenseApproval()
        instance = test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp_zero",
            },
        )

        test.assert_completed(instance)
        assertions.assert_record_updated(
            ctx, "expenses", "exp_zero", field_values={"status": "approved"}
        )

    def test_negative_amount_expense(
        self, ctx: MockContext, assertions: WorkflowAssertions
    ) -> None:
        """Negative amount (refund) should be auto-approved."""
        ctx.records.create(
            "expenses",
            {
                "id": "exp_refund",
                "amount": -50,
                "employee_id": "emp_alice",
            },
        )

        test = TestExpenseApproval()
        instance = test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp_refund",
            },
        )

        test.assert_completed(instance)
        assertions.assert_record_updated(
            ctx, "expenses", "exp_refund", field_values={"status": "approved"}
        )


# =============================================================================
# State Persistence Tests
# =============================================================================


class TestStatePersistence:
    """Tests verifying state is properly persisted between steps."""

    def test_expense_state_persists_through_steps(self, ctx: MockContext) -> None:
        """Expense data should persist through the workflow."""
        test = TestExpenseApproval()

        instance = test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp_large",
            },
        )

        # Verify state is persisted
        assert instance.state["expense"]["id"] == "exp_large"
        assert instance.state["expense"]["amount"] == 1000
        assert instance.state["employee"]["name"] == "Alice Smith"
        assert instance.state["manager"]["name"] == "Bob Manager"

    def test_state_persists_after_timeout(self, ctx: MockContext) -> None:
        """State should persist after timeout and escalation."""
        test = TestExpenseApproval()

        instance = test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp_large",
            },
        )

        # Timeout -> escalate
        test.inject_event(instance, None)

        # State should still be there
        assert instance.state["expense"]["id"] == "exp_large"
        assert instance.state["manager"]["name"] == "Bob Manager"


# =============================================================================
# Notification Tests
# =============================================================================


class TestNotifications:
    """Detailed tests for notification behavior."""

    def test_all_notifications_for_approval_flow(
        self, ctx: MockContext, assertions: WorkflowAssertions
    ) -> None:
        """Verify all notifications in the happy path approval flow."""
        test = TestExpenseApproval()

        instance = test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp_large",
            },
        )

        # Initial: manager email + employee toast
        assert len(ctx.emails) == 1  # Manager
        assert ctx.emails[0]["to"] == "bob@company.com"

        # Employee gets pending toast
        pending_toasts = [
            t for t in ctx.toasts if "pending" in t.get("message", "").lower()
        ]
        assert len(pending_toasts) == 1

        ctx.notify.clear()

        # Approve
        test.inject_event(instance, {"type": "expense:approved"})

        # Employee gets approval toast
        approval_toasts = [
            t for t in ctx.toasts if "approved" in t.get("message", "").lower()
        ]
        assert len(approval_toasts) == 1
        assert approval_toasts[0]["user"] == "emp_alice"

    def test_all_notifications_for_rejection_flow(
        self, ctx: MockContext, assertions: WorkflowAssertions
    ) -> None:
        """Verify all notifications in the rejection flow."""
        test = TestExpenseApproval()

        instance = test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp_large",
            },
        )

        ctx.notify.clear()

        # Reject
        test.inject_event(instance, {"type": "expense:rejected", "reason": "Denied"})

        # Employee gets rejection email
        rejection_emails = [
            e for e in ctx.emails if "rejected" in e.get("subject", "").lower()
        ]
        assert len(rejection_emails) == 1
        assert "Denied" in rejection_emails[0]["body"]

        # Employee gets rejection toast
        rejection_toasts = [
            t for t in ctx.toasts if "rejected" in t.get("message", "").lower()
        ]
        assert len(rejection_toasts) == 1

    def test_escalation_notifications(
        self, ctx: MockContext, assertions: WorkflowAssertions
    ) -> None:
        """Verify all escalation notifications."""
        test = TestExpenseApproval()

        instance = test.trigger(
            ctx,
            event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp_large",
            },
        )

        initial_email_count = len(ctx.emails)
        initial_toast_count = len(ctx.toasts)

        # Timeout -> escalate
        test.inject_event(instance, None)

        # Should have 2 new emails (manager notification + CFO escalation)
        new_emails = ctx.emails[initial_email_count:]
        assert len(new_emails) == 2

        # One to manager about escalation
        manager_notification = [e for e in new_emails if e["to"] == "bob@company.com"]
        assert len(manager_notification) == 1

        # One to CFO
        cfo_notification = [e for e in new_emails if e["to"] == "cfo@company.com"]
        assert len(cfo_notification) == 1
        assert cfo_notification[0]["actions"] is not None

        # Employee gets escalation toast
        new_toasts = ctx.toasts[initial_toast_count:]
        escalation_toasts = [
            t for t in new_toasts if "escalated" in t.get("message", "").lower()
        ]
        assert len(escalation_toasts) == 1


# =============================================================================
# Idempotency Tests
# =============================================================================


class TestIdempotency:
    """Tests for workflow idempotency."""

    def test_same_event_creates_one_instance(self, ctx: MockContext) -> None:
        """
        The same event should not create duplicate workflow instances.

        Note: This tests the idempotency_key in the workflow definition.
        Full idempotency is enforced by the engine, but we verify the
        workflow is configured correctly.
        """
        from workflow_engine.decorators import get_workflow_metadata

        metadata = get_workflow_metadata(ExpenseApproval)
        assert metadata is not None
        assert metadata.idempotency_key == "event.recordId"


# =============================================================================
# Workflow Configuration Tests
# =============================================================================


class TestWorkflowConfiguration:
    """Tests verifying the workflow is configured correctly."""

    def test_workflow_trigger_configuration(self) -> None:
        """Verify workflow trigger is configured correctly."""
        from workflow_engine.decorators import get_workflow_metadata
        from workflow_engine.types import TriggerType, RuntimeType

        metadata = get_workflow_metadata(ExpenseApproval)
        assert metadata is not None
        assert metadata.trigger_type == TriggerType.RECORD_CREATED
        assert metadata.runtime == RuntimeType.AUTO
        assert metadata.version == "1.0.0"

    def test_workflow_has_all_required_steps(self) -> None:
        """Verify workflow has all required steps defined."""
        from workflow_engine.definition import WorkflowDefinition

        definition = WorkflowDefinition.from_class(ExpenseApproval)

        required_steps = [
            "evaluate",
            "auto_approve",
            "request_approval",
            "wait_for_decision",
            "escalate",
            "wait_for_cfo",
            "approve",
            "reject",
        ]

        for step_name in required_steps:
            assert step_name in definition.steps, f"Missing step: {step_name}"

    def test_wait_for_steps_have_timeouts(self) -> None:
        """Verify @wait_for steps have timeout configured."""
        from workflow_engine.definition import WorkflowDefinition

        definition = WorkflowDefinition.from_class(ExpenseApproval)

        # wait_for_decision should have 7d timeout
        wait_step = definition.get_step("wait_for_decision")
        assert wait_step is not None
        assert wait_step.wait_for is not None
        assert wait_step.wait_for.timeout is not None
        assert wait_step.wait_for.timeout.days == 7

        # wait_for_cfo should have 3d timeout
        cfo_step = definition.get_step("wait_for_cfo")
        assert cfo_step is not None
        assert cfo_step.wait_for is not None
        assert cfo_step.wait_for.timeout is not None
        assert cfo_step.wait_for.timeout.days == 3


# =============================================================================
# Run Tests
# =============================================================================


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
