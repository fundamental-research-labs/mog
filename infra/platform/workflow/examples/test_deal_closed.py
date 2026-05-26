"""
Comprehensive tests for the Deal Closed Workflow.

These tests demonstrate the testing patterns for cross-app workflows,
including:
- Mocking app APIs (CRM, Finance, Analytics, Spreadsheet)
- Verifying cross-app orchestration
- Testing error handling and edge cases
- Verifying notifications
"""

from __future__ import annotations

import pytest
from datetime import datetime, timezone
from typing import Any, Dict

import sys
from pathlib import Path

# Add parent src to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from workflow_engine.testing import (
    MockContext,
    WorkflowTest,
    WorkflowAssertions,
    WorkflowAssertionError,
    complete,
)

from deal_closed import DealClosedWorkflow, DealClosedWithOnboardingWorkflow


# =============================================================================
# Test Fixtures
# =============================================================================


@pytest.fixture
def sample_deal() -> Dict[str, Any]:
    """Create a sample deal with all related data."""
    return {
        "id": "deal1",
        "name": "Acme Enterprise Contract",
        "value": 50000,
        "stage": "Won",
        "company": {
            "id": "comp1",
            "name": "Acme Corp",
            "segment": "enterprise",
        },
        "contacts": [
            {
                "id": "contact1",
                "name": "Jane Doe",
                "email": "jane@acme.com",
            },
            {
                "id": "contact2",
                "name": "John Smith",
                "email": "john@acme.com",
            },
        ],
        "owner": {
            "id": "user1",
            "name": "Alice Sales",
            "email": "alice@ourcompany.com",
        },
    }


@pytest.fixture
def sample_invoice() -> Dict[str, Any]:
    """Create a sample invoice response."""
    return {
        "id": "inv1",
        "number": "INV-2026-001",
        "amount": 50000,
        "customer_id": "comp1",
        "status": "draft",
    }


@pytest.fixture
def ctx(sample_deal: Dict[str, Any], sample_invoice: Dict[str, Any]) -> MockContext:
    """Create a MockContext with sample data and mocked responses."""
    context = MockContext(
        {
            "deals": {"deal1": sample_deal},
            "companies": {"comp1": sample_deal["company"]},
            "contacts": {
                "contact1": sample_deal["contacts"][0],
                "contact2": sample_deal["contacts"][1],
            },
        },
        initial_time=datetime(2026, 2, 4, 10, 0, 0, tzinfo=timezone.utc),
    )

    # Mock CRM app responses
    context.apps.crm.mock_responses({
        "get_deal": sample_deal,
    })

    # Mock Finance app responses
    context.apps.finance.mock_responses({
        "create_invoice": sample_invoice,
    })

    # Mock Spreadsheet app responses
    context.apps.spreadsheet.mock_responses({
        "append_row": 42,  # Returns row number
    })

    # Mock Analytics (returns None, just tracks metrics)
    context.apps.analytics.mock_responses({
        "increment_metric": None,
    })

    return context


# =============================================================================
# Test Class for DealClosedWorkflow
# =============================================================================


