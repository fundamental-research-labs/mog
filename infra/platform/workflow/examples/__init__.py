"""
Example workflows for the Data OS workflow engine.

These examples serve as both documentation and validation of the workflow engine.
They demonstrate the full range of capabilities:

1. **Expense Approval** (expense_approval.py)
   - Basic workflows with auto-approval logic
   - Human-in-the-loop workflows with @wait_for
   - Timeout handling and escalation
   - Email notifications with action buttons

2. **Deal Closed Workflow** (deal_closed.py)
   - Cross-app orchestration (CRM, Finance, Analytics, Spreadsheet)
   - Triggered when a deal closes in CRM
   - Creates invoice, updates metrics, logs to spreadsheet
   - Sends Slack and toast notifications

3. **Customer Onboarding** (customer_onboarding.py)
   - Multi-week durable workflows with sleeps
   - Creates project in Bug Tracker
   - Progress tracking with reminders
   - Updates CRM and Analytics on completion

4. **Salesforce Sync** (salesforce_sync.py)
   - External API integration with idempotency
   - Retry with exponential backoff
   - RetryableError vs NonRetryableError handling
   - Scheduled health checks

5. **Weekly Report** (weekly_report.py)
   - Scheduled workflows (cron-triggered)
   - Data aggregation across apps
   - Spreadsheet report generation
   - Email and Slack notifications

Example:
    from workflow_engine.examples import ExpenseApproval, DealClosedWorkflow

    # Use in tests:
    from workflow_engine.testing import WorkflowTest, MockContext

    class TestMyWorkflow(WorkflowTest):
        workflow = DealClosedWorkflow

        def test_full_flow(self):
            ctx = MockContext({...})
            instance = self.trigger(ctx, event={...})
            self.assert_completed(instance)
"""

from workflow_engine.examples.expense_approval import ExpenseApproval
from workflow_engine.examples.deal_closed import (
    DealClosedWorkflow,
    DealClosedWithOnboardingWorkflow,
)
from workflow_engine.examples.customer_onboarding import (
    CustomerOnboardingWorkflow,
    ManualOnboardingWorkflow,
)
from workflow_engine.examples.salesforce_sync import (
    SalesforceSync,
    SalesforceContactSync,
    SalesforceSyncHealthCheck,
)
from workflow_engine.examples.weekly_report import (
    WeeklyReport,
    MonthlyPipelineReview,
    EndOfWeekSummary,
)

__all__ = [
    # Expense approval
    "ExpenseApproval",
    # Deal closed workflows
    "DealClosedWorkflow",
    "DealClosedWithOnboardingWorkflow",
    # Onboarding workflows
    "CustomerOnboardingWorkflow",
    "ManualOnboardingWorkflow",
    # Salesforce sync workflows
    "SalesforceSync",
    "SalesforceContactSync",
    "SalesforceSyncHealthCheck",
    # Scheduled report workflows
    "WeeklyReport",
    "MonthlyPipelineReview",
    "EndOfWeekSummary",
]
