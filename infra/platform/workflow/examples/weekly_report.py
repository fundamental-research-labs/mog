"""
Weekly Report Workflow - Scheduled Workflow Example.

This workflow demonstrates scheduled workflows that:
1. Run on a cron schedule (every Monday at 9am)
2. Query data from CRM
3. Generate a spreadsheet report
4. Send email and Slack notifications

Scheduled workflows always run on cloud runtime.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from workflow_engine.decorators import workflow, step
from workflow_engine.testing import complete


@workflow(
    trigger="schedule",
    cron="0 9 * * 1",  # Every Monday at 9am
    timezone="America/New_York",
    runtime="cloud",  # Schedules always run on cloud
    version="1.0.0",
    name="Weekly Sales Report",
    description="Generate and send weekly sales report every Monday",
    register=False,
)
class WeeklyReport:
    """
    Generate and send weekly sales report.

    Runs every Monday at 9am ET:
    1. Query CRM for deals closed in the past week
    2. Calculate metrics and group by rep
    3. Generate/update spreadsheet with report data
    4. Send email summary to sales team
    5. Post to Slack
    """

    def __init__(self) -> None:
        """Initialize workflow state."""
        self.report: Optional[Dict[str, Any]] = None
        self.sheet_name: str = ""
        self.deals: List[Dict[str, Any]] = []

    @step
    def start(self, event: Dict[str, Any], ctx: Any) -> Any:
        """
        Entry point - calculate date range and fetch data.

        Args:
            event: Schedule trigger event.
            ctx: Workflow context.

        Returns:
            Next step.
        """
        # Calculate the date range (past 7 days)
        now = ctx.now()
        week_ago = now - timedelta(days=7)

        # Query CRM for deals closed in the past week
        self.deals = ctx.apps.crm.get_deals_closed_between(
            start_date=week_ago.isoformat(),
            end_date=now.isoformat(),
        ) or []

        # Calculate report data
        revenue = sum(d.get("value", 0) for d in self.deals)
        pipeline = ctx.apps.crm.get_pipeline_metrics(pipeline_id="default") or {}

        self.report = {
            "period_start": week_ago.strftime("%b %d"),
            "period_end": now.strftime("%b %d"),
            "period": f"{week_ago.strftime('%b %d')} - {now.strftime('%b %d')}",
            "deals_closed": len(self.deals),
            "revenue": revenue,
            "pipeline_value": pipeline.get("total_value", 0),
            "by_rep": self._group_by_rep(self.deals),
            "by_segment": self._group_by_segment(self.deals),
            "top_deals": self._get_top_deals(self.deals, limit=5),
        }

        return self.generate_spreadsheet

    @step
    def generate_spreadsheet(self, ctx: Any) -> Any:
        """
        Create or update the weekly report spreadsheet.

        Returns:
            Next step.
        """
        # Generate sheet name based on date
        self.sheet_name = f"Weekly Report {ctx.now().strftime('%Y-%m-%d')}"

        # Try to get existing sheet, create if not exists
        try:
            existing = ctx.apps.spreadsheet.get_sheet(name=self.sheet_name)
        except Exception:
            ctx.apps.spreadsheet.create_sheet(name=self.sheet_name)

        # Build the report content

        # Header row for summary section
        ctx.apps.spreadsheet.set_range(
            sheet=self.sheet_name,
            range="A1:B1",
            values=[["Weekly Sales Report", self.report["period"]]]
        )

        # Summary metrics
        ctx.apps.spreadsheet.set_range(
            sheet=self.sheet_name,
            range="A3:B6",
            values=[
                ["Metric", "Value"],
                ["Deals Closed", self.report["deals_closed"]],
                ["Revenue", f"${self.report['revenue']:,}"],
                ["Pipeline Value", f"${self.report['pipeline_value']:,}"],
            ]
        )

        # Rep breakdown header
        ctx.apps.spreadsheet.set_range(
            sheet=self.sheet_name,
            range="A8:D8",
            values=[["Rep", "Deals", "Revenue", "% of Total"]]
        )

        # Rep data rows
        rep_data = []
        for rep_name, data in self.report["by_rep"].items():
            pct = (data["revenue"] / self.report["revenue"] * 100) if self.report["revenue"] > 0 else 0
            rep_data.append([
                rep_name,
                data["count"],
                f"${data['revenue']:,}",
                f"{pct:.1f}%"
            ])

        if rep_data:
            end_row = 8 + len(rep_data)
            ctx.apps.spreadsheet.set_range(
                sheet=self.sheet_name,
                range=f"A9:D{end_row}",
                values=rep_data
            )

        # Top deals section
        top_deals_start = 10 + len(rep_data)
        ctx.apps.spreadsheet.set_range(
            sheet=self.sheet_name,
            range=f"A{top_deals_start}:C{top_deals_start}",
            values=[["Top Deals", "", ""]]
        )

        top_deals_header_row = top_deals_start + 1
        ctx.apps.spreadsheet.set_range(
            sheet=self.sheet_name,
            range=f"A{top_deals_header_row}:C{top_deals_header_row}",
            values=[["Company", "Deal", "Value"]]
        )

        top_deals_data = []
        for deal in self.report["top_deals"]:
            company_name = deal.get("company", {}).get("name", "Unknown") if deal.get("company") else "Unknown"
            top_deals_data.append([
                company_name,
                deal.get("name", "Unknown"),
                f"${deal.get('value', 0):,}"
            ])

        if top_deals_data:
            start_row = top_deals_header_row + 1
            end_row = start_row + len(top_deals_data) - 1
            ctx.apps.spreadsheet.set_range(
                sheet=self.sheet_name,
                range=f"A{start_row}:C{end_row}",
                values=top_deals_data
            )

        return self.send_email

    @step
    def send_email(self, ctx: Any) -> Any:
        """
        Send report email to sales team.

        Returns:
            Next step.
        """
        # Build email body
        top_deals_text = "\n".join([
            f"  - {d.get('company', {}).get('name', 'Unknown') if d.get('company') else 'Unknown'}: ${d.get('value', 0):,}"
            for d in self.report["top_deals"][:3]
        ])

        top_reps_text = "\n".join([
            f"  - {name}: {data['count']} deals, ${data['revenue']:,}"
            for name, data in sorted(
                self.report["by_rep"].items(),
                key=lambda x: x[1]["revenue"],
                reverse=True
            )[:3]
        ])

        body = f"""
