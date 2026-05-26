"""
Comprehensive tests for the Weekly Report Workflow.

These tests demonstrate testing patterns for scheduled workflows:
- Testing cron-triggered workflows
- Verifying report generation
- Testing cross-app data aggregation
- Verifying notifications and spreadsheet updates
"""

from __future__ import annotations

import pytest
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from workflow_engine.testing import (
    MockContext,
    WorkflowTest,
    WorkflowAssertions,
    complete,
)

from weekly_report import WeeklyReport, MonthlyPipelineReview, EndOfWeekSummary


# =============================================================================
# Test Fixtures
# =============================================================================


@pytest.fixture
def sample_deals() -> List[Dict[str, Any]]:
    """Create sample deals for the past week."""
    return [
        {
            "id": "deal1",
            "name": "Acme Enterprise",
            "value": 50000,
            "company": {"id": "comp1", "name": "Acme Corp", "segment": "enterprise"},
            "owner": {"id": "user1", "name": "Alice Sales"},
        },
        {
            "id": "deal2",
            "name": "Beta Startup",
            "value": 15000,
            "company": {"id": "comp2", "name": "Beta Inc", "segment": "startup"},
            "owner": {"id": "user1", "name": "Alice Sales"},
        },
        {
            "id": "deal3",
            "name": "Gamma Mid",
            "value": 30000,
            "company": {"id": "comp3", "name": "Gamma Ltd", "segment": "midmarket"},
            "owner": {"id": "user2", "name": "Bob Sales"},
        },
    ]


@pytest.fixture
def sample_pipeline_metrics() -> Dict[str, Any]:
    """Create sample pipeline metrics."""
    return {
        "total_value": 500000,
        "deal_count": 25,
        "by_stage": {
            "Qualification": {"count": 10, "value": 150000},
            "Proposal": {"count": 8, "value": 200000},
            "Negotiation": {"count": 5, "value": 100000},
            "Closed Won": {"count": 2, "value": 50000},
        },
    }


@pytest.fixture
def ctx(sample_deals: List[Dict[str, Any]], sample_pipeline_metrics: Dict[str, Any]) -> MockContext:
    """Create MockContext with sample data."""
    # Start on a Monday at 9am ET (2pm UTC)
    monday_9am_et = datetime(2026, 2, 2, 14, 0, 0, tzinfo=timezone.utc)

    context = MockContext(initial_time=monday_9am_et)

    # Mock CRM API
    context.apps.crm.mock_responses({
        "get_deals_closed_between": sample_deals,
        "get_pipeline_metrics": sample_pipeline_metrics,
    })

    # Mock Spreadsheet API
    context.apps.spreadsheet.mock_responses({
        "get_sheet": {"id": "sheet1", "name": "Weekly Report"},
        "create_sheet": {"id": "sheet1", "name": "Weekly Report"},
        "set_range": {"success": True},
    })

    # Mock Analytics
    context.apps.analytics.mock_responses({
        "track_event": None,
        "increment_metric": None,
    })

    return context


# =============================================================================
# Test Class for WeeklyReport
# =============================================================================