class TestDealClosedWorkflow(WorkflowTest):
    """Test the DealClosedWorkflow."""

    workflow = DealClosedWorkflow

    def test_full_flow_success(self, ctx: MockContext, sample_deal: Dict[str, Any]) -> None:
        """Test the complete happy path workflow."""
        instance = self.trigger(ctx, event={
            "type": "record:updated",
            "table": "deals",
            "recordId": "deal1",
            "field": "stage",
            "value": "Won",
        })

        # Verify workflow completed
        self.assert_completed(instance)

        # Verify CRM API was called
        assert len(ctx.apps.crm.calls["get_deal"]) == 1
        assert ctx.apps.crm.calls["get_deal"][0]["deal_id"] == "deal1"
        assert ctx.apps.crm.calls["get_deal"][0]["include"] == ["company", "contacts", "owner"]

        # Verify Finance API was called to create invoice
        assert len(ctx.apps.finance.calls["create_invoice"]) == 1
        invoice_call = ctx.apps.finance.calls["create_invoice"][0]
        assert invoice_call["customer_id"] == "comp1"
        assert invoice_call["line_items"][0]["amount"] == 50000
        assert invoice_call["due_days"] == 30
        assert invoice_call["source_deal_id"] == "deal1"

        # Verify Analytics API was called
        assert len(ctx.apps.analytics.calls["increment_metric"]) == 2

        # First call: closed_revenue
        revenue_call = ctx.apps.analytics.calls["increment_metric"][0]
        assert revenue_call["name"] == "closed_revenue"
        assert revenue_call["value"] == 50000
        assert revenue_call["dimensions"]["rep"] == "alice@ourcompany.com"
        assert revenue_call["dimensions"]["segment"] == "enterprise"
        assert "Q1 2026" in revenue_call["dimensions"]["quarter"]

        # Second call: deals_closed
        count_call = ctx.apps.analytics.calls["increment_metric"][1]
        assert count_call["name"] == "deals_closed"
        assert count_call["value"] == 1

        # Verify Spreadsheet API was called
        assert len(ctx.apps.spreadsheet.calls["append_row"]) == 1
        spreadsheet_call = ctx.apps.spreadsheet.calls["append_row"][0]
        assert spreadsheet_call["sheet"] == "Closed Deals Log"
        values = spreadsheet_call["values"]
        assert "Acme Corp" in values
        assert "Acme Enterprise Contract" in values
        assert 50000 in values
        assert "Alice Sales" in values
        assert "INV-2026-001" in values

        # Verify Slack notification was sent to #wins
        assert len(ctx.slack_messages) == 1
        slack_msg = ctx.slack_messages[0]
        assert slack_msg["channel"] == "#wins"
        assert "Alice Sales" in slack_msg["message"]
        assert "Acme Corp" in slack_msg["message"]
        assert "50,000" in slack_msg["message"]

        # Verify toast notification was sent to deal owner
        assert len(ctx.toasts) == 1
        toast = ctx.toasts[0]
        assert toast["user"] == "user1"
        assert "INV-2026-001" in toast["message"]
        assert "Acme Corp" in toast["message"]

    def test_deal_not_found(self, ctx: MockContext) -> None:
        """Test handling when deal is not found."""
        # Mock CRM to return None
        ctx.apps.crm.mock_responses({"get_deal": None})

        instance = self.trigger(ctx, event={
            "type": "record:updated",
            "table": "deals",
            "recordId": "nonexistent",
        })

        self.assert_completed(instance)

        # Verify toast was shown
        assert len(ctx.toasts) == 1
        assert "not found" in ctx.toasts[0]["message"]

        # Verify no invoice was created
        assert "create_invoice" not in ctx.apps.finance.calls or \
               len(ctx.apps.finance.calls.get("create_invoice", [])) == 0

    def test_deal_without_company(self, ctx: MockContext, sample_deal: Dict[str, Any]) -> None:
        """Test handling when deal has no company."""
        # Remove company from deal
        deal_no_company = {**sample_deal, "company": None}
        ctx.apps.crm.mock_responses({"get_deal": deal_no_company})

        instance = self.trigger(ctx, event={
            "type": "record:updated",
            "table": "deals",
            "recordId": "deal1",
        })

        self.assert_completed(instance)

        # Verify toast about missing company
        assert len(ctx.toasts) >= 1
        assert any("no company" in t["message"] for t in ctx.toasts)

        # Verify notifications were still sent (skipped invoice)
        assert len(ctx.slack_messages) == 1

    def test_deal_without_owner(self, ctx: MockContext, sample_deal: Dict[str, Any]) -> None:
        """Test handling when deal has no owner."""
        # Remove owner from deal
        deal_no_owner = {**sample_deal, "owner": None}
        ctx.apps.crm.mock_responses({"get_deal": deal_no_owner})

        instance = self.trigger(ctx, event={
            "type": "record:updated",
            "table": "deals",
            "recordId": "deal1",
        })

        self.assert_completed(instance)

        # Verify workflow still completes
        # Analytics should use "unknown" for rep
        analytics_calls = ctx.apps.analytics.calls.get("increment_metric", [])
        assert len(analytics_calls) >= 1
        assert analytics_calls[0]["dimensions"]["rep"] == "unknown"

        # Slack should still be sent
        assert len(ctx.slack_messages) == 1

        # No toast to owner
        assert len(ctx.toasts) == 0

    def test_step_history(self, ctx: MockContext) -> None:
        """Test that steps execute in correct order."""
        instance = self.trigger(ctx, event={
            "type": "record:updated",
            "table": "deals",
            "recordId": "deal1",
        })

        self.assert_completed(instance)
        self.assert_step_history(instance, [
            "start",
            "create_invoice",
            "update_analytics",
            "log_to_spreadsheet",
            "notify_team",
        ])

    def test_workflow_state(self, ctx: MockContext, sample_deal: Dict[str, Any], sample_invoice: Dict[str, Any]) -> None:
        """Test that workflow state is correctly maintained."""
        instance = self.trigger(ctx, event={
            "type": "record:updated",
            "table": "deals",
            "recordId": "deal1",
        })

        self.assert_completed(instance)

        # Verify state was captured
        assert instance.state.get("deal") == sample_deal
        assert instance.state.get("invoice") == sample_invoice
        assert instance.state.get("row_number") == 42

    def test_different_quarters(self) -> None:
        """Test quarter calculation for different dates."""
        workflow = DealClosedWorkflow()

        # Test all quarters
        q1 = datetime(2026, 2, 15)
        q2 = datetime(2026, 5, 15)
        q3 = datetime(2026, 8, 15)
        q4 = datetime(2026, 11, 15)

        assert workflow._get_quarter(q1) == "Q1 2026"
        assert workflow._get_quarter(q2) == "Q2 2026"
        assert workflow._get_quarter(q3) == "Q3 2026"
        assert workflow._get_quarter(q4) == "Q4 2026"


