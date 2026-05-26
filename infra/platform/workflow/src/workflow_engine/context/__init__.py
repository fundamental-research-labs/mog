"""
WorkflowContext - Runtime context for workflow execution.

This module provides the WorkflowContext that is passed to workflow steps,
giving access to:
- Kernel APIs (tables, records, relations)
- App APIs (CRM, Finance, Spreadsheet, Analytics, Bug Tracker)
- External communication (HTTP client, notifications, secrets)
- Time and scheduling (now, sleep)
- Workflow control (spawn, emit, workflows)

Usage in workflows:
    @step
    def my_step(self, ctx):
        # Access kernel data
        record = ctx.records.get("expenses", record_id)

        # Call app APIs
        deal = ctx.apps.crm.get_deal(deal_id)

        # Make external HTTP calls
        response = ctx.http.post("https://api.example.com/data")

        # Send notifications
        ctx.notify.email(to="user@example.com", subject="Hello")

        # Access secrets
        api_key = ctx.secrets.get("API_KEY")

        # Get current time
        now = ctx.now()

        # Sleep (triggers cloud promotion)
        ctx.sleep(timedelta(hours=24))

        # Spawn child workflows
        child_id = ctx.spawn(OtherWorkflow, {"input": "data"})

        # Emit events
        ctx.emit("task:completed", {"id": task_id})
"""

from workflow_engine.context.base import (
    WorkflowContext,
    WorkflowConfig,
)

from workflow_engine.context.kernel import (
    TablesAPI,
    RecordsAPI,
    RelationsAPI,
)

from workflow_engine.context.apps import (
    AppsRegistry,
    AppClient,
    CRMAPI,
    FinanceAPI,
    SpreadsheetAPI,
    AnalyticsAPI,
    BugTrackerAPI,
)

from workflow_engine.context.http_client import (
    HttpClient,
    HttpResponse,
    HttpError,
)

from workflow_engine.context.notification_service import (
    NotificationService,
    EmailAction,
)

from workflow_engine.context.secrets_manager import (
    SecretsManager,
    SecretNotFoundError,
)

from workflow_engine.context.workflows_api import (
    WorkflowsAPI,
    WorkflowInstanceInfo,
)


__all__ = [
    # Main context
    "WorkflowContext",
    "WorkflowConfig",
    # Kernel APIs
    "TablesAPI",
    "RecordsAPI",
    "RelationsAPI",
    # App APIs
    "AppsRegistry",
    "AppClient",
    "CRMAPI",
    "FinanceAPI",
    "SpreadsheetAPI",
    "AnalyticsAPI",
    "BugTrackerAPI",
    # HTTP
    "HttpClient",
    "HttpResponse",
    "HttpError",
    # Notifications
    "NotificationService",
    "EmailAction",
    # Secrets
    "SecretsManager",
    "SecretNotFoundError",
    # Workflows API
    "WorkflowsAPI",
    "WorkflowInstanceInfo",
]