class TestWeeklyReport(WorkflowTest):
    """Test the weekly sales report workflow."""

    workflow = WeeklyReport

    def test_successful_report_generation(self, ctx: MockContext, sample_deals: List[Dict[str, Any]]) -> None:
        """Test complete report generation flow."""
        instance = self.trigger(ctx, event={
            "type": "schedule",
            "cron": "0 9 * * 1",
        })

        self.assert_completed(instance)

        # Verify CRM was queried for deals
        assert "get_deals_closed_between" in ctx.apps.crm.calls
        deals_call = ctx.apps.crm.calls["get_deals_closed_between"][0]
        assert "start_date" in deals_call
        assert "end_date" in deals_call

        # Verify spreadsheet was updated
        assert "set_range" in ctx.apps.spreadsheet.calls
        assert len(ctx.apps.spreadsheet.calls["set_range"]) >= 3  # Multiple sections

        # Verify email was sent
        assert len(ctx.emails) == 1
        email = ctx.emails[0]
        assert email["to"] == "sales-team@company.com"
        assert "Weekly Sales Report" in email["subject"]

        # Verify Slack was posted
        assert len(ctx.slack_messages) == 1
        slack = ctx.slack_messages[0]
        assert slack["channel"] == "#sales"
        assert "3 deals closed" in slack["message"]  # From sample_deals fixture
        assert "$95,000" in slack["message"]  # Total revenue

        # Verify analytics event
        events = ctx.apps.analytics.calls.get("track_event", [])
        assert len(events) == 1
        assert events[0]["name"] == "weekly_report_generated"

    def test_report_calculation(self, ctx: MockContext, sample_deals: List[Dict[str, Any]]) -> None:
        """Test that report metrics are calculated correctly."""
        instance = self.trigger(ctx, event={
            "type": "schedule",
        })

        self.assert_completed(instance)

        # Check report state
        report = instance.state.get("report")
        assert report is not None
        assert report["deals_closed"] == 3
        assert report["revenue"] == 95000  # 50000 + 15000 + 30000

        # Check rep grouping
        by_rep = report["by_rep"]
        assert "Alice Sales" in by_rep
        assert by_rep["Alice Sales"]["count"] == 2
        assert by_rep["Alice Sales"]["revenue"] == 65000  # 50000 + 15000
        assert "Bob Sales" in by_rep
        assert by_rep["Bob Sales"]["count"] == 1
        assert by_rep["Bob Sales"]["revenue"] == 30000

        # Check segment grouping
        by_segment = report["by_segment"]
        assert "enterprise" in by_segment
        assert "startup" in by_segment
        assert "midmarket" in by_segment

        # Check top deals
        top_deals = report["top_deals"]
        assert len(top_deals) >= 1
        assert top_deals[0]["value"] == 50000  # Highest value deal

    def test_no_deals_this_week(self, ctx: MockContext) -> None:
        """Test handling when no deals were closed."""
        ctx.apps.crm.mock_responses({
            "get_deals_closed_between": [],
            "get_pipeline_metrics": {"total_value": 500000, "deal_count": 25},
        })

        instance = self.trigger(ctx, event={
            "type": "schedule",
        })

        self.assert_completed(instance)

        # Report should still be generated
        report = instance.state.get("report")
        assert report["deals_closed"] == 0
        assert report["revenue"] == 0
        assert len(report["by_rep"]) == 0

        # Email should still be sent
        assert len(ctx.emails) == 1

        # Slack message should indicate no deals
        assert len(ctx.slack_messages) == 1
        assert "0 deals" in ctx.slack_messages[0]["message"]

    def test_spreadsheet_structure(self, ctx: MockContext) -> None:
        """Test that spreadsheet has proper structure."""
        instance = self.trigger(ctx, event={
            "type": "schedule",
        })

        self.assert_completed(instance)

        # Check spreadsheet calls
        set_range_calls = ctx.apps.spreadsheet.calls["set_range"]

        # Should have header
        header_call = next(c for c in set_range_calls if "A1" in c["range"])
        assert "Weekly Sales Report" in str(header_call["values"])

        # Should have summary metrics
        metrics_call = next(c for c in set_range_calls if "A3" in c["range"])
        assert "Deals Closed" in str(metrics_call["values"])
        assert "Revenue" in str(metrics_call["values"])

    def test_date_range_calculation(self, ctx: MockContext) -> None:
        """Test that date range covers exactly 7 days."""
        instance = self.trigger(ctx, event={
            "type": "schedule",
        })

        self.assert_completed(instance)

        # Check the date range passed to CRM
        call = ctx.apps.crm.calls["get_deals_closed_between"][0]
        start_date = datetime.fromisoformat(call["start_date"].replace("Z", "+00:00"))
        end_date = datetime.fromisoformat(call["end_date"].replace("Z", "+00:00"))

        # Should be 7 days apart
        assert (end_date - start_date).days == 7


# =============================================================================
# Test Class for MonthlyPipelineReview
# =============================================================================