# =============================================================================
# Test Class for DealClosedWithOnboardingWorkflow
# =============================================================================


class TestDealClosedWithOnboardingWorkflow(WorkflowTest):
    """Test the extended workflow that spawns onboarding."""

    workflow = DealClosedWithOnboardingWorkflow

    def test_spawns_onboarding_workflow(self, ctx: MockContext, sample_deal: Dict[str, Any]) -> None:
        """Test that onboarding workflow is spawned."""
        instance = self.trigger(ctx, event={
            "type": "record:updated",
            "table": "deals",
            "recordId": "deal1",
        })

        self.assert_completed(instance)

        # Verify child workflow was spawned
        assert len(ctx.spawned_workflows) == 1
        spawned = ctx.spawned_workflows[0]
        assert spawned["input"]["deal_id"] == "deal1"
        assert spawned["input"]["company_id"] == "comp1"
        assert spawned["input"]["primary_contact_email"] == "jane@acme.com"

    def test_spawns_with_missing_contacts(self, ctx: MockContext, sample_deal: Dict[str, Any]) -> None:
        """Test spawning when deal has no contacts."""
        deal_no_contacts = {**sample_deal, "contacts": []}
        ctx.apps.crm.mock_responses({"get_deal": deal_no_contacts})

        instance = self.trigger(ctx, event={
            "type": "record:updated",
            "table": "deals",
            "recordId": "deal1",
        })

        self.assert_completed(instance)

        # Verify onboarding spawned with None for contact
        assert len(ctx.spawned_workflows) == 1
        assert ctx.spawned_workflows[0]["input"]["primary_contact_email"] is None


# =============================================================================
# Integration Tests - Cross-App Verification
# =============================================================================


class TestCrossAppIntegration(WorkflowTest):
    """Test cross-app data consistency."""

    workflow = DealClosedWorkflow

    def test_invoice_matches_deal_value(self, ctx: MockContext, sample_deal: Dict[str, Any]) -> None:
        """Verify invoice amount matches deal value."""
        instance = self.trigger(ctx, event={
            "type": "record:updated",
            "table": "deals",
            "recordId": "deal1",
        })

        self.assert_completed(instance)

        # Get the invoice call
        invoice_call = ctx.apps.finance.calls["create_invoice"][0]

        # Verify amounts match
        assert invoice_call["line_items"][0]["amount"] == sample_deal["value"]

    def test_analytics_metrics_match_deal(self, ctx: MockContext, sample_deal: Dict[str, Any]) -> None:
        """Verify analytics metrics match deal data."""
        instance = self.trigger(ctx, event={
            "type": "record:updated",
            "table": "deals",
            "recordId": "deal1",
        })

        self.assert_completed(instance)

        # Get analytics calls
        metrics = ctx.apps.analytics.calls["increment_metric"]

        # Find revenue metric
        revenue_metric = next(m for m in metrics if m["name"] == "closed_revenue")

        # Verify data matches
        assert revenue_metric["value"] == sample_deal["value"]
        assert revenue_metric["dimensions"]["rep"] == sample_deal["owner"]["email"]
        assert revenue_metric["dimensions"]["segment"] == sample_deal["company"]["segment"]

    def test_spreadsheet_row_contains_all_data(self, ctx: MockContext, sample_deal: Dict[str, Any]) -> None:
        """Verify spreadsheet row contains all relevant data."""
        instance = self.trigger(ctx, event={
            "type": "record:updated",
            "table": "deals",
            "recordId": "deal1",
        })

        self.assert_completed(instance)

        # Get spreadsheet call
        row_call = ctx.apps.spreadsheet.calls["append_row"][0]
        values = row_call["values"]

        # Verify all expected data is present
        assert sample_deal["company"]["name"] in values
        assert sample_deal["name"] in values
        assert sample_deal["value"] in values
        assert sample_deal["owner"]["name"] in values


