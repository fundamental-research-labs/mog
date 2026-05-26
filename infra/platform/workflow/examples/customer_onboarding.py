"""
Customer Onboarding Workflow - Multi-Week Sequence Example.

This workflow demonstrates durable, long-running workflows that:
1. Span multiple weeks with sleeps
2. Create onboarding tasks in Bug Tracker
3. Send welcome emails
4. Check task completion and send reminders
5. Update CRM and Analytics on completion

This showcases the power of durable execution - the workflow survives
restarts and continues from the last completed step.
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
    trigger="workflow:spawned",
    runtime="cloud",  # Long-running workflows must run on cloud
    version="1.0.0",
    name="Customer Onboarding",
    description="Multi-week customer onboarding sequence",
    register=False,
)
class CustomerOnboardingWorkflow:
    """
    Multi-week customer onboarding sequence.
    Spawned by DealClosedWorkflow or manually.

    This workflow:
    1. Creates an onboarding project in Bug Tracker
    2. Sends welcome email
    3. Waits 1 week, then checks progress
    4. Sends reminders if behind
    5. Continues for 4 weeks total
    6. Updates CRM and Analytics on completion
    """

    def __init__(self) -> None:
        """Initialize workflow state."""
        self.deal_id: str = ""
        self.deal: Optional[Dict[str, Any]] = None
        self.primary_contact: Optional[Dict[str, Any]] = None
        self.project: Optional[Dict[str, Any]] = None
        self.started_at: Optional[datetime] = None
        self.week: int = 0
        self.tasks_completed: int = 0
        self.tasks_total: int = 0

    @step
    def start(self, event: Dict[str, Any], ctx: Any) -> Any:
        """
        Entry point - initialize from spawned input.

        Args:
            event: Contains input from parent workflow.
            ctx: Workflow context.

        Returns:
            Next step.
        """
        input_data = event.get("input", event)
        self.deal_id = input_data["deal_id"]
        self.started_at = ctx.now()

        # Get deal with relations
        self.deal = ctx.apps.crm.get_deal(
            deal_id=self.deal_id,
            include=["company", "contacts"]
        )

        if not self.deal:
            return complete()

        # Get primary contact
        if self.deal.get("contacts"):
            self.primary_contact = self.deal["contacts"][0]

        return self.create_onboarding_tasks

    @step
    def create_onboarding_tasks(self, ctx: Any) -> Any:
        """
        Create onboarding checklist in Bug Tracker.

        Returns:
            Next step.
        """
        company_name = self.deal["company"]["name"] if self.deal.get("company") else "Unknown"

        # Bug Tracker API - create onboarding checklist
        self.project = ctx.apps.bug_tracker.create_project(
            name=f"Onboarding: {company_name}",
            template="customer-onboarding",
            metadata={
                "deal_id": self.deal_id,
                "company_id": self.deal["company"]["id"] if self.deal.get("company") else None,
            }
        )

        # Get initial task count
        tasks = ctx.apps.bug_tracker.get_project_tasks(project_id=self.project["id"])
        self.tasks_total = len(tasks) if tasks else 5  # Default to 5 if template

        return self.send_welcome

    @step
    def send_welcome(self, ctx: Any) -> Any:
        """
        Send welcome email to primary contact.

        Returns:
            Next step.
        """
        if self.primary_contact:
            company_name = ctx.config.company_name

            ctx.notify.email(
                to=self.primary_contact["email"],
                subject=f"Welcome to {company_name}!",
                template="onboarding_welcome",
                data={
                    "contact": self.primary_contact,
                    "company": self.deal.get("company", {}),
                    "project_link": f"/projects/{self.project['id']}",
                }
            )

        # Wait 1 week, then check in
        ctx.sleep(timedelta(days=7))
        self.week = 1
        return self.check_progress

    @step
    def check_progress(self, ctx: Any) -> Any:
        """
        Check onboarding progress and decide next action.

        Returns:
            Next step based on progress.
        """
        # Get current task status
        tasks = ctx.apps.bug_tracker.get_project_tasks(project_id=self.project["id"])
        self.tasks_completed = sum(1 for t in tasks if t.get("status") == "done") if tasks else 0
        self.tasks_total = len(tasks) if tasks else self.tasks_total

        completion_rate = self.tasks_completed / self.tasks_total if self.tasks_total > 0 else 0

        # Determine if we need to send a reminder
        if self.week == 1:
            if completion_rate < 0.25:
                return self.send_week1_reminder
            return self.schedule_week2
        elif self.week == 2:
            if completion_rate < 0.5:
                return self.send_week2_reminder
            return self.schedule_week3
        elif self.week == 3:
            if completion_rate < 0.75:
                return self.send_week3_reminder
            return self.schedule_final_check
        else:  # Week 4
            if completion_rate >= 1.0:
                return self.complete_onboarding
            return self.escalate_incomplete

    @step
    def send_week1_reminder(self, ctx: Any) -> Any:
        """Send week 1 reminder - getting started help."""
        if self.primary_contact:
            ctx.notify.email(
                to=self.primary_contact["email"],
                subject="Need help getting started?",
                template="onboarding_help",
                data={
                    "completed": self.tasks_completed,
                    "total": self.tasks_total,
                    "project_link": f"/projects/{self.project['id']}",
                }
            )
        return self.schedule_week2

    @step
    def schedule_week2(self, ctx: Any) -> Any:
        """Schedule week 2 check-in."""
        ctx.sleep(timedelta(days=7))
        self.week = 2
        return self.check_progress

    @step
    def send_week2_reminder(self, ctx: Any) -> Any:
        """Send week 2 reminder - midpoint check."""
        if self.primary_contact:
            ctx.notify.email(
                to=self.primary_contact["email"],
                subject="Onboarding Progress Update",
                template="onboarding_midpoint",
                data={
                    "completed": self.tasks_completed,
                    "total": self.tasks_total,
                    "remaining": self.tasks_total - self.tasks_completed,
                }
            )

            # Also send Slack to customer success
            company_name = self.deal["company"]["name"] if self.deal.get("company") else "Unknown"
            ctx.notify.slack(
                channel="#customer-success",
                message=f"Onboarding behind for {company_name}: {self.tasks_completed}/{self.tasks_total} tasks complete"
            )

        return self.schedule_week3

    @step
    def schedule_week3(self, ctx: Any) -> Any:
        """Schedule week 3 check-in."""
        ctx.sleep(timedelta(days=7))
        self.week = 3
        return self.check_progress

    @step
    def send_week3_reminder(self, ctx: Any) -> Any:
        """Send week 3 reminder - urgent."""
        if self.primary_contact:
            ctx.notify.email(
                to=self.primary_contact["email"],
                subject="Urgent: Let's Complete Your Onboarding",
                template="onboarding_urgent",
                data={
                    "completed": self.tasks_completed,
                    "total": self.tasks_total,
                }
            )

            # Notify account owner
            if self.deal.get("owner"):
                ctx.notify.toast(
                    user=self.deal["owner"]["id"],
                    message=f"Onboarding at risk for {self.deal['company']['name']}"
                )

        return self.schedule_final_check

    @step
    def schedule_final_check(self, ctx: Any) -> Any:
        """Schedule final check-in."""
        ctx.sleep(timedelta(days=7))
        self.week = 4
        return self.check_progress

    @step
    def complete_onboarding(self, ctx: Any) -> Any:
        """
        Successfully complete onboarding.

        Updates CRM and Analytics.
        """
        now = ctx.now()
        duration_days = (now - self.started_at).days if self.started_at else 28

        # Update CRM
        ctx.apps.crm.update_deal(
            deal_id=self.deal_id,
            data={
                "onboarding_completed": True,
                "onboarding_completed_at": now.isoformat(),
                "onboarding_duration_days": duration_days,
            }
        )

        # Update Analytics
        ctx.apps.analytics.track_event(
            name="onboarding_completed",
            properties={
                "deal_id": self.deal_id,
                "company": self.deal["company"]["name"] if self.deal.get("company") else "Unknown",
                "duration_days": duration_days,
                "tasks_completed": self.tasks_completed,
                "tasks_total": self.tasks_total,
            }
        )

        # Send completion notification
        if self.primary_contact:
            ctx.notify.email(
                to=self.primary_contact["email"],
                subject="Congratulations! Onboarding Complete",
                template="onboarding_complete",
                data={
                    "contact": self.primary_contact,
                }
            )

        company_name = self.deal["company"]["name"] if self.deal.get("company") else "Unknown"
        ctx.notify.slack(
            channel="#customer-success",
            message=f"Onboarding completed for {company_name}! Duration: {duration_days} days"
        )

        # Signal completion to any listening workflows
        ctx.emit("onboarding:completed", {
            "deal_id": self.deal_id,
            "duration_days": duration_days,
        })

        return complete()

    @step
    def escalate_incomplete(self, ctx: Any) -> Any:
        """
        Handle incomplete onboarding after 4 weeks.

        Escalates to customer success manager.
        """
        company_name = self.deal["company"]["name"] if self.deal.get("company") else "Unknown"

        # Update CRM with at-risk status
        ctx.apps.crm.update_deal(
            deal_id=self.deal_id,
            data={
                "onboarding_at_risk": True,
                "onboarding_progress": f"{self.tasks_completed}/{self.tasks_total}",
            }
        )

        # Track in analytics
        ctx.apps.analytics.track_event(
            name="onboarding_at_risk",
            properties={
                "deal_id": self.deal_id,
                "company": company_name,
                "tasks_completed": self.tasks_completed,
                "tasks_total": self.tasks_total,
            }
        )

        # Escalate to customer success
        ctx.notify.email(
            to="cs-escalations@company.com",
            subject=f"Escalation: {company_name} Onboarding Incomplete",
            body=f"""
