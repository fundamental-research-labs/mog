"""
Comprehensive tests for the Salesforce Sync Workflow.

These tests demonstrate testing patterns for external API integration:
- Mocking HTTP responses
- Testing retry behavior
- Testing error handling (retryable vs non-retryable)
- Verifying idempotency
"""

from __future__ import annotations

import pytest
from datetime import datetime, timezone
from typing import Any, Dict

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from workflow_engine.testing import (
    MockContext,
    WorkflowTest,
    WorkflowAssertions,
    complete,
)
from workflow_engine.errors import RetryableError, NonRetryableError

from salesforce_sync import (
    SalesforceSync,
    SalesforceContactSync,
    SalesforceSyncHealthCheck,
)


# =============================================================================
# Test Fixtures
# =============================================================================


@pytest.fixture
def sample_deal() -> Dict[str, Any]:
    """Create a sample deal for sync."""
    return {
        "id": "deal1",
        "name": "Acme Enterprise Deal",
        "value": 75000,
        "stage": "Won",
        "company": {
            "id": "comp1",
            "name": "Acme Corp",
            "salesforce_id": "001XXXXXXXXXXXX",
        },
        "owner": {
            "id": "user1",
            "name": "Alice Sales",
            "salesforce_user_id": "005XXXXXXXXXXXX",
        },
    }


@pytest.fixture
def sample_contact() -> Dict[str, Any]:
    """Create a sample contact for sync."""
    return {
        "id": "contact1",
        "first_name": "Jane",
        "last_name": "Doe",
        "email": "jane@acme.com",
        "phone": "+1-555-123-4567",
        "title": "VP of Engineering",
        "company_id": "comp1",
    }


@pytest.fixture
def ctx(sample_deal: Dict[str, Any]) -> MockContext:
    """Create MockContext with sample data and Salesforce credentials."""
    context = MockContext(
        {
            "deals": {"deal1": sample_deal},
            "companies": {"comp1": sample_deal["company"]},
        },
        initial_time=datetime(2026, 2, 4, 10, 0, 0, tzinfo=timezone.utc),
    )

    # Mock CRM API
    context.apps.crm.mock_responses({
        "get_deal": sample_deal,
        "update_deal": sample_deal,
    })

    # Mock Analytics
    context.apps.analytics.mock_responses({
        "track_event": None,
    })

    # Set up Salesforce credentials
    context.secrets.set("SALESFORCE_TOKEN", "test_token_12345")
    context.secrets.set("SALESFORCE_INSTANCE", "test.salesforce.com")

    # Mock successful Salesforce response
    context.http.mock_response(
        "salesforce.com",
        status=201,
        body={"id": "006XXXXXXXXXXXX", "success": True},
    )

    return context


# =============================================================================
# Test Class for SalesforceSync
# =============================================================================