Weekly Sales Report: {self.report['period']}

Summary:
- Deals Closed: {self.report['deals_closed']}
- Revenue: ${self.report['revenue']:,}
- Pipeline Value: ${self.report['pipeline_value']:,}

Top Performers:
{top_reps_text if top_reps_text else '  No deals this week'}

Top Deals:
{top_deals_text if top_deals_text else '  No deals this week'}

Full report: [View Spreadsheet]
        """.strip()

        ctx.notify.email(
            to="sales-team@company.com",
            subject=f"Weekly Sales Report - {self.report['period']}",
            body=body,
            template="weekly_report",
            data=self.report,
        )

        return self.send_slack

    @step
    def send_slack(self, ctx: Any) -> Any:
        """
        Post summary to Slack.

        Returns:
            Completion marker.
        """
        # Build Slack message with key metrics
        message_parts = [
            f"Weekly Report: {self.report['period']}",
            f"{self.report['deals_closed']} deals closed",
            f"${self.report['revenue']:,} revenue",
        ]

        # Add top performer if any
        if self.report["by_rep"]:
            top_rep = max(self.report["by_rep"].items(), key=lambda x: x[1]["revenue"])
            message_parts.append(f"Top performer: {top_rep[0]} (${top_rep[1]['revenue']:,})")

        ctx.notify.slack(
            channel="#sales",
            message=" | ".join(message_parts)
        )

        # Track report generation in analytics
        ctx.apps.analytics.track_event(
            name="weekly_report_generated",
            properties={
                "deals_count": self.report["deals_closed"],
                "revenue": self.report["revenue"],
                "reps_count": len(self.report["by_rep"]),
            }
        )

        return complete()

    def _group_by_rep(self, deals: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        """Group deals by sales rep."""
        result: Dict[str, Dict[str, Any]] = {}
        for deal in deals:
            owner = deal.get("owner")
            rep_name = owner.get("name", "Unknown") if owner else "Unassigned"
            if rep_name not in result:
                result[rep_name] = {"count": 0, "revenue": 0}
            result[rep_name]["count"] += 1
            result[rep_name]["revenue"] += deal.get("value", 0)
        return result

    def _group_by_segment(self, deals: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        """Group deals by company segment."""
        result: Dict[str, Dict[str, Any]] = {}
        for deal in deals:
            company = deal.get("company")
            segment = company.get("segment", "Unknown") if company else "Unknown"
            if segment not in result:
                result[segment] = {"count": 0, "revenue": 0}
            result[segment]["count"] += 1
            result[segment]["revenue"] += deal.get("value", 0)
        return result

    def _get_top_deals(self, deals: List[Dict[str, Any]], limit: int = 5) -> List[Dict[str, Any]]:
        """Get top deals by value."""
        sorted_deals = sorted(deals, key=lambda d: d.get("value", 0), reverse=True)
        return sorted_deals[:limit]


@workflow(
    trigger="schedule",
    cron="0 8 1 * *",  # 1st of every month at 8am
    timezone="America/New_York",
    runtime="cloud",
    version="1.0.0",
    name="Monthly Pipeline Review",
    description="Generate monthly pipeline review report",
    register=False,
)
class MonthlyPipelineReview:
    """
    Monthly pipeline review workflow.

    Runs on the 1st of every month:
    1. Calculate pipeline metrics
    2. Compare to previous month
    3. Generate report
    4. Send to leadership
    """

    def __init__(self) -> None:
        self.current_metrics: Optional[Dict[str, Any]] = None
        self.previous_metrics: Optional[Dict[str, Any]] = None
        self.report: Optional[Dict[str, Any]] = None

    @step
    def start(self, event: Dict[str, Any], ctx: Any) -> Any:
        """Gather current and previous month metrics."""
        now = ctx.now()

        # Current month metrics
        self.current_metrics = ctx.apps.crm.get_pipeline_metrics(
            pipeline_id="default",
            as_of_date=now.isoformat(),
        ) or {}

        # Previous month metrics (30 days ago)
        previous_date = now - timedelta(days=30)
        self.previous_metrics = ctx.apps.crm.get_pipeline_metrics(
            pipeline_id="default",
            as_of_date=previous_date.isoformat(),
        ) or {}

        return self.calculate_changes

    @step
    def calculate_changes(self, ctx: Any) -> Any:
        """Calculate month-over-month changes."""
        current_value = self.current_metrics.get("total_value", 0)
        previous_value = self.previous_metrics.get("total_value", 0)

        change = current_value - previous_value
        change_pct = (change / previous_value * 100) if previous_value > 0 else 0

        current_deals = self.current_metrics.get("deal_count", 0)
        previous_deals = self.previous_metrics.get("deal_count", 0)
        deals_change = current_deals - previous_deals

        self.report = {
            "current_value": current_value,
            "previous_value": previous_value,
            "change": change,
            "change_pct": change_pct,
            "current_deals": current_deals,
            "previous_deals": previous_deals,
            "deals_change": deals_change,
            "by_stage": self.current_metrics.get("by_stage", {}),
        }

        return self.send_report

    @step
    def send_report(self, ctx: Any) -> Any:
        """Send the monthly report."""
        trend = "up" if self.report["change"] > 0 else "down" if self.report["change"] < 0 else "flat"
        trend_emoji = {"up": "arrow_up", "down": "arrow_down", "flat": "minus"}[trend]

        ctx.notify.email(
            to="leadership@company.com",
            subject=f"Monthly Pipeline Review - {ctx.now().strftime('%B %Y')}",
            template="monthly_pipeline",
            data=self.report,
        )

        ctx.notify.slack(
            channel="#sales-leadership",
            message=(
                f"Monthly Pipeline Review: ${self.report['current_value']:,} "
                f"({'+' if self.report['change'] >= 0 else ''}{self.report['change_pct']:.1f}% MoM)"
            )
        )

        return complete()


@workflow(
    trigger="schedule",
    cron="0 18 * * 5",  # Every Friday at 6pm
    timezone="America/New_York",
    runtime="cloud",
    version="1.0.0",
    name="End of Week Summary",
    description="Send end-of-week summary to team",
    register=False,
)
class EndOfWeekSummary:
    """
    End of week summary workflow.

    Runs every Friday at 6pm:
    1. Summarize the week's activities
    2. Send celebratory message if targets met
    3. Post to team Slack
    """

    def __init__(self) -> None:
        self.deals_closed: List[Dict[str, Any]] = []
        self.total_revenue: float = 0
        self.weekly_target: float = 100000  # Default target

    @step
    def start(self, event: Dict[str, Any], ctx: Any) -> Any:
        """Gather this week's data."""
        now = ctx.now()
        week_start = now - timedelta(days=4)  # Monday

        self.deals_closed = ctx.apps.crm.get_deals_closed_between(
            start_date=week_start.isoformat(),
            end_date=now.isoformat(),
        ) or []

        self.total_revenue = sum(d.get("value", 0) for d in self.deals_closed)

        # Get weekly target from config
        self.weekly_target = ctx.config.get("weekly_sales_target", 100000)

        return self.send_summary

    @step
    def send_summary(self, ctx: Any) -> Any:
        """Send the summary."""
        target_met = self.total_revenue >= self.weekly_target
        pct_of_target = (self.total_revenue / self.weekly_target * 100) if self.weekly_target > 0 else 0

        if target_met:
            message = f"Great week! {len(self.deals_closed)} deals, ${self.total_revenue:,} revenue ({pct_of_target:.0f}% of target)"
        else:
            message = f"Week ended: {len(self.deals_closed)} deals, ${self.total_revenue:,} ({pct_of_target:.0f}% of target)"

        ctx.notify.slack(
            channel="#sales",
            message=message
        )

        # Track metrics
        ctx.apps.analytics.increment_metric(
            name="weekly_revenue",
            value=self.total_revenue,
            dimensions={"week": ctx.now().strftime("%Y-W%U")}
        )

        return complete()
