"""
Deal Closed Workflow - Cross-App Orchestration Example.

This workflow demonstrates the power of OS-level, cross-app workflows.
When a deal closes in CRM:
1. Get deal with company, contacts, owner via CRM app API
2. Create invoice via Finance app API
3. Update metrics via Analytics app API
4. Append row to spreadsheet via Spreadsheet app API
5. Send Slack and toast notifications

This single workflow touches 4 different apps seamlessly, showcasing
the value of having workflows at the OS level rather than app level.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

# Import workflow decorators and testing utilities
# In production, these would be from the dataos.workflow package
import sys
from pathlib import Path

# Add parent src to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from workflow_engine.decorators import workflow, step
from workflow_engine.testing import complete


@workflow(
    trigger="record:updated",
    table="deals",
    field="stage",
    value="Won",
    runtime="auto",
    version="1.0.0",
    name="Deal Closed Workflow",
    description="Cross-app workflow triggered when a deal closes",
    register=False,  # Don't auto-register for examples
)
class DealClosedWorkflow:
    """
    When a deal closes in CRM:
    1. Create invoice in Finance
    2. Update forecast in Analytics
    3. Log to Spreadsheet
    4. Notify team

    Touches 4 apps in one workflow.
    """

    def __init__(self) -> None:
        """Initialize workflow state."""
        self.deal: Optional[Dict[str, Any]] = None
        self.invoice: Optional[Dict[str, Any]] = None
        self.row_number: Optional[int] = None

    @step
    def start(self, event: Dict[str, Any], ctx: Any) -> Any:
        """
        Entry point - fetch the deal with all related data.

        Args:
            event: The trigger event containing recordId.
            ctx: The workflow context.

        Returns:
            Next step to execute.
        """
        # CRM API - get deal with all relations
        self.deal = ctx.apps.crm.get_deal(
            deal_id=event["recordId"],
            include=["company", "contacts", "owner"]
        )

        # Validate deal exists and has required data
        if not self.deal:
            ctx.notify.toast(message="Deal not found")
            return complete()

        if not self.deal.get("company"):
            ctx.notify.toast(message=f"Deal {self.deal.get('name', 'unknown')} has no company")
            return self.notify_team  # Still notify but skip invoice

        return self.create_invoice

    @step
    def create_invoice(self, ctx: Any) -> Any:
        """
        Create an invoice in the Finance app.

        Returns:
            Next step to execute.
        """
        # Finance API - handles invoice numbering, validation
        self.invoice = ctx.apps.finance.create_invoice(
            customer_id=self.deal["company"]["id"],
            line_items=[{
                "description": f"Services - {self.deal['name']}",
                "amount": self.deal["value"]
            }],
            due_days=30,
            source_deal_id=self.deal["id"]
        )

        return self.update_analytics

    @step
    def update_analytics(self, ctx: Any) -> Any:
        """
        Update analytics metrics for the closed deal.

        Returns:
            Next step to execute.
        """
        # Analytics API - increment metrics
        ctx.apps.analytics.increment_metric(
            name="closed_revenue",
            value=self.deal["value"],
            dimensions={
                "quarter": self._get_quarter(ctx.now()),
                "rep": self.deal["owner"]["email"] if self.deal.get("owner") else "unknown",
                "segment": self.deal["company"].get("segment", "unknown")
            }
        )

        # Also track the deal count
        ctx.apps.analytics.increment_metric(
            name="deals_closed",
            value=1,
            dimensions={
                "quarter": self._get_quarter(ctx.now()),
                "rep": self.deal["owner"]["email"] if self.deal.get("owner") else "unknown",
            }
        )

        return self.log_to_spreadsheet

    @step
    def log_to_spreadsheet(self, ctx: Any) -> Any:
        """
        Append a row to the tracking spreadsheet.

        Returns:
            Next step to execute.
        """
        # Spreadsheet API - append row to tracking sheet
        self.row_number = ctx.apps.spreadsheet.append_row(
            sheet="Closed Deals Log",
            values=[
                ctx.now().isoformat(),
                self.deal["company"]["name"],
                self.deal["name"],
                self.deal["value"],
                self.deal["owner"]["name"] if self.deal.get("owner") else "N/A",
                self.invoice["number"] if self.invoice else "N/A"
            ]
        )

        return self.notify_team

    @step
    def notify_team(self, ctx: Any) -> Any:
        """
        Send notifications to the team.

        Returns:
            Completion marker.
        """
        owner_name = self.deal["owner"]["name"] if self.deal.get("owner") else "Unknown"
        company_name = self.deal["company"]["name"] if self.deal.get("company") else "Unknown Company"
        value = self.deal.get("value", 0)

        # Slack notification to #wins channel
        ctx.notify.slack(
            channel="#wins",
            message=f"Deal closed! {owner_name} closed {company_name} for ${value:,}!"
        )

        # Toast notification to deal owner
        if self.deal.get("owner"):
            invoice_info = f"Invoice {self.invoice['number']} created" if self.invoice else "Invoice pending"
            ctx.notify.toast(
                user=self.deal["owner"]["id"],
                message=f"{invoice_info} for {company_name}"
            )

        return complete()

    def _get_quarter(self, dt: datetime) -> str:
        """
        Get the quarter string for a datetime.

        Args:
            dt: The datetime to get the quarter for.

        Returns:
            Quarter string like "Q1 2026".
        """
        return f"Q{(dt.month - 1) // 3 + 1} {dt.year}"


@workflow(
    trigger="record:updated",
    table="deals",
    field="stage",
    value="Won",
    runtime="auto",
    version="1.0.0",
    name="Deal Closed With Onboarding",
    description="Deal closed workflow that also spawns customer onboarding",
    register=False,
)
class DealClosedWithOnboardingWorkflow:
    """
    Extended version that also spawns a customer onboarding workflow.
    Demonstrates child workflow spawning.
    """

    def __init__(self) -> None:
        self.deal: Optional[Dict[str, Any]] = None
        self.invoice: Optional[Dict[str, Any]] = None
        self.onboarding_id: Optional[str] = None

    @step
    def start(self, event: Dict[str, Any], ctx: Any) -> Any:
        """Entry point."""
        self.deal = ctx.apps.crm.get_deal(
            deal_id=event["recordId"],
            include=["company", "contacts", "owner"]
        )

        if not self.deal:
            return complete()

        return self.create_invoice

    @step
    def create_invoice(self, ctx: Any) -> Any:
        """Create invoice."""
        if self.deal.get("company"):
            self.invoice = ctx.apps.finance.create_invoice(
                customer_id=self.deal["company"]["id"],
                line_items=[{
                    "description": f"Services - {self.deal['name']}",
                    "amount": self.deal["value"]
                }],
                due_days=30,
            )
        return self.spawn_onboarding

    @step
    def spawn_onboarding(self, ctx: Any) -> Any:
        """Spawn the customer onboarding workflow."""
        # Import here to avoid circular dependency in real code
        from workflow_engine.testing import MockContext  # For type hint only

        # Spawn child workflow - this is an OS-level capability
        self.onboarding_id = ctx.spawn(
            workflow_class=type("CustomerOnboarding", (), {}),  # Reference to workflow class
            input={
                "deal_id": self.deal["id"],
                "company_id": self.deal["company"]["id"] if self.deal.get("company") else None,
                "primary_contact_email": (
                    self.deal["contacts"][0]["email"]
                    if self.deal.get("contacts")
                    else None
                ),
            }
        )

        return self.notify_team

    @step
    def notify_team(self, ctx: Any) -> Any:
        """Send notifications."""
        owner_name = self.deal["owner"]["name"] if self.deal.get("owner") else "Unknown"
        company_name = self.deal["company"]["name"] if self.deal.get("company") else "Unknown"

        ctx.notify.slack(
            channel="#wins",
            message=f"Deal closed! {owner_name} closed {company_name}! Onboarding started."
        )

        return complete()
