"""
Salesforce Sync Workflow - External API Integration Example.

This workflow demonstrates external API integration patterns:
1. Calling external APIs with idempotency
2. Retry with exponential backoff
3. Handling RetryableError vs NonRetryableError
4. Updating internal records after external sync

Shows how workflows can bridge internal apps with external systems.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from workflow_engine.decorators import workflow, step, retry
from workflow_engine.errors import RetryableError, NonRetryableError
from workflow_engine.testing import complete


@workflow(
    trigger="record:updated",
    table="deals",
    field="stage",
    value="Won",
    runtime="cloud",  # External API calls should run on cloud
    version="1.0.0",
    name="Salesforce Sync",
    description="Sync won deals to Salesforce CRM",
    register=False,
)
class SalesforceSync:
    """
    Sync won deals to Salesforce CRM.

    Demonstrates:
    - External HTTP API calls with idempotency
    - Retry with exponential backoff
    - Error classification (retryable vs non-retryable)
    - Cross-system data synchronization
    """

    def __init__(self) -> None:
        """Initialize workflow state."""
        self.deal: Optional[Dict[str, Any]] = None
        self.sf_id: Optional[str] = None
        self.sync_attempt: int = 0

    @step
    def start(self, event: Dict[str, Any], ctx: Any) -> Any:
        """
        Entry point - fetch the deal to sync.

        Args:
            event: Trigger event with recordId.
            ctx: Workflow context.

        Returns:
            Next step.
        """
        self.deal = ctx.apps.crm.get_deal(
            deal_id=event["recordId"],
            include=["company", "owner"]
        )

        if not self.deal:
            ctx.notify.toast(message="Deal not found for Salesforce sync")
            return complete()

        # Check if already synced
        if self.deal.get("salesforce_id"):
            return self.update_in_salesforce

        return self.create_in_salesforce

    @step
    @retry(max_attempts=3, backoff="exponential", initial_delay="1s", max_delay="1m")
    def create_in_salesforce(self, ctx: Any) -> Any:
        """
        Create opportunity in Salesforce.

        Uses @retry decorator for automatic retry with exponential backoff.
        ctx.http automatically adds idempotency key.

        Returns:
            Next step on success.

        Raises:
            RetryableError: For transient failures (5xx, network).
            NonRetryableError: For permanent failures (auth, validation).
        """
        self.sync_attempt += 1

        # Get Salesforce credentials
        sf_token = ctx.secrets.get("SALESFORCE_TOKEN")
        sf_instance = ctx.secrets.get("SALESFORCE_INSTANCE") or "na1.salesforce.com"

        if not sf_token:
            raise NonRetryableError("Salesforce token not configured")

        # Prepare opportunity data
        opportunity_data = {
            "Name": self.deal["name"],
            "Amount": self.deal["value"],
            "StageName": "Closed Won",
            "CloseDate": ctx.now().strftime("%Y-%m-%d"),
        }

        # Add AccountId if company has Salesforce ID
        if self.deal.get("company") and self.deal["company"].get("salesforce_id"):
            opportunity_data["AccountId"] = self.deal["company"]["salesforce_id"]

        # Add Owner if available
        if self.deal.get("owner") and self.deal["owner"].get("salesforce_user_id"):
            opportunity_data["OwnerId"] = self.deal["owner"]["salesforce_user_id"]

        # Make API call
        # ctx.http automatically adds: Idempotency-Key: {instance_id}-{step_name}-{attempt}
        response = ctx.http.post(
            f"https://{sf_instance}/services/data/v58.0/sobjects/Opportunity",
            headers={
                "Authorization": f"Bearer {sf_token}",
                "Content-Type": "application/json",
            },
            json=opportunity_data,
        )

        # Handle response
        if response.status == 401:
            raise NonRetryableError("Salesforce authentication failed - token expired or invalid")

        if response.status == 400:
            error_body = response.json()
            error_msg = error_body.get("message", "Validation error")
            raise NonRetryableError(f"Salesforce validation error: {error_msg}")

        if response.status == 503 or response.status == 429:
            raise RetryableError(f"Salesforce service unavailable (status {response.status})")

        if not response.ok:
            raise RetryableError(f"Salesforce API error: {response.status}")

        # Success - extract Salesforce ID
        result = response.json()
        self.sf_id = result.get("id")

        return self.update_deal_with_sf_id

    @step
    @retry(max_attempts=3, backoff="exponential", initial_delay="1s", max_delay="1m")
    def update_in_salesforce(self, ctx: Any) -> Any:
        """
        Update existing opportunity in Salesforce.

        For deals that already have a Salesforce ID.
        """
        self.sync_attempt += 1
        self.sf_id = self.deal.get("salesforce_id")

        if not self.sf_id:
            return self.create_in_salesforce

        sf_token = ctx.secrets.get("SALESFORCE_TOKEN")
        sf_instance = ctx.secrets.get("SALESFORCE_INSTANCE") or "na1.salesforce.com"

        if not sf_token:
            raise NonRetryableError("Salesforce token not configured")

        # Update opportunity
        update_data = {
            "StageName": "Closed Won",
            "Amount": self.deal["value"],
            "CloseDate": ctx.now().strftime("%Y-%m-%d"),
        }

        response = ctx.http.patch(
            f"https://{sf_instance}/services/data/v58.0/sobjects/Opportunity/{self.sf_id}",
            headers={
                "Authorization": f"Bearer {sf_token}",
                "Content-Type": "application/json",
            },
            json=update_data,
        )

        if response.status == 401:
            raise NonRetryableError("Salesforce authentication failed")

        if response.status == 404:
            # Opportunity was deleted in Salesforce, create new one
            self.sf_id = None
            return self.create_in_salesforce

        if response.status == 503 or response.status == 429:
            raise RetryableError(f"Salesforce service unavailable (status {response.status})")

        if not response.ok:
            raise RetryableError(f"Salesforce API error: {response.status}")

        return self.update_deal_with_sf_id

    @step
    def update_deal_with_sf_id(self, ctx: Any) -> Any:
        """
        Update the internal CRM deal with Salesforce ID.

        This maintains the link between internal and external records.
        """
        if self.sf_id:
            ctx.apps.crm.update_deal(
                deal_id=self.deal["id"],
                data={
                    "salesforce_id": self.sf_id,
                    "salesforce_synced_at": ctx.now().isoformat(),
                    "salesforce_sync_status": "success",
                }
            )

            # Track successful sync in analytics
            ctx.apps.analytics.track_event(
                name="salesforce_sync_success",
                properties={
                    "deal_id": self.deal["id"],
                    "salesforce_id": self.sf_id,
                    "attempts": self.sync_attempt,
                }
            )

        return self.notify_success

    @step
    def notify_success(self, ctx: Any) -> Any:
        """Send success notification."""
        company_name = self.deal["company"]["name"] if self.deal.get("company") else "Unknown"

        ctx.notify.slack(
            channel="#integrations",
            message=f"Synced deal to Salesforce: {self.deal['name']} ({company_name})"
        )

        if self.deal.get("owner"):
            ctx.notify.toast(
                user=self.deal["owner"]["id"],
                message=f"Deal synced to Salesforce: {self.sf_id}"
            )

        return complete()


@workflow(
    trigger="record:created",
    table="contacts",
    runtime="cloud",
    version="1.0.0",
    name="Salesforce Contact Sync",
    description="Sync new contacts to Salesforce",
    register=False,
)
class SalesforceContactSync:
    """
    Sync new contacts to Salesforce.

    Demonstrates syncing a different entity type.
    """

    def __init__(self) -> None:
        self.contact: Optional[Dict[str, Any]] = None
        self.sf_id: Optional[str] = None

    @step
    def start(self, event: Dict[str, Any], ctx: Any) -> Any:
        """Entry point."""
        self.contact = ctx.records.get("contacts", event["recordId"])

        if not self.contact:
            return complete()

        if self.contact.get("salesforce_id"):
            return complete()  # Already synced

        return self.sync_to_salesforce

    @step
    @retry(max_attempts=3, backoff="exponential", initial_delay="2s", max_delay="2m")
    def sync_to_salesforce(self, ctx: Any) -> Any:
        """Sync contact to Salesforce."""
        sf_token = ctx.secrets.get("SALESFORCE_TOKEN")
        sf_instance = ctx.secrets.get("SALESFORCE_INSTANCE") or "na1.salesforce.com"

        if not sf_token:
            raise NonRetryableError("Salesforce token not configured")

        contact_data = {
            "FirstName": self.contact.get("first_name", ""),
            "LastName": self.contact.get("last_name", self.contact.get("name", "")),
            "Email": self.contact.get("email"),
            "Phone": self.contact.get("phone"),
            "Title": self.contact.get("title"),
        }

        # Add AccountId if company has Salesforce ID
        if self.contact.get("company_id"):
            company = ctx.records.get("companies", self.contact["company_id"])
            if company and company.get("salesforce_id"):
                contact_data["AccountId"] = company["salesforce_id"]

        response = ctx.http.post(
            f"https://{sf_instance}/services/data/v58.0/sobjects/Contact",
            headers={
                "Authorization": f"Bearer {sf_token}",
                "Content-Type": "application/json",
            },
            json=contact_data,
        )

        if response.status == 401:
            raise NonRetryableError("Salesforce authentication failed")

        if not response.ok:
            if response.status >= 500:
                raise RetryableError(f"Salesforce server error: {response.status}")
            raise NonRetryableError(f"Salesforce error: {response.status}")

        result = response.json()
        self.sf_id = result.get("id")

        return self.update_contact

    @step
    def update_contact(self, ctx: Any) -> Any:
        """Update contact with Salesforce ID."""
        if self.sf_id:
            ctx.records.update("contacts", self.contact["id"], {
                "salesforce_id": self.sf_id,
                "salesforce_synced_at": ctx.now().isoformat(),
            })

        return complete()


@workflow(
    trigger="schedule",
    cron="0 */6 * * *",  # Every 6 hours
    timezone="UTC",
    runtime="cloud",
    version="1.0.0",
    name="Salesforce Sync Health Check",
    description="Check and retry failed Salesforce syncs",
    register=False,
)
class SalesforceSyncHealthCheck:
    """
    Scheduled workflow to check and retry failed syncs.

    Runs every 6 hours to:
    1. Find deals that failed to sync
    2. Retry sync for recoverable failures
    3. Report on sync health
    """

    def __init__(self) -> None:
        self.failed_deals: list = []
        self.retried_count: int = 0
        self.success_count: int = 0

    @step
    def start(self, event: Dict[str, Any], ctx: Any) -> Any:
        """Find deals that need sync retry."""
        # Query for deals that failed to sync
        self.failed_deals = ctx.records.list("deals", filter={
            "salesforce_sync_status": "failed",
            "stage": "Won",
        })

        if not self.failed_deals:
            return self.report_health

        return self.retry_syncs

    @step
    def retry_syncs(self, ctx: Any) -> Any:
        """Spawn sync workflows for failed deals."""
        for deal in self.failed_deals:
            # Spawn individual sync workflow
            ctx.spawn(
                workflow_class=SalesforceSync,
                input={"recordId": deal["id"]}
            )
            self.retried_count += 1

        return self.report_health

    @step
    def report_health(self, ctx: Any) -> Any:
        """Report sync health status."""
        # Query for recent successful syncs
        synced_deals = ctx.records.list("deals", filter={
            "salesforce_sync_status": "success",
        }, limit=1000)

        self.success_count = len(synced_deals)

        # Track health metrics
        ctx.apps.analytics.increment_metric(
            name="salesforce_sync_retried",
            value=self.retried_count,
            dimensions={"date": ctx.now().strftime("%Y-%m-%d")}
        )

        # Report if there are issues
        if self.retried_count > 10:
            ctx.notify.slack(
                channel="#integrations",
                message=f"Salesforce Sync Health: {self.retried_count} failed syncs retried, {self.success_count} total synced"
            )

        return complete()