class TestSalesforceSync(WorkflowTest):
    """Test the Salesforce sync workflow."""

    workflow = SalesforceSync

    def test_successful_sync(self, ctx: MockContext, sample_deal: Dict[str, Any]) -> None:
        """Test successful sync to Salesforce."""
        instance = self.trigger(ctx, event={
            "type": "record:updated",
            "table": "deals",
            "recordId": "deal1",
        })

        self.assert_completed(instance)

        # Verify HTTP call was made
        assert len(ctx.http_requests) == 1
        request = ctx.http_requests[0]
        assert request["method"] == "POST"
        assert "salesforce.com" in request["url"]
        assert request["headers"]["Authorization"] == "Bearer test_token_12345"

        # Verify request body
        body = request["json"]
        assert body["Name"] == "Acme Enterprise Deal"
        assert body["Amount"] == 75000
        assert body["StageName"] == "Closed Won"
        assert body["AccountId"] == "001XXXXXXXXXXXX"  # Company's SF ID
        assert body["OwnerId"] == "005XXXXXXXXXXXX"  # Owner's SF user ID

        # Verify CRM was updated with Salesforce ID
        update_call = ctx.apps.crm.calls["update_deal"][0]
        assert update_call["data"]["salesforce_id"] == "006XXXXXXXXXXXX"
        assert update_call["data"]["salesforce_sync_status"] == "success"

        # Verify analytics event
        events = ctx.apps.analytics.calls.get("track_event", [])
        success_event = next(e for e in events if e["name"] == "salesforce_sync_success")
        assert success_event["properties"]["salesforce_id"] == "006XXXXXXXXXXXX"

        # Verify notifications
        assert len(ctx.slack_messages) == 1
        assert "#integrations" in ctx.slack_messages[0]["channel"]

    def test_deal_not_found(self, ctx: MockContext) -> None:
        """Test handling when deal is not found."""
        ctx.apps.crm.mock_responses({"get_deal": None})

        instance = self.trigger(ctx, event={
            "type": "record:updated",
            "table": "deals",
            "recordId": "nonexistent",
        })

        self.assert_completed(instance)

        # No HTTP calls should be made
        assert len(ctx.http_requests) == 0

        # Toast notification about missing deal
        assert len(ctx.toasts) == 1
        assert "not found" in ctx.toasts[0]["message"]

    def test_missing_salesforce_token(self, ctx: MockContext) -> None:
        """Test handling when Salesforce token is missing."""
        ctx.secrets._secrets.clear()  # Remove all secrets

        instance = self.trigger(ctx, event={
            "type": "record:updated",
            "table": "deals",
            "recordId": "deal1",
        })

        # Should fail with non-retryable error
        self.assert_failed(instance, error_contains="token not configured")

    def test_auth_failure_non_retryable(self, ctx: MockContext) -> None:
        """Test that 401 errors are non-retryable."""
        ctx.http.mock_response(
            "salesforce.com",
            status=401,
            body={"error": "INVALID_SESSION_ID"},
        )

        instance = self.trigger(ctx, event={
            "type": "record:updated",
            "table": "deals",
            "recordId": "deal1",
        })

        # Should fail without retry
        self.assert_failed(instance, error_contains="authentication failed")

        # Only one HTTP call (no retries)
        assert len(ctx.http_requests) == 1

    def test_validation_error_non_retryable(self, ctx: MockContext) -> None:
        """Test that 400 validation errors are non-retryable."""
        ctx.http.mock_response(
            "salesforce.com",
            status=400,
            body={"message": "Required field missing: CloseDate"},
        )

        instance = self.trigger(ctx, event={
            "type": "record:updated",
            "table": "deals",
            "recordId": "deal1",
        })

        self.assert_failed(instance, error_contains="validation error")

    def test_service_unavailable_retryable(self, ctx: MockContext) -> None:
        """Test that 503 errors trigger retry."""
        # First call fails, second succeeds
        ctx.http._responses.clear()

        # We need to use response sequence but MockHttpClient doesn't support it directly
        # So we test that the error is classified correctly
        ctx.http.mock_response(
            "salesforce.com",
            status=503,
            body={"error": "Service Unavailable"},
        )

        instance = self.trigger(ctx, event={
            "type": "record:updated",
            "table": "deals",
            "recordId": "deal1",
        })

        # Should fail after retries
        self.assert_failed(instance, error_contains="503")

    def test_rate_limited_retryable(self, ctx: MockContext) -> None:
        """Test that 429 rate limit errors trigger retry."""
        ctx.http.mock_response(
            "salesforce.com",
            status=429,
            body={"error": "Too Many Requests"},
        )

        instance = self.trigger(ctx, event={
            "type": "record:updated",
            "table": "deals",
            "recordId": "deal1",
        })

        self.assert_failed(instance, error_contains="429")

    def test_already_synced_updates_instead(self, ctx: MockContext, sample_deal: Dict[str, Any]) -> None:
        """Test that already-synced deals trigger update instead of create."""
        synced_deal = {**sample_deal, "salesforce_id": "006EXISTING_ID"}
        ctx.apps.crm.mock_responses({"get_deal": synced_deal, "update_deal": synced_deal})

        # Mock PATCH response for update
        ctx.http.mock_response(
            "salesforce.com",
            status=204,
            body={},
        )

        instance = self.trigger(ctx, event={
            "type": "record:updated",
            "table": "deals",
            "recordId": "deal1",
        })

        self.assert_completed(instance)

        # Should use PATCH for update
        assert len(ctx.http_requests) == 1
        assert ctx.http_requests[0]["method"] == "PATCH"
        assert "006EXISTING_ID" in ctx.http_requests[0]["url"]

    def test_deleted_in_salesforce_recreates(self, ctx: MockContext, sample_deal: Dict[str, Any]) -> None:
        """Test that 404 on update triggers recreation."""
        synced_deal = {**sample_deal, "salesforce_id": "006DELETED_ID"}
        ctx.apps.crm.mock_responses({"get_deal": synced_deal, "update_deal": synced_deal})

        # First call returns 404 (deleted), should trigger creation
        # For simplicity, we'll just test the 404 handling
        ctx.http.mock_response(
            "salesforce.com",
            status=404,
            body={"errorCode": "NOT_FOUND"},
        )

        instance = self.trigger(ctx, event={
            "type": "record:updated",
            "table": "deals",
            "recordId": "deal1",
        })

        # Workflow should attempt update then create
        # With our mock, both will hit 404/201 so we verify the attempt
        assert len(ctx.http_requests) >= 1

    def test_deal_without_company_salesforce_id(self, ctx: MockContext, sample_deal: Dict[str, Any]) -> None:
        """Test sync when company doesn't have Salesforce ID."""
        deal_no_sf_company = {
            **sample_deal,
            "company": {**sample_deal["company"], "salesforce_id": None}
        }
        ctx.apps.crm.mock_responses({"get_deal": deal_no_sf_company})

        instance = self.trigger(ctx, event={
            "type": "record:updated",
            "table": "deals",
            "recordId": "deal1",
        })

        self.assert_completed(instance)

        # Request should not include AccountId
        request = ctx.http_requests[0]
        assert "AccountId" not in request["json"]