Customer onboarding has not been completed after 4 weeks.

Company: {company_name}
Progress: {self.tasks_completed}/{self.tasks_total} tasks
Contact: {self.primary_contact['email'] if self.primary_contact else 'N/A'}

Please reach out to help complete onboarding.
            """.strip()
        )

        ctx.notify.slack(
            channel="#customer-success-escalations",
            message=f"ESCALATION: {company_name} onboarding incomplete after 4 weeks ({self.tasks_completed}/{self.tasks_total} tasks)"
        )

        return complete()


@workflow(
    trigger="manual",
    runtime="cloud",
    version="1.0.0",
    name="Customer Onboarding (Manual)",
    description="Manually triggered onboarding for existing customers",
    register=False,
)
class ManualOnboardingWorkflow(CustomerOnboardingWorkflow):
    """
    Version of onboarding that can be manually triggered.
    Useful for re-onboarding or special cases.
    """

    @step
    def start(self, event: Dict[str, Any], ctx: Any) -> Any:
        """Manual start with deal_id in event."""
        self.deal_id = event.get("deal_id", "")
        self.started_at = ctx.now()

        if not self.deal_id:
            ctx.notify.toast(message="No deal_id provided")
            return complete()

        self.deal = ctx.apps.crm.get_deal(
            deal_id=self.deal_id,
            include=["company", "contacts"]
        )

        if not self.deal:
            ctx.notify.toast(message=f"Deal {self.deal_id} not found")
            return complete()

        if self.deal.get("contacts"):
            self.primary_contact = self.deal["contacts"][0]

        return self.create_onboarding_tasks
