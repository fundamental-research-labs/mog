"""
WorkflowContext - The main context class available to workflow steps.

This is the runtime context that provides access to all services needed
by workflows: kernel APIs, app APIs, HTTP, notifications, secrets,
time operations, and workflow control.

The context is designed for durable execution:
- All operations are logged for replay/audit
- sleep() triggers automatic cloud promotion
- HTTP requests include idempotency keys
- Secrets are never logged
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Literal, Optional, TYPE_CHECKING
from uuid import uuid4

if TYPE_CHECKING:
    from workflow_engine.context.kernel import TablesAPI, RecordsAPI, RelationsAPI
    from workflow_engine.context.apps import AppsRegistry
    from workflow_engine.context.http_client import HttpClient
    from workflow_engine.context.notification_service import NotificationService
    from workflow_engine.context.secrets_manager import SecretsManager
    from workflow_engine.context.workflows_api import WorkflowsAPI


logger = logging.getLogger(__name__)


@dataclass
class WorkflowConfig:
    """
    Configuration available to workflows.

    This provides access to environment-specific settings and
    company configuration. Values are read-only within workflows.

    Attributes:
        company_name: Name of the company/organization
        environment: Current environment (production, staging, development, test)
        base_url: Base URL for the Data OS instance
        gateway_url: URL for the unified gateway API
        _values: Additional custom configuration values
    """

    company_name: str = "Data OS"
    environment: Literal["production", "staging", "development", "test"] = "development"
    base_url: str = "http://localhost:3000"
    gateway_url: str = "http://localhost:8000"
    _values: Dict[str, Any] = field(default_factory=dict)

    def get(self, key: str, default: Any = None) -> Any:
        """
        Get a configuration value.

        Args:
            key: Configuration key
            default: Default value if key not found

        Returns:
            The configuration value or default
        """
        return self._values.get(key, default)

    def __getattr__(self, name: str) -> Any:
        """Allow attribute access to custom config values."""
        if name.startswith("_"):
            raise AttributeError(name)
        return self._values.get(name)


class WorkflowContext:
    """
    Runtime context available to workflow steps.

    This class provides the complete API available within workflow step methods.
    It coordinates access to kernel data, app APIs, external services, and
    workflow control operations.

    The context maintains state about the current execution:
    - Instance ID and current step
    - Runtime environment (local or cloud)
    - Attempt number for retries

    All operations that can fail are durable:
    - Logged for audit trail
    - Idempotent where possible
    - Resumable on restart

    Example:
        @step
        def process_order(self, ctx):
            # Get data from kernel
            order = ctx.records.get("orders", self.order_id)

            # Call app API
            invoice = ctx.apps.finance.create_invoice(
                customer_id=order["customer_id"],
                amount=order["total"]
            )

            # External HTTP call
            response = ctx.http.post(
                "https://api.stripe.com/charges",
                json={"amount": order["total"]}
            )

            # Send notification
            ctx.notify.email(
                to=order["customer_email"],
                subject="Order confirmed",
                template="order_confirmation",
                data={"order": order}
            )

            return self.next_step()
    """

    def __init__(
        self,
        instance_id: str,
        workflow_id: str,
        current_step: str,
        runtime: Literal["local", "cloud"],
        config: Optional[WorkflowConfig] = None,
        # Kernel APIs
        tables_api: Optional["TablesAPI"] = None,
        records_api: Optional["RecordsAPI"] = None,
        relations_api: Optional["RelationsAPI"] = None,
        # App APIs
        apps_registry: Optional["AppsRegistry"] = None,
        # External services
        http_client: Optional["HttpClient"] = None,
        notification_service: Optional["NotificationService"] = None,
        secrets_manager: Optional["SecretsManager"] = None,
        # Workflow services
        workflows_api: Optional["WorkflowsAPI"] = None,
        # Time source (injectable for testing)
        time_source: Optional[Callable[[], datetime]] = None,
        # Callbacks for context operations
        on_sleep: Optional[Callable[[timedelta], None]] = None,
        on_spawn: Optional[Callable[[type, Dict[str, Any]], str]] = None,
        on_emit: Optional[Callable[[str, Dict[str, Any]], None]] = None,
        on_promote: Optional[Callable[[], None]] = None,
        # Current attempt (for idempotency keys)
        attempt_number: int = 1,
    ) -> None:
        """
        Initialize the workflow context.

        Most parameters are optional for flexibility in testing and
        different runtime environments.

        Args:
            instance_id: Unique identifier for this workflow instance
            workflow_id: Identifier of the workflow definition
            current_step: Name of the current step being executed
            runtime: Whether running locally or in cloud
            config: Workflow configuration
            tables_api: Tables kernel API
            records_api: Records kernel API
            relations_api: Relations kernel API
            apps_registry: Registry of app APIs
            http_client: HTTP client for external requests
            notification_service: Service for sending notifications
            secrets_manager: Manager for accessing secrets
            workflows_api: API for interacting with other workflows
            time_source: Callable returning current time (for testing)
            on_sleep: Callback when sleep() is called
            on_spawn: Callback when spawn() is called
            on_emit: Callback when emit() is called
            on_promote: Callback when promote_to_cloud() is called
            attempt_number: Current retry attempt (1 = first attempt)
        """
        self._instance_id = instance_id
        self._workflow_id = workflow_id
        self._current_step = current_step
        self._runtime: Literal["local", "cloud"] = runtime
        self._config = config or WorkflowConfig()
        self._attempt_number = attempt_number

        # Kernel APIs
        self._tables_api = tables_api
        self._records_api = records_api
        self._relations_api = relations_api

        # App APIs
        self._apps_registry = apps_registry

        # External services
        self._http_client = http_client
        self._notification_service = notification_service
        self._secrets_manager = secrets_manager

        # Workflow services
        self._workflows_api = workflows_api

        # Time source
        self._time_source = time_source or (lambda: datetime.now(timezone.utc))

        # Callbacks
        self._on_sleep = on_sleep
        self._on_spawn = on_spawn
        self._on_emit = on_emit
        self._on_promote = on_promote

        # Track spawned workflows and emitted events for auditing
        self._spawned_workflows: List[Dict[str, Any]] = []
        self._emitted_events: List[Dict[str, Any]] = []

    # =========================================================================
    # Instance Information
    # =========================================================================

    @property
    def instance_id(self) -> str:
        """Get the current workflow instance ID."""
        return self._instance_id

    @property
    def workflow_id(self) -> str:
        """Get the workflow definition ID."""
        return self._workflow_id

    @property
    def current_step(self) -> str:
        """Get the name of the current step being executed."""
        return self._current_step

    @property
    def runtime(self) -> Literal["local", "cloud"]:
        """Get the current runtime environment (local or cloud)."""
        return self._runtime

    @property
    def config(self) -> WorkflowConfig:
        """Get the workflow configuration."""
        return self._config

    @property
    def attempt_number(self) -> int:
        """Get the current attempt number (1 = first attempt)."""
        return self._attempt_number

    # =========================================================================
    # Kernel APIs (Low-Level Data Access)
    # =========================================================================

    @property
    def tables(self) -> "TablesAPI":
        """
        Access the Tables API for table operations.

        Example:
            table = ctx.tables.find_by_name("Expenses")
            all_tables = ctx.tables.list()
        """
        if self._tables_api is None:
            from workflow_engine.context.kernel import TablesAPI
            raise RuntimeError("TablesAPI not configured in context")
        return self._tables_api

    @property
    def records(self) -> "RecordsAPI":
        """
        Access the Records API for CRUD operations on records.

        Example:
            expense = ctx.records.get("expenses", record_id)
            expenses = ctx.records.list("expenses", filter={"status": "pending"})
            new_record = ctx.records.create("expenses", {"amount": 100})
            ctx.records.update("expenses", record_id, {"status": "approved"})
            ctx.records.delete("expenses", record_id)
        """
        if self._records_api is None:
            from workflow_engine.context.kernel import RecordsAPI
            raise RuntimeError("RecordsAPI not configured in context")
        return self._records_api

    @property
    def relations(self) -> "RelationsAPI":
        """
        Access the Relations API for relation traversal.

        Example:
            related = ctx.relations.get_related("deals", deal_id, "contact_id")
            backlinks = ctx.relations.get_backlinks("contacts", contact_id)
        """
        if self._relations_api is None:
            from workflow_engine.context.kernel import RelationsAPI
            raise RuntimeError("RelationsAPI not configured in context")
        return self._relations_api

    # =========================================================================
    # App APIs (High-Level Domain Operations)
    # =========================================================================

    @property
    def apps(self) -> "AppsRegistry":
        """
        Access app-specific APIs (CRM, Finance, Spreadsheet, etc.).

        Example:
            deal = ctx.apps.crm.get_deal(deal_id)
            invoice = ctx.apps.finance.create_invoice(customer_id=..., amount=...)
            ctx.apps.spreadsheet.append_row("Log", [date, value])
        """
        if self._apps_registry is None:
            from workflow_engine.context.apps import AppsRegistry
            raise RuntimeError("AppsRegistry not configured in context")
        return self._apps_registry

    # =========================================================================
    # External Communication
    # =========================================================================

    @property
    def http(self) -> "HttpClient":
        """
        Access the HTTP client for external API calls.

        The HTTP client automatically adds idempotency keys to requests:
        {instance_id}-{step_name}-{attempt_number}

        Example:
            response = ctx.http.post(
                "https://api.stripe.com/v1/charges",
                headers={"Authorization": f"Bearer {ctx.secrets.get('STRIPE_KEY')}"},
                json={"amount": 1000, "currency": "usd"}
            )
            if response.ok:
                data = response.json()
        """
        if self._http_client is None:
            from workflow_engine.context.http_client import HttpClient
            raise RuntimeError("HttpClient not configured in context")
        return self._http_client

    @property
    def notify(self) -> "NotificationService":
        """
        Access the notification service for email, Slack, and toasts.

        Example:
            # Email with action buttons
            ctx.notify.email(
                to="manager@company.com",
                subject="Approval needed",
                body="Please review this expense",
                actions=[
                    {"label": "Approve", "event": "approved"},
                    {"label": "Reject", "event": "rejected"}
                ]
            )

            # Slack message
            ctx.notify.slack(channel="#sales", message="New deal closed!")

            # In-app toast
            ctx.notify.toast(user=user_id, message="Request approved")
        """
        if self._notification_service is None:
            from workflow_engine.context.notification_service import NotificationService
            raise RuntimeError("NotificationService not configured in context")
        return self._notification_service

    @property
    def secrets(self) -> "SecretsManager":
        """
        Access secrets (API keys, tokens, credentials).

        Secrets are NEVER logged. Access is audited but values are masked.

        Example:
            api_key = ctx.secrets.get("OPENAI_API_KEY")
            sf_token = ctx.secrets.get("SALESFORCE_TOKEN")
        """
        if self._secrets_manager is None:
            from workflow_engine.context.secrets_manager import SecretsManager
            raise RuntimeError("SecretsManager not configured in context")
        return self._secrets_manager

    # =========================================================================
    # Workflow Control
    # =========================================================================

    @property
    def workflows(self) -> "WorkflowsAPI":
        """
        Query and control other workflow instances.

        Example:
            # Find running workflows
            instances = ctx.workflows.find(
                workflow_class="CustomerOnboarding",
                filter={"deal_id": deal_id},
                status=["running", "waiting"]
            )

            # Signal another workflow
            ctx.workflows.signal(instance_id, "payment_received", {"amount": 100})

            # Cancel a workflow
            ctx.workflows.cancel(instance_id, reason="User requested")
        """
        if self._workflows_api is None:
            from workflow_engine.context.workflows_api import WorkflowsAPI
            raise RuntimeError("WorkflowsAPI not configured in context")
        return self._workflows_api

    # =========================================================================
    # Time Operations
    # =========================================================================

    def now(self) -> datetime:
        """
        Get the current time.

        This returns a consistent time within workflow execution.
        The time is timezone-aware (UTC).

        Returns:
            Current datetime in UTC
        """
        return self._time_source()

    def sleep(self, duration: timedelta) -> None:
        """
        Pause the workflow for a duration.

        IMPORTANT: This triggers automatic promotion to cloud runtime
        if currently running locally. This ensures the workflow continues
        even if the browser is closed.

        The workflow state is persisted and execution resumes after
        the duration has elapsed.

        Args:
            duration: How long to sleep

        Example:
            # Wait 1 week before next check-in
            ctx.sleep(timedelta(days=7))
        """
        logger.info(
            "Workflow sleep requested",
            extra={
                "instance_id": self._instance_id,
                "step": self._current_step,
                "duration_seconds": duration.total_seconds(),
                "runtime": self._runtime,
            }
        )

        # Trigger promotion to cloud if local
        if self._runtime == "local":
            self.promote_to_cloud()

        # Call the sleep handler
        if self._on_sleep:
            self._on_sleep(duration)

    def spawn(self, workflow_class: type, input_data: Dict[str, Any]) -> str:
        """
        Start a child workflow.

        The child workflow runs independently but is linked to this
        instance for tracking. The child can emit events that this
        workflow can wait for.

        Args:
            workflow_class: The workflow class to instantiate
            input_data: Input data passed to the child workflow

        Returns:
            The instance ID of the spawned workflow

        Example:
            child_id = ctx.spawn(CustomerOnboarding, {"deal_id": deal_id})
        """
        logger.info(
            "Spawning child workflow",
            extra={
                "parent_instance_id": self._instance_id,
                "child_workflow": workflow_class.__name__,
                "input_keys": list(input_data.keys()),
            }
        )

        # Generate child instance ID if no callback
        if self._on_spawn:
            child_id = self._on_spawn(workflow_class, input_data)
        else:
            child_id = f"inst_{uuid4().hex[:12]}"

        # Track spawned workflow
        self._spawned_workflows.append({
            "child_id": child_id,
            "workflow_class": workflow_class.__name__,
            "input": input_data,
            "spawned_at": self.now().isoformat(),
        })

        return child_id

    def emit(self, event_type: str, data: Dict[str, Any]) -> None:
        """
        Emit an event.

        Events can trigger other workflows or signal waiting workflows.
        Events are delivered asynchronously.

        Args:
            event_type: The event type (e.g., "onboarding:completed")
            data: Event payload data

        Example:
            ctx.emit("onboarding:completed", {"deal_id": deal_id})
        """
        logger.info(
            "Emitting event",
            extra={
                "instance_id": self._instance_id,
                "event_type": event_type,
                "data_keys": list(data.keys()),
            }
        )

        # Track emitted event
        self._emitted_events.append({
            "event_type": event_type,
            "data": data,
            "emitted_at": self.now().isoformat(),
            "source_instance": self._instance_id,
        })

        # Call the emit handler
        if self._on_emit:
            self._on_emit(event_type, data)

    def promote_to_cloud(self) -> None:
        """
        Explicitly promote this workflow to cloud runtime.

        This is automatically called when sleep() is invoked from
        local runtime. You can also call it explicitly if you know
        the workflow will need to run for a long time.

        No-op if already running in cloud.

        Example:
            if self.requires_long_running:
                ctx.promote_to_cloud()
        """
        if self._runtime == "cloud":
            logger.debug("Already running in cloud, promotion skipped")
            return

        logger.info(
            "Promoting workflow to cloud",
            extra={
                "instance_id": self._instance_id,
                "step": self._current_step,
            }
        )

        self._runtime = "cloud"

        if self._on_promote:
            self._on_promote()

    # =========================================================================
    # Context Management
    # =========================================================================

    def update_step(self, step_name: str) -> None:
        """
        Update the current step name.

        Called by the engine when transitioning between steps.

        Args:
            step_name: Name of the new current step
        """
        self._current_step = step_name

    def update_attempt(self, attempt: int) -> None:
        """
        Update the attempt number.

        Called by the engine on retry.

        Args:
            attempt: New attempt number
        """
        self._attempt_number = attempt

    def get_idempotency_key(self, operation: str = "") -> str:
        """
        Generate an idempotency key for the current context.

        Format: {instance_id}-{step_name}-{attempt}-{operation}

        Args:
            operation: Optional operation identifier for multiple
                       operations within a single step

        Returns:
            Unique idempotency key
        """
        parts = [self._instance_id, self._current_step, str(self._attempt_number)]
        if operation:
            parts.append(operation)
        return "-".join(parts)

    @property
    def spawned_workflows(self) -> List[Dict[str, Any]]:
        """Get list of workflows spawned during this execution."""
        return list(self._spawned_workflows)

    @property
    def emitted_events(self) -> List[Dict[str, Any]]:
        """Get list of events emitted during this execution."""
        return list(self._emitted_events)


class ContextFactory:
    """
    Factory for creating WorkflowContext instances.

    This centralizes context creation and dependency injection,
    making it easy to configure contexts for different environments.
    """

    def __init__(
        self,
        config: Optional[WorkflowConfig] = None,
        gateway_url: str = "http://localhost:8000",
    ) -> None:
        """
        Initialize the context factory.

        Args:
            config: Default workflow configuration
            gateway_url: URL of the unified gateway
        """
        self._config = config or WorkflowConfig()
        self._gateway_url = gateway_url

    def create_context(
        self,
        instance_id: str,
        workflow_id: str,
        current_step: str,
        runtime: Literal["local", "cloud"],
        attempt_number: int = 1,
        **kwargs: Any,
    ) -> WorkflowContext:
        """
        Create a new WorkflowContext.

        Args:
            instance_id: Workflow instance ID
            workflow_id: Workflow definition ID
            current_step: Current step name
            runtime: Runtime environment
            attempt_number: Current attempt number
            **kwargs: Additional arguments passed to WorkflowContext

        Returns:
            Configured WorkflowContext
        """
        # Import here to avoid circular imports
        from workflow_engine.context.kernel import TablesAPI, RecordsAPI, RelationsAPI
        from workflow_engine.context.apps import AppsRegistry
        from workflow_engine.context.http_client import HttpClient
        from workflow_engine.context.notification_service import NotificationService
        from workflow_engine.context.secrets_manager import SecretsManager
        from workflow_engine.context.workflows_api import WorkflowsAPI

        # Create HTTP client with idempotency support
        http_client = HttpClient(
            base_idempotency_key=f"{instance_id}-{current_step}-{attempt_number}",
        )

        # Create app registry with gateway client
        apps_registry = AppsRegistry(gateway_url=self._gateway_url)

        # Create kernel APIs
        tables_api = TablesAPI(gateway_url=self._gateway_url)
        records_api = RecordsAPI(gateway_url=self._gateway_url)
        relations_api = RelationsAPI(gateway_url=self._gateway_url)

        # Create notification service
        notification_service = NotificationService(gateway_url=self._gateway_url)

        # Create secrets manager
        secrets_manager = SecretsManager()

        # Create workflows API
        workflows_api = WorkflowsAPI(gateway_url=self._gateway_url)

        return WorkflowContext(
            instance_id=instance_id,
            workflow_id=workflow_id,
            current_step=current_step,
            runtime=runtime,
            config=self._config,
            tables_api=tables_api,
            records_api=records_api,
            relations_api=relations_api,
            apps_registry=apps_registry,
            http_client=http_client,
            notification_service=notification_service,
            secrets_manager=secrets_manager,
            workflows_api=workflows_api,
            attempt_number=attempt_number,
            **kwargs,
        )