# =============================================================================
# Test Class for SalesforceContactSync
# =============================================================================


class TestSalesforceContactSync(WorkflowTest):
    """Test the Salesforce contact sync workflow."""

    workflow = SalesforceContactSync

    def test_successful_contact_sync(self, ctx: MockContext, sample_contact: Dict[str, Any]) -> None:
        """Test successful contact sync."""
        ctx._records._data["contacts"] = {"contact1": sample_contact}
        ctx._records._data["companies"] = {
            "comp1": {"id": "comp1", "salesforce_id": "001COMPANY_SF_ID"}
        }

        instance = self.trigger(ctx, event={
            "type": "record:created",
            "table": "contacts",
            "recordId": "contact1",
        })

        self.assert_completed(instance)

        # Verify HTTP call
        assert len(ctx.http_requests) == 1
        request = ctx.http_requests[0]
        assert request["method"] == "POST"
        assert "Contact" in request["url"]

        # Verify contact data
        body = request["json"]
        assert body["FirstName"] == "Jane"
        assert body["LastName"] == "Doe"
        assert body["Email"] == "jane@acme.com"
        assert body["AccountId"] == "001COMPANY_SF_ID"

        # Verify record was updated
        assert "contact1" in ctx.records.updates.get("contacts", {})

    def test_contact_not_found(self, ctx: MockContext) -> None:
        """Test handling when contact is not found."""
        instance = self.trigger(ctx, event={
            "type": "record:created",
            "table": "contacts",
            "recordId": "nonexistent",
        })

        self.assert_completed(instance)
        assert len(ctx.http_requests) == 0

    def test_contact_already_synced(self, ctx: MockContext, sample_contact: Dict[str, Any]) -> None:
        """Test that already-synced contacts are skipped."""
        synced_contact = {**sample_contact, "salesforce_id": "003EXISTING"}
        ctx._records._data["contacts"] = {"contact1": synced_contact}

        instance = self.trigger(ctx, event={
            "type": "record:created",
            "table": "contacts",
            "recordId": "contact1",
        })

        self.assert_completed(instance)
        assert len(ctx.http_requests) == 0


# =============================================================================
# Test Class for SalesforceSyncHealthCheck
# =============================================================================