class TestMonthlyPipelineReview(WorkflowTest):
    """Test the monthly pipeline review workflow."""

    workflow = MonthlyPipelineReview

    def test_monthly_report_generation(self, ctx: MockContext, sample_pipeline_metrics: Dict[str, Any]) -> None:
        """Test monthly report generation."""
        # Set up current and previous month metrics
        current_metrics = {**sample_pipeline_metrics, "total_value": 600000}
        previous_metrics = {**sample_pipeline_metrics, "total_value": 500000}

        ctx.apps.crm.mock_response_sequence("get_pipeline_metrics", [
            current_metrics,
            previous_metrics,
        ])

        instance = self.trigger(ctx, event={
            "type": "schedule",
            "cron": "0 8 1 * *",
        })

        self.assert_completed(instance)

        # Check report calculations
        report = instance.state.get("report")
        assert report["current_value"] == 600000
        assert report["previous_value"] == 500000
        assert report["change"] == 100000
        assert report["change_pct"] == 20.0  # 20% increase

        # Verify notifications
        assert len(ctx.emails) == 1
        assert "leadership@company.com" in ctx.emails[0]["to"]
        assert "Monthly Pipeline Review" in ctx.emails[0]["subject"]

        assert len(ctx.slack_messages) == 1
        assert "#sales-leadership" in ctx.slack_messages[0]["channel"]
        assert "+20.0%" in ctx.slack_messages[0]["message"]

    def test_pipeline_decrease(self, ctx: MockContext) -> None:
        """Test handling of pipeline decrease."""
        ctx.apps.crm.mock_response_sequence("get_pipeline_metrics", [
            {"total_value": 400000, "deal_count": 20, "by_stage": {}},
            {"total_value": 500000, "deal_count": 25, "by_stage": {}},
        ])

        instance = self.trigger(ctx, event={
            "type": "schedule",
        })

        self.assert_completed(instance)

        report = instance.state.get("report")
        assert report["change"] == -100000
        assert report["change_pct"] == -20.0

        # Slack should show negative change
        assert "-20.0%" in ctx.slack_messages[0]["message"]


# =============================================================================
# Test Class for EndOfWeekSummary
# =============================================================================


class TestEndOfWeekSummary(WorkflowTest):
    """Test the end of week summary workflow."""

    workflow = EndOfWeekSummary

    def test_target_met(self, ctx: MockContext, sample_deals: List[Dict[str, Any]]) -> None:
        """Test when weekly target is met."""
        # Set a low target that sample deals will exceed
        ctx.config.weekly_sales_target = 50000

        instance = self.trigger(ctx, event={
            "type": "schedule",
            "cron": "0 18 * * 5",
        })

        self.assert_completed(instance)

        # Should have celebratory message
        slack = ctx.slack_messages[0]
        assert "Great week" in slack["message"]
        assert "$95,000" in slack["message"]

    def test_target_not_met(self, ctx: MockContext, sample_deals: List[Dict[str, Any]]) -> None:
        """Test when weekly target is not met."""
        # Set a high target
        ctx.config.weekly_sales_target = 200000

        instance = self.trigger(ctx, event={
            "type": "schedule",
        })

        self.assert_completed(instance)

        # Should have regular message (not "Great week")
        slack = ctx.slack_messages[0]
        assert "Week ended" in slack["message"]
        # Should show percentage of target
        assert "47%" in slack["message"] or "48%" in slack["message"]  # ~47.5%

    def test_metrics_tracked(self, ctx: MockContext) -> None:
        """Test that weekly metrics are tracked."""
        ctx.config.weekly_sales_target = 100000

        instance = self.trigger(ctx, event={
            "type": "schedule",
        })

        self.assert_completed(instance)

        # Check analytics
        metric_calls = ctx.apps.analytics.calls.get("increment_metric", [])
        assert len(metric_calls) == 1
        assert metric_calls[0]["name"] == "weekly_revenue"
        assert metric_calls[0]["value"] == 95000


# =============================================================================
# Integration Tests
# =============================================================================


