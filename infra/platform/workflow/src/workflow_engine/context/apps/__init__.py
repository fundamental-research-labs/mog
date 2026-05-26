"""
App APIs - High-level domain-specific APIs for workflows.

This module provides app-specific APIs that workflows use to perform
domain operations. Each app exposes a typed API with domain concepts.

Apps available:
- CRM: Deals, contacts, companies, pipelines
- Finance: Invoices, payments, accounts, transactions
- Spreadsheet: Cells, rows, sheets, charts
- Analytics: Events, metrics, dashboards, funnels
- Bug Tracker: Issues, projects, sprints

These APIs call through the unified gateway and handle domain-specific
validation, resolution, and business logic.
"""

from workflow_engine.context.apps.client import AppClient
from workflow_engine.context.apps.crm import CRMAPI
from workflow_engine.context.apps.finance import FinanceAPI
from workflow_engine.context.apps.spreadsheet import SpreadsheetAPI
from workflow_engine.context.apps.analytics import AnalyticsAPI
from workflow_engine.context.apps.bug_tracker import BugTrackerAPI


class AppsRegistry:
    """
    Registry providing access to all app APIs.

    This is the main entry point for workflows to access app-specific
    functionality through ctx.apps.

    Example:
        # Access CRM
        deal = ctx.apps.crm.get_deal(deal_id)

        # Access Finance
        invoice = ctx.apps.finance.create_invoice(customer_id=..., amount=...)

        # Access Spreadsheet
        ctx.apps.spreadsheet.append_row("Log", [date, value])

        # Access Analytics
        ctx.apps.analytics.track_event("deal_closed", {"value": 50000})

        # Access Bug Tracker
        issue = ctx.apps.bug_tracker.create_issue(title="Fix bug", project="main")
    """

    def __init__(
        self,
        gateway_url: str = "http://localhost:8000",
        app_client: AppClient | None = None,
    ) -> None:
        """
        Initialize the apps registry.

        Args:
            gateway_url: URL of the unified gateway
            app_client: Optional shared app client
        """
        self._gateway_url = gateway_url
        self._client = app_client or AppClient(gateway_url=gateway_url)

        # Initialize app APIs (lazy-loaded)
        self._crm: CRMAPI | None = None
        self._finance: FinanceAPI | None = None
        self._spreadsheet: SpreadsheetAPI | None = None
        self._analytics: AnalyticsAPI | None = None
        self._bug_tracker: BugTrackerAPI | None = None

    @property
    def crm(self) -> CRMAPI:
        """
        Access the CRM API.

        Provides operations for deals, contacts, companies, and pipelines.
        """
        if self._crm is None:
            self._crm = CRMAPI(client=self._client)
        return self._crm

    @property
    def finance(self) -> FinanceAPI:
        """
        Access the Finance API.

        Provides operations for invoices, payments, accounts, and transactions.
        """
        if self._finance is None:
            self._finance = FinanceAPI(client=self._client)
        return self._finance

    @property
    def spreadsheet(self) -> SpreadsheetAPI:
        """
        Access the Spreadsheet API.

        Provides operations for cells, rows, sheets, formulas, and charts.
        """
        if self._spreadsheet is None:
            self._spreadsheet = SpreadsheetAPI(client=self._client)
        return self._spreadsheet

    @property
    def analytics(self) -> AnalyticsAPI:
        """
        Access the Analytics API.

        Provides operations for events, metrics, dashboards, and funnels.
        """
        if self._analytics is None:
            self._analytics = AnalyticsAPI(client=self._client)
        return self._analytics

    @property
    def bug_tracker(self) -> BugTrackerAPI:
        """
        Access the Bug Tracker API.

        Provides operations for issues, projects, and sprints.
        """
        if self._bug_tracker is None:
            self._bug_tracker = BugTrackerAPI(client=self._client)
        return self._bug_tracker

    def close(self) -> None:
        """Close the underlying HTTP client."""
        self._client.close()


__all__ = [
    "AppsRegistry",
    "AppClient",
    "CRMAPI",
    "FinanceAPI",
    "SpreadsheetAPI",
    "AnalyticsAPI",
    "BugTrackerAPI",
]
