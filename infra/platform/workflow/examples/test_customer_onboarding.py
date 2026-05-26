"""
Comprehensive tests for the Customer Onboarding Workflow.

These tests demonstrate testing patterns for long-running workflows:
- Time travel through multi-week sequences
- Testing branching logic based on progress
- Verifying escalation paths
- Cross-app state updates
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

from customer_onboarding import CustomerOnboardingWorkflow, ManualOnboardingWorkflow


# =============================================================================
# Test Fixtures
# =============================================================================


@pytest.fixture
def sample_deal() -> Dict[str, Any]:
    """Create a sample deal for onboarding."""
    return {
        "id": "deal1",
        "name": "Acme Enterprise Contract",
        "value": 50000,
        "company": {
            "id": "comp1",
            "name": "Acme Corp",
        },
        "contacts": [
            {
                "id": "contact1",
                "name": "Jane Doe",
                "email": "jane@acme.com",
            },
        ],
        "owner": {
            "id": "user1",
            "name": "Alice Sales",
            "email": "alice@ourcompany.com",
        },
    }


@pytest.fixture
def sample_project() -> Dict[str, Any]:
    """Create a sample onboarding project."""
    return {
        "id": "proj1",
        "name": "Onboarding: Acme Corp",
        "template": "customer-onboarding",
    }


def create_tasks(completed: int, total: int) -> List[Dict[str, Any]]:
    """Helper to create task list with given completion status."""
    tasks = []
    for i in range(total):
        tasks.append({
            "id": f"task{i}",
            "title": f"Task {i}",
            "status": "done" if i < completed else "pending",
        })
    return tasks


@pytest.fixture
def ctx(sample_deal: Dict[str, Any], sample_project: Dict[str, Any]) -> MockContext:
    """Create MockContext with sample data."""
    context = MockContext(
        initial_time=datetime(2026, 2, 4, 10, 0, 0, tzinfo=timezone.utc)
    )

    # Mock CRM
    context.apps.crm.mock_responses({
        "get_deal": sample_deal,
        "update_deal": sample_deal,
    })

    # Mock Bug Tracker
    context.apps.bug_tracker.mock_responses({
        "create_project": sample_project,
        "get_project_tasks": create_tasks(0, 5),
    })

    # Mock Analytics
    context.apps.analytics.mock_responses({
        "track_event": None,
    })

    # Config
    context.config.company_name = "Test Company"

    return context


# =============================================================================
# Test Class for CustomerOnboardingWorkflow
# =============================================================================


class TestCustomerOnboardingWorkflow(WorkflowTest):
    """Test the customer onboarding workflow."""

    workflow = CustomerOnboardingWorkflow

    def test_start_and_create_project(self, ctx: MockContext, sample_project: Dict[str, Any]) -> None:
        """Test workflow starts and creates onboarding project."""
        instance = self.trigger(ctx, event={
            "type": "workflow:spawned",
            "input": {"deal_id": "deal1"},
        })

        # Should have created project and sent welcome email
        assert "create_project" in ctx.apps.bug_tracker.calls
        project_call = ctx.apps.bug_tracker.calls["create_project"][0]
        assert "Acme Corp" in project_call["name"]
        assert project_call["template"] == "customer-onboarding"

        # Welcome email should be sent
        assert len(ctx.emails) >= 1
        welcome_email = ctx.emails[0]
        assert welcome_email["to"] == "jane@acme.com"
        assert "Welcome" in welcome_email["subject"]

    def test_deal_not_found_exits_gracefully(self, ctx: MockContext) -> None:
        """Test workflow handles missing deal gracefully."""
        ctx.apps.crm.mock_responses({"get_deal": None})

        instance = self.trigger(ctx, event={
            "type": "workflow:spawned",
            "input": {"deal_id": "nonexistent"},
        })

        self.assert_completed(instance)
        # No project should be created
        assert "create_project" not in ctx.apps.bug_tracker.calls

    def test_week1_good_progress_no_reminder(self, ctx: MockContext) -> None:
        """Test week 1 with good progress - no reminder sent."""
        # Set up 2/5 tasks completed (40% - above 25% threshold)
        ctx.apps.bug_tracker.mock_response_sequence("get_project_tasks", [
            create_tasks(0, 5),  # Initial
            create_tasks(2, 5),  # Week 1 check
        ])

        instance = self.trigger(ctx, event={
            "type": "workflow:spawned",
            "input": {"deal_id": "deal1"},
        })

        # Advance to week 1
        ctx.time.advance(days=7)

        # Check that no "getting started" help email was sent
        help_emails = [e for e in ctx.emails if "getting started" in e.get("subject", "").lower()]
        assert len(help_emails) == 0

    def test_week1_poor_progress_sends_reminder(self, ctx: MockContext) -> None:
        """Test week 1 with poor progress - reminder sent."""
        # Set up 1/5 tasks completed (20% - below 25% threshold)
        ctx.apps.bug_tracker.mock_response_sequence("get_project_tasks", [
            create_tasks(0, 5),  # Initial
            create_tasks(1, 5),  # Week 1 check
        ])

        instance = self.trigger(ctx, event={
            "type": "workflow:spawned",
            "input": {"deal_id": "deal1"},
        })

        # Advance to week 1
        ctx.time.advance(days=7)

        # Check for help email
        help_emails = [e for e in ctx.emails if "help" in e.get("subject", "").lower()]
        assert len(help_emails) == 1

    def test_week2_poor_progress_notifies_slack(self, ctx: MockContext) -> None:
        """Test week 2 with poor progress - Slack notification sent."""
        # Set up progress below 50% at week 2
        ctx.apps.bug_tracker.mock_response_sequence("get_project_tasks", [
            create_tasks(0, 5),  # Initial
            create_tasks(2, 5),  # Week 1 (passes)
            create_tasks(2, 5),  # Week 2 (fails - still 40%)
        ])

        instance = self.trigger(ctx, event={
            "type": "workflow:spawned",
            "input": {"deal_id": "deal1"},
        })

        # Advance to week 2
        ctx.time.advance(days=14)

        # Check for Slack notification to customer success
        cs_messages = [m for m in ctx.slack_messages if "#customer-success" in m.get("channel", "")]
        assert len(cs_messages) >= 1
        assert "behind" in cs_messages[0]["message"].lower()

    def test_full_successful_onboarding(self, ctx: MockContext) -> None:
        """Test complete successful onboarding over 4 weeks."""
        # Progress: Week 1: 30%, Week 2: 60%, Week 3: 80%, Week 4: 100%
        ctx.apps.bug_tracker.mock_response_sequence("get_project_tasks", [
            create_tasks(0, 5),  # Initial
            create_tasks(2, 5),  # Week 1: 40% (passes)
            create_tasks(3, 5),  # Week 2: 60% (passes)
            create_tasks(4, 5),  # Week 3: 80% (passes)
            create_tasks(5, 5),  # Week 4: 100% (complete!)
        ])

        instance = self.trigger(ctx, event={
            "type": "workflow:spawned",
            "input": {"deal_id": "deal1"},
        })

        # Advance through all 4 weeks
        ctx.time.advance(days=28)

        # Verify CRM was updated
        assert "update_deal" in ctx.apps.crm.calls
        update_call = ctx.apps.crm.calls["update_deal"][0]
        assert update_call["data"]["onboarding_completed"] is True

        # Verify analytics event
        assert "track_event" in ctx.apps.analytics.calls
        events = ctx.apps.analytics.calls["track_event"]
        completion_event = next((e for e in events if e["name"] == "onboarding_completed"), None)
        assert completion_event is not None
        assert completion_event["properties"]["tasks_completed"] == 5

        # Verify completion email
        completion_emails = [e for e in ctx.emails if "Congratulations" in e.get("subject", "")]
        assert len(completion_emails) == 1

        # Verify Slack success message
        success_messages = [m for m in ctx.slack_messages if "completed" in m.get("message", "").lower()]
        assert len(success_messages) >= 1

        # Verify event was emitted
        assert len(ctx.emitted_events) == 1
        assert ctx.emitted_events[0]["type"] == "onboarding:completed"

    def test_incomplete_onboarding_escalation(self, ctx: MockContext) -> None:
        """Test escalation when onboarding is incomplete after 4 weeks."""
        # Stay at 60% through all weeks
        ctx.apps.bug_tracker.mock_response_sequence("get_project_tasks", [
            create_tasks(0, 5),  # Initial
            create_tasks(2, 5),  # Week 1: 40%
            create_tasks(3, 5),  # Week 2: 60%
            create_tasks(3, 5),  # Week 3: still 60%
            create_tasks(3, 5),  # Week 4: still 60% -> escalate
        ])

        instance = self.trigger(ctx, event={
            "type": "workflow:spawned",
            "input": {"deal_id": "deal1"},
        })

        # Advance through all 4 weeks
        ctx.time.advance(days=28)

        # Verify CRM updated with at-risk status
        update_calls = ctx.apps.crm.calls.get("update_deal", [])
        at_risk_update = next((c for c in update_calls if c["data"].get("onboarding_at_risk")), None)
        assert at_risk_update is not None

        # Verify escalation email
        escalation_emails = [e for e in ctx.emails if "Escalation" in e.get("subject", "")]
        assert len(escalation_emails) == 1
        assert escalation_emails[0]["to"] == "cs-escalations@company.com"

        # Verify escalation Slack
        escalation_messages = [m for m in ctx.slack_messages if "ESCALATION" in m.get("message", "")]
        assert len(escalation_messages) == 1

        # Verify analytics event
        events = ctx.apps.analytics.calls.get("track_event", [])
        at_risk_event = next((e for e in events if e["name"] == "onboarding_at_risk"), None)
        assert at_risk_event is not None


# =============================================================================
# Time Travel Tests
# =============================================================================


class TestOnboardingTimeTavel(WorkflowTest):
    """Test time-based behavior of onboarding workflow."""

    workflow = CustomerOnboardingWorkflow

    def test_sleeps_are_registered(self, ctx: MockContext) -> None:
        """Test that sleeps are properly registered."""
        instance = self.trigger(ctx, event={
            "type": "workflow:spawned",
            "input": {"deal_id": "deal1"},
        })

        # Should have a pending sleep for 7 days
        pending = ctx.time.pending_sleeps
        assert len(pending) >= 1
        assert pending[0].wake_at == ctx.time.now() + timedelta(days=7)

    def test_partial_time_advance(self, ctx: MockContext) -> None:
        """Test advancing time partially through a sleep."""
        instance = self.trigger(ctx, event={
            "type": "workflow:spawned",
            "input": {"deal_id": "deal1"},
        })

        # Advance only 3 days
        ctx.time.advance(days=3)

        # Sleep should still be pending
        assert len(ctx.time.pending_sleeps) >= 1

    def test_duration_calculation(self, ctx: MockContext) -> None:
        """Test that duration is correctly calculated."""
        # Complete in week 2
        ctx.apps.bug_tracker.mock_response_sequence("get_project_tasks", [
            create_tasks(0, 5),
            create_tasks(3, 5),
            create_tasks(5, 5),  # Complete at week 2
        ])

        instance = self.trigger(ctx, event={
            "type": "workflow:spawned",
            "input": {"deal_id": "deal1"},
        })

        ctx.time.advance(days=14)

        # Check duration in analytics
        events = ctx.apps.analytics.calls.get("track_event", [])
        completion_event = next((e for e in events if e["name"] == "onboarding_completed"), None)
        if completion_event:
            assert completion_event["properties"]["duration_days"] == 14


# =============================================================================
# Edge Cases
# =============================================================================


class TestOnboardingEdgeCases(WorkflowTest):
    """Test edge cases in onboarding workflow."""

    workflow = CustomerOnboardingWorkflow

    def test_deal_without_contacts(self, ctx: MockContext, sample_deal: Dict[str, Any]) -> None:
        """Test handling deal with no contacts."""
        deal_no_contacts = {**sample_deal, "contacts": []}
        ctx.apps.crm.mock_responses({"get_deal": deal_no_contacts})

        instance = self.trigger(ctx, event={
            "type": "workflow:spawned",
            "input": {"deal_id": "deal1"},
        })

        # Should still create project
        assert "create_project" in ctx.apps.bug_tracker.calls

        # But no welcome email
        assert len(ctx.emails) == 0

    def test_deal_without_company(self, ctx: MockContext, sample_deal: Dict[str, Any]) -> None:
        """Test handling deal with no company."""
        deal_no_company = {**sample_deal, "company": None}
        ctx.apps.crm.mock_responses({"get_deal": deal_no_company})

        instance = self.trigger(ctx, event={
            "type": "workflow:spawned",
            "input": {"deal_id": "deal1"},
        })

        # Project name should handle missing company
        project_call = ctx.apps.bug_tracker.calls["create_project"][0]
        assert "Unknown" in project_call["name"]

    def test_immediate_completion(self, ctx: MockContext) -> None:
        """Test when all tasks are immediately complete."""
        ctx.apps.bug_tracker.mock_responses({
            "create_project": {"id": "proj1", "name": "Test"},
            "get_project_tasks": create_tasks(5, 5),  # All complete from start
        })

        instance = self.trigger(ctx, event={
            "type": "workflow:spawned",
            "input": {"deal_id": "deal1"},
        })

        # Advance to first check
        ctx.time.advance(days=7)

        # Should complete successfully
        events = ctx.apps.analytics.calls.get("track_event", [])
        completion_event = next((e for e in events if e["name"] == "onboarding_completed"), None)
        assert completion_event is not None


# =============================================================================
# Manual Onboarding Tests
# =============================================================================


class TestManualOnboardingWorkflow(WorkflowTest):
    """Test the manual onboarding workflow variant."""

    workflow = ManualOnboardingWorkflow

    def test_manual_trigger_with_deal_id(self, ctx: MockContext) -> None:
        """Test manual triggering with deal_id."""
        instance = self.trigger(ctx, event={
            "type": "manual",
            "deal_id": "deal1",
        })

        # Should work just like spawned version
        assert "create_project" in ctx.apps.bug_tracker.calls

    def test_manual_trigger_without_deal_id(self, ctx: MockContext) -> None:
        """Test manual triggering without deal_id shows error."""
        instance = self.trigger(ctx, event={
            "type": "manual",
        })

        self.assert_completed(instance)

        # Should show toast error
        assert len(ctx.toasts) == 1
        assert "deal_id" in ctx.toasts[0]["message"]


# =============================================================================
# Cross-App Integration Tests
# =============================================================================


class TestOnboardingCrossAppIntegration(WorkflowTest):
    """Test cross-app data consistency in onboarding."""

    workflow = CustomerOnboardingWorkflow

    def test_crm_update_includes_analytics_data(self, ctx: MockContext) -> None:
        """Verify CRM update includes data that matches analytics."""
        ctx.apps.bug_tracker.mock_response_sequence("get_project_tasks", [
            create_tasks(0, 5),
            create_tasks(5, 5),  # Complete at week 1
        ])

        instance = self.trigger(ctx, event={
            "type": "workflow:spawned",
            "input": {"deal_id": "deal1"},
        })

        ctx.time.advance(days=7)

        # Get both updates
        crm_update = ctx.apps.crm.calls["update_deal"][0]["data"]
        analytics_event = next(
            e for e in ctx.apps.analytics.calls["track_event"]
            if e["name"] == "onboarding_completed"
        )

        # Duration should match
        assert crm_update["onboarding_duration_days"] == analytics_event["properties"]["duration_days"]

    def test_project_metadata_includes_deal_info(self, ctx: MockContext) -> None:
        """Verify bug tracker project includes deal metadata."""
        instance = self.trigger(ctx, event={
            "type": "workflow:spawned",
            "input": {"deal_id": "deal1"},
        })

        project_call = ctx.apps.bug_tracker.calls["create_project"][0]
        assert project_call["metadata"]["deal_id"] == "deal1"
        assert project_call["metadata"]["company_id"] == "comp1"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