# =============================================================================
# Edge Cases and Error Handling
# =============================================================================


class TestEdgeCases(WorkflowTest):
    """Test edge cases and unusual scenarios."""

    workflow = DealClosedWorkflow

    def test_zero_value_deal(self, ctx: MockContext, sample_deal: Dict[str, Any]) -> None:
        """Test handling a $0 deal."""
        zero_deal = {**sample_deal, "value": 0}
        ctx.apps.crm.mock_responses({"get_deal": zero_deal})

        instance = self.trigger(ctx, event={
            "type": "record:updated",
            "table": "deals",
            "recordId": "deal1",
        })

        self.assert_completed(instance)

        # Invoice should still be created
        assert len(ctx.apps.finance.calls.get("create_invoice", [])) == 1

        # Analytics should record 0
        metrics = ctx.apps.analytics.calls.get("increment_metric", [])
        assert any(m["name"] == "closed_revenue" and m["value"] == 0 for m in metrics)

    def test_large_value_deal(self, ctx: MockContext, sample_deal: Dict[str, Any]) -> None:
        """Test handling a very large deal value."""
        large_deal = {**sample_deal, "value": 10_000_000}
        ctx.apps.crm.mock_responses({"get_deal": large_deal})

        instance = self.trigger(ctx, event={
            "type": "record:updated",
            "table": "deals",
            "recordId": "deal1",
        })

        self.assert_completed(instance)

        # Slack message should format with commas
        assert "10,000,000" in ctx.slack_messages[0]["message"]

    def test_special_characters_in_names(self, ctx: MockContext, sample_deal: Dict[str, Any]) -> None:
        """Test handling special characters in company/deal names."""
        special_deal = {
            **sample_deal,
            "name": "O'Brien & Associates - Phase 1 (2026)",
            "company": {
                **sample_deal["company"],
                "name": "O'Brien & Associates, LLC"
            }
        }
        ctx.apps.crm.mock_responses({"get_deal": special_deal})

        instance = self.trigger(ctx, event={
            "type": "record:updated",
            "table": "deals",
            "recordId": "deal1",
        })

        self.assert_completed(instance)

        # Should complete without errors
        # Verify names are preserved in spreadsheet
        row_values = ctx.apps.spreadsheet.calls["append_row"][0]["values"]
        assert "O'Brien & Associates, LLC" in row_values


# =============================================================================
# Performance and Monitoring Tests
# =============================================================================


class TestMonitoring(WorkflowTest):
    """Test monitoring and observability aspects."""

    workflow = DealClosedWorkflow

    def test_all_api_calls_tracked(self, ctx: MockContext) -> None:
        """Verify all app API calls are tracked."""
        instance = self.trigger(ctx, event={
            "type": "record:updated",
            "table": "deals",
            "recordId": "deal1",
        })

        self.assert_completed(instance)

        # Count all API calls
        crm_calls = len(ctx.apps.crm.calls.get("get_deal", []))
        finance_calls = len(ctx.apps.finance.calls.get("create_invoice", []))
        analytics_calls = len(ctx.apps.analytics.calls.get("increment_metric", []))
        spreadsheet_calls = len(ctx.apps.spreadsheet.calls.get("append_row", []))

        # Verify expected call counts
        assert crm_calls == 1
        assert finance_calls == 1
        assert analytics_calls == 2  # revenue + count
        assert spreadsheet_calls == 1

    def test_notifications_tracked(self, ctx: MockContext) -> None:
        """Verify all notifications are tracked."""
        instance = self.trigger(ctx, event={
            "type": "record:updated",
            "table": "deals",
            "recordId": "deal1",
        })

        self.assert_completed(instance)

        # Verify notification counts
        assert len(ctx.slack_messages) == 1
        assert len(ctx.toasts) == 1
        assert len(ctx.emails) == 0  # This workflow doesn't send emails


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