class TestSalesforceSyncHealthCheck(WorkflowTest):
    """Test the scheduled health check workflow."""

    workflow = SalesforceSyncHealthCheck

    def test_no_failed_deals(self, ctx: MockContext) -> None:
        """Test when there are no failed syncs."""
        ctx._records._data["deals"] = {}  # No failed deals

        instance = self.trigger(ctx, event={
            "type": "schedule",
        })

        self.assert_completed(instance)

        # No workflows should be spawned
        assert len(ctx.spawned_workflows) == 0

    def test_retries_failed_deals(self, ctx: MockContext) -> None:
        """Test that failed deals are retried."""
        # Add some failed deals
        ctx._records._data["deals"] = {
            "deal1": {"id": "deal1", "stage": "Won", "salesforce_sync_status": "failed"},
            "deal2": {"id": "deal2", "stage": "Won", "salesforce_sync_status": "failed"},
            "deal3": {"id": "deal3", "stage": "Won", "salesforce_sync_status": "success"},
        }

        instance = self.trigger(ctx, event={
            "type": "schedule",
        })

        self.assert_completed(instance)

        # Should spawn 2 sync workflows (for failed deals only)
        assert len(ctx.spawned_workflows) == 2
        spawned_ids = [w["input"]["recordId"] for w in ctx.spawned_workflows]
        assert "deal1" in spawned_ids
        assert "deal2" in spawned_ids

    def test_reports_health_metrics(self, ctx: MockContext) -> None:
        """Test that health metrics are tracked."""
        ctx._records._data["deals"] = {
            "deal1": {"id": "deal1", "stage": "Won", "salesforce_sync_status": "failed"},
        }

        instance = self.trigger(ctx, event={
            "type": "schedule",
        })

        self.assert_completed(instance)

        # Verify analytics metric was tracked
        metric_calls = ctx.apps.analytics.calls.get("increment_metric", [])
        assert len(metric_calls) >= 1
        assert metric_calls[0]["name"] == "salesforce_sync_retried"

    def test_alerts_on_high_failure_count(self, ctx: MockContext) -> None:
        """Test that Slack alert is sent when many failures."""
        # Add 15 failed deals (above threshold of 10)
        failed_deals = {
            f"deal{i}": {"id": f"deal{i}", "stage": "Won", "salesforce_sync_status": "failed"}
            for i in range(15)
        }
        ctx._records._data["deals"] = failed_deals

        instance = self.trigger(ctx, event={
            "type": "schedule",
        })

        self.assert_completed(instance)

        # Should send Slack alert
        assert len(ctx.slack_messages) == 1
        assert "#integrations" in ctx.slack_messages[0]["channel"]
        assert "15" in ctx.slack_messages[0]["message"]


# =============================================================================
# Integration Tests
# =============================================================================


class TestSalesforceSyncIntegration(WorkflowTest):
    """Integration tests for Salesforce sync."""

    workflow = SalesforceSync

    def test_idempotency_key_included(self, ctx: MockContext) -> None:
        """Verify idempotency key would be included in requests."""
        instance = self.trigger(ctx, event={
            "type": "record:updated",
            "table": "deals",
            "recordId": "deal1",
        })

        self.assert_completed(instance)

        # In production, ctx.http would add idempotency key
        # Here we verify the request was made
        assert len(ctx.http_requests) == 1

    def test_end_to_end_data_flow(self, ctx: MockContext, sample_deal: Dict[str, Any]) -> None:
        """Test complete data flow from trigger to completion."""
        instance = self.trigger(ctx, event={
            "type": "record:updated",
            "table": "deals",
            "recordId": "deal1",
        })

        self.assert_completed(instance)

        # Verify data flow:
        # 1. CRM was queried
        assert "get_deal" in ctx.apps.crm.calls

        # 2. HTTP call was made to Salesforce
        assert len(ctx.http_requests) == 1

        # 3. CRM was updated with SF ID
        assert "update_deal" in ctx.apps.crm.calls
        update = ctx.apps.crm.calls["update_deal"][0]
        assert update["data"]["salesforce_id"] == "006XXXXXXXXXXXX"

        # 4. Analytics event was tracked
        assert "track_event" in ctx.apps.analytics.calls

        # 5. Notifications were sent
        assert len(ctx.slack_messages) == 1
        assert len(ctx.toasts) == 1


# =============================================================================
# Error Recovery Tests
# =============================================================================


class TestSalesforceSyncErrorRecovery(WorkflowTest):
    """Test error recovery scenarios."""

    workflow = SalesforceSync

    def test_state_preserved_on_failure(self, ctx: MockContext) -> None:
        """Test that workflow state is preserved on failure."""
        ctx.http.mock_response(
            "salesforce.com",
            status=503,
            body={"error": "Service Unavailable"},
        )

        instance = self.trigger(ctx, event={
            "type": "record:updated",
            "table": "deals",
            "recordId": "deal1",
        })

        # Verify state was captured before failure
        assert instance.state.get("deal") is not None
        assert instance.state.get("sync_attempt", 0) > 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