class TestScheduledWorkflowIntegration(WorkflowTest):
    """Test scheduled workflow patterns."""

    workflow = WeeklyReport

    def test_step_order(self, ctx: MockContext) -> None:
        """Test that steps execute in correct order."""
        instance = self.trigger(ctx, event={
            "type": "schedule",
        })

        self.assert_completed(instance)
        self.assert_step_history(instance, [
            "start",
            "generate_spreadsheet",
            "send_email",
            "send_slack",
        ])

    def test_state_preserved_across_steps(self, ctx: MockContext) -> None:
        """Test that state is maintained across steps."""
        instance = self.trigger(ctx, event={
            "type": "schedule",
        })

        self.assert_completed(instance)

        # Verify state was preserved
        assert instance.state.get("deals") is not None
        assert instance.state.get("report") is not None
        assert instance.state.get("sheet_name") is not None


# =============================================================================
# Edge Cases
# =============================================================================


class TestWeeklyReportEdgeCases(WorkflowTest):
    """Test edge cases in weekly report generation."""

    workflow = WeeklyReport

    def test_single_deal(self, ctx: MockContext) -> None:
        """Test report with only one deal."""
        ctx.apps.crm.mock_responses({
            "get_deals_closed_between": [{
                "id": "deal1",
                "name": "Solo Deal",
                "value": 10000,
                "company": {"id": "comp1", "name": "Solo Corp", "segment": "startup"},
                "owner": {"id": "user1", "name": "Alice Sales"},
            }],
            "get_pipeline_metrics": {"total_value": 100000, "deal_count": 5},
        })

        instance = self.trigger(ctx, event={
            "type": "schedule",
        })

        self.assert_completed(instance)

        report = instance.state.get("report")
        assert report["deals_closed"] == 1
        assert report["by_rep"]["Alice Sales"]["count"] == 1

    def test_deals_without_owner(self, ctx: MockContext) -> None:
        """Test handling deals without assigned owner."""
        ctx.apps.crm.mock_responses({
            "get_deals_closed_between": [{
                "id": "deal1",
                "name": "Orphan Deal",
                "value": 20000,
                "company": {"id": "comp1", "name": "Orphan Corp"},
                "owner": None,
            }],
            "get_pipeline_metrics": {"total_value": 100000, "deal_count": 5},
        })

        instance = self.trigger(ctx, event={
            "type": "schedule",
        })

        self.assert_completed(instance)

        report = instance.state.get("report")
        assert "Unassigned" in report["by_rep"]

    def test_deals_without_company(self, ctx: MockContext) -> None:
        """Test handling deals without company info."""
        ctx.apps.crm.mock_responses({
            "get_deals_closed_between": [{
                "id": "deal1",
                "name": "No Company Deal",
                "value": 15000,
                "company": None,
                "owner": {"id": "user1", "name": "Alice Sales"},
            }],
            "get_pipeline_metrics": {"total_value": 100000, "deal_count": 5},
        })

        instance = self.trigger(ctx, event={
            "type": "schedule",
        })

        self.assert_completed(instance)

        report = instance.state.get("report")
        assert "Unknown" in report["by_segment"]

    def test_large_number_of_deals(self, ctx: MockContext) -> None:
        """Test handling many deals."""
        # Generate 100 deals
        many_deals = []
        for i in range(100):
            many_deals.append({
                "id": f"deal{i}",
                "name": f"Deal {i}",
                "value": 10000 + (i * 100),
                "company": {"id": f"comp{i}", "name": f"Company {i}", "segment": "enterprise"},
                "owner": {"id": f"user{i % 5}", "name": f"Rep {i % 5}"},
            })

        ctx.apps.crm.mock_responses({
            "get_deals_closed_between": many_deals,
            "get_pipeline_metrics": {"total_value": 1000000, "deal_count": 100},
        })

        instance = self.trigger(ctx, event={
            "type": "schedule",
        })

        self.assert_completed(instance)

        report = instance.state.get("report")
        assert report["deals_closed"] == 100
        assert len(report["top_deals"]) == 5  # Limited to top 5


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
