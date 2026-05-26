"""
MockContext - Complete mock implementation of the WorkflowContext.

This module provides MockContext, which mocks all kernel and app APIs
for testing workflows without running actual services.

Example:
    ctx = MockContext({
        "deals": {
            "deal1": {"id": "deal1", "name": "Acme", "value": 50000}
        },
        "contacts": {
            "c1": {"id": "c1", "name": "Alice", "email": "alice@acme.com"}
        }
    })

    # Mock app API responses
    ctx.apps.crm.mock_responses({
        "get_deal": {"id": "deal1", "name": "Acme", ...}
    })

    # Use in workflow test
    instance = test.trigger(ctx, event={...})

    # Verify calls were made
    assert ctx.apps.crm.calls["get_deal"][0]["deal_id"] == "deal1"
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Literal, Optional, TypeVar, Union
from uuid import uuid4

from workflow_engine.testing.time_travel import TimeTraveler
from workflow_engine.testing.event_simulation import EventSimulator


# Type for record data
RecordData = Dict[str, Any]
TableData = Dict[str, RecordData]  # record_id -> record


@dataclass
class MockRecordsAPI:
    """
    Mock implementation of the Records API (kernel-level).

    Tracks all record operations for verification in tests.
    """

    _data: Dict[str, TableData] = field(default_factory=dict)
    creates: Dict[str, List[RecordData]] = field(default_factory=dict)
    updates: Dict[str, Dict[str, RecordData]] = field(default_factory=dict)
    deletes: Dict[str, List[str]] = field(default_factory=dict)

    def get(self, table: str, record_id: str) -> Optional[RecordData]:
        """Get a record by ID."""
        table_data = self._data.get(table, {})
        return table_data.get(record_id)

    def list(
        self,
        table: str,
        filter: Optional[Dict[str, Any]] = None,
        limit: Optional[int] = None,
        offset: int = 0,
    ) -> List[RecordData]:
        """List records from a table with optional filtering."""
        table_data = self._data.get(table, {})
        records = list(table_data.values())

        if filter:
            # Simple filter implementation
            filtered = []
            for record in records:
                match = True
                for key, value in filter.items():
                    if isinstance(value, dict):
                        # Handle operators like {"operator": "equals", "value": ...}
                        op = value.get("operator", "equals")
                        target = value.get("value")
                        field_value = record.get(key)
                        if op == "equals" and field_value != target:
                            match = False
                        elif op == "not_equals" and field_value == target:
                            match = False
                        elif op == "contains" and target not in str(field_value):
                            match = False
                        elif op == "gt" and not (field_value > target):
                            match = False
                        elif op == "lt" and not (field_value < target):
                            match = False
                        elif op == "gte" and not (field_value >= target):
                            match = False
                        elif op == "lte" and not (field_value <= target):
                            match = False
                    else:
                        # Simple equality
                        if record.get(key) != value:
                            match = False
                    if not match:
                        break
                if match:
                    filtered.append(record)
            records = filtered

        # Apply offset and limit
        records = records[offset:]
        if limit is not None:
            records = records[:limit]

        return records

    def create(self, table: str, data: RecordData) -> RecordData:
        """Create a new record."""
        record_id = data.get("id", f"rec_{uuid4().hex[:12]}")
        record = {"id": record_id, **data}

        if table not in self._data:
            self._data[table] = {}
        self._data[table][record_id] = record

        if table not in self.creates:
            self.creates[table] = []
        self.creates[table].append(record)

        return record

    def update(self, table: str, record_id: str, data: RecordData) -> RecordData:
        """Update an existing record."""
        if table not in self._data:
            self._data[table] = {}

        existing = self._data[table].get(record_id, {"id": record_id})
        updated = {**existing, **data}
        self._data[table][record_id] = updated

        if table not in self.updates:
            self.updates[table] = {}
        if record_id not in self.updates[table]:
            self.updates[table][record_id] = {}
        self.updates[table][record_id].update(data)

        return updated

    def delete(self, table: str, record_id: str) -> bool:
        """Delete a record."""
        if table not in self.deletes:
            self.deletes[table] = []
        self.deletes[table].append(record_id)

        if table in self._data and record_id in self._data[table]:
            del self._data[table][record_id]
            return True
        return False

    def reset_tracking(self) -> None:
        """Reset operation tracking but keep data."""
        self.creates.clear()
        self.updates.clear()
        self.deletes.clear()


@dataclass
class MockTablesAPI:
    """Mock implementation of the Tables API (kernel-level)."""

    _tables: Dict[str, Dict[str, Any]] = field(default_factory=dict)

    def find_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        """Find a table by name."""
        return self._tables.get(name)

    def list(self) -> List[Dict[str, Any]]:
        """List all tables."""
        return list(self._tables.values())

    def create(self, name: str, schema: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Create a table."""
        table = {
            "id": f"tbl_{uuid4().hex[:12]}",
            "name": name,
            "schema": schema or {},
        }
        self._tables[name] = table
        return table


@dataclass
class MockRelationsAPI:
    """Mock implementation of the Relations API (kernel-level)."""

    _relations: Dict[str, List[Dict[str, str]]] = field(default_factory=dict)

    def get_related(
        self,
        table: str,
        record_id: str,
        column: str,
    ) -> List[Dict[str, Any]]:
        """Get related records."""
        key = f"{table}:{record_id}:{column}"
        return self._relations.get(key, [])

    def get_backlinks(
        self,
        table: str,
        record_id: str,
    ) -> List[Dict[str, Any]]:
        """Get records that link to this record."""
        backlinks = []
        for key, relations in self._relations.items():
            for rel in relations:
                if rel.get("target_id") == record_id:
                    backlinks.append(rel)
        return backlinks

    def link(
        self,
        source_table: str,
        source_id: str,
        column: str,
        target_table: str,
        target_id: str,
    ) -> None:
        """Create a relation."""
        key = f"{source_table}:{source_id}:{column}"
        if key not in self._relations:
            self._relations[key] = []
        self._relations[key].append({
            "source_table": source_table,
            "source_id": source_id,
            "target_table": target_table,
            "target_id": target_id,
        })


@dataclass
class MockAppAPI:
    """
    Mock implementation for a single app's API.

    Tracks all method calls and allows configuring mock responses.
    """

    app_name: str
    _responses: Dict[str, Any] = field(default_factory=dict)
    _response_sequences: Dict[str, List[Any]] = field(default_factory=dict)
    _response_handlers: Dict[str, Callable[..., Any]] = field(default_factory=dict)
    calls: Dict[str, List[Dict[str, Any]]] = field(default_factory=dict)

    def mock_responses(self, responses: Dict[str, Any]) -> None:
        """
        Configure mock responses for methods.

        Args:
            responses: Dict mapping method names to return values.
        """
        self._responses.update(responses)

    def mock_response_sequence(self, method: str, responses: List[Any]) -> None:
        """
        Configure a sequence of responses for repeated calls.

        Args:
            method: The method name.
            responses: List of return values for each call.
        """
        self._response_sequences[method] = list(responses)

    def mock_handler(self, method: str, handler: Callable[..., Any]) -> None:
        """
        Configure a custom handler for a method.

        Args:
            method: The method name.
            handler: Function called with method parameters.
        """
        self._response_handlers[method] = handler

    def __getattr__(self, name: str) -> Callable[..., Any]:
        """Handle method calls dynamically."""
        def method_call(**kwargs: Any) -> Any:
            # Record the call
            if name not in self.calls:
                self.calls[name] = []
            self.calls[name].append(kwargs)

            # Check for custom handler
            if name in self._response_handlers:
                return self._response_handlers[name](**kwargs)

            # Check for response sequence
            if name in self._response_sequences and self._response_sequences[name]:
                return self._response_sequences[name].pop(0)

            # Return configured response or None
            return self._responses.get(name)

        return method_call

    def reset_calls(self) -> None:
        """Reset call tracking."""
        self.calls.clear()


@dataclass
class MockAppsRegistry:
    """
    Registry of mock app APIs.

    Provides access to all app APIs (crm, finance, spreadsheet, analytics, etc.).
    """

    crm: MockAppAPI = field(default_factory=lambda: MockAppAPI("crm"))
    finance: MockAppAPI = field(default_factory=lambda: MockAppAPI("finance"))
    spreadsheet: MockAppAPI = field(default_factory=lambda: MockAppAPI("spreadsheet"))
    analytics: MockAppAPI = field(default_factory=lambda: MockAppAPI("analytics"))
    bug_tracker: MockAppAPI = field(default_factory=lambda: MockAppAPI("bug_tracker"))
    form_builder: MockAppAPI = field(default_factory=lambda: MockAppAPI("form_builder"))

    def __getattr__(self, name: str) -> MockAppAPI:
        """Get or create an app API mock."""
        # Create dynamically if not pre-defined
        app = MockAppAPI(name)
        setattr(self, name, app)
        return app

    def reset_all_calls(self) -> None:
        """Reset call tracking for all apps."""
        for name in ["crm", "finance", "spreadsheet", "analytics", "bug_tracker", "form_builder"]:
            getattr(self, name).reset_calls()


@dataclass
class MockHttpResponse:
    """Mock HTTP response."""

    status: int
    _body: Any
    headers: Dict[str, str] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        """Check if response is successful (2xx)."""
        return 200 <= self.status < 300

    def json(self) -> Any:
        """Get response body as JSON."""
        return self._body

    def text(self) -> str:
        """Get response body as text."""
        return str(self._body)


@dataclass
class MockHttpClient:
    """
    Mock HTTP client for external API calls.

    Tracks all requests and allows configuring mock responses.
    """

    requests: List[Dict[str, Any]] = field(default_factory=list)
    _responses: Dict[str, MockHttpResponse] = field(default_factory=dict)
    _default_response: MockHttpResponse = field(
        default_factory=lambda: MockHttpResponse(200, {})
    )

    def mock_response(
        self,
        url_pattern: str,
        status: int = 200,
        body: Any = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> None:
        """Configure a mock response for a URL pattern."""
        self._responses[url_pattern] = MockHttpResponse(
            status=status,
            _body=body or {},
            headers=headers or {},
        )

    def _find_response(self, url: str) -> MockHttpResponse:
        """Find a matching response for a URL."""
        for pattern, response in self._responses.items():
            if pattern in url:
                return response
        return self._default_response

    def get(
        self,
        url: str,
        headers: Optional[Dict[str, str]] = None,
        params: Optional[Dict[str, Any]] = None,
    ) -> MockHttpResponse:
        """Make a GET request."""
        self.requests.append({
            "method": "GET",
            "url": url,
            "headers": headers,
            "params": params,
        })
        return self._find_response(url)

    def post(
        self,
        url: str,
        headers: Optional[Dict[str, str]] = None,
        json: Optional[Dict[str, Any]] = None,
        data: Optional[Any] = None,
    ) -> MockHttpResponse:
        """Make a POST request."""
        self.requests.append({
            "method": "POST",
            "url": url,
            "headers": headers,
            "json": json,
            "data": data,
        })
        return self._find_response(url)

    def put(
        self,
        url: str,
        headers: Optional[Dict[str, str]] = None,
        json: Optional[Dict[str, Any]] = None,
    ) -> MockHttpResponse:
        """Make a PUT request."""
        self.requests.append({
            "method": "PUT",
            "url": url,
            "headers": headers,
            "json": json,
        })
        return self._find_response(url)

    def delete(
        self,
        url: str,
        headers: Optional[Dict[str, str]] = None,
    ) -> MockHttpResponse:
        """Make a DELETE request."""
        self.requests.append({
            "method": "DELETE",
            "url": url,
            "headers": headers,
        })
        return self._find_response(url)

    def patch(
        self,
        url: str,
        headers: Optional[Dict[str, str]] = None,
        json: Optional[Dict[str, Any]] = None,
    ) -> MockHttpResponse:
        """Make a PATCH request."""
        self.requests.append({
            "method": "PATCH",
            "url": url,
            "headers": headers,
            "json": json,
        })
        return self._find_response(url)


@dataclass
class MockNotificationService:
    """
    Mock notification service for email, Slack, and in-app toasts.

    Captures all notifications for verification in tests.
    """

    _emails: List[Dict[str, Any]] = field(default_factory=list)
    _slack_messages: List[Dict[str, Any]] = field(default_factory=list)
    _toasts: List[Dict[str, Any]] = field(default_factory=list)

    def email(
        self,
        to: str,
        subject: str,
        body: Optional[str] = None,
        template: Optional[str] = None,
        data: Optional[Dict[str, Any]] = None,
        actions: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        """Send an email notification."""
        self._emails.append({
            "to": to,
            "subject": subject,
            "body": body,
            "template": template,
            "data": data,
            "actions": actions,
        })

    def slack(
        self,
        channel: str,
        message: str,
        blocks: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        """Send a Slack message."""
        self._slack_messages.append({
            "channel": channel,
            "message": message,
            "blocks": blocks,
        })

    def toast(
        self,
        user: Optional[str] = None,
        message: str = "",
    ) -> None:
        """Show an in-app toast notification."""
        self._toasts.append({
            "user": user,
            "message": message,
        })

    @property
    def emails(self) -> List[Dict[str, Any]]:
        """Get all sent emails."""
        return list(self._emails)

    @property
    def slack_messages(self) -> List[Dict[str, Any]]:
        """Get all sent Slack messages."""
        return list(self._slack_messages)

    @property
    def toasts(self) -> List[Dict[str, Any]]:
        """Get all shown toasts."""
        return list(self._toasts)

    def clear(self) -> None:
        """Clear all captured notifications."""
        self._emails.clear()
        self._slack_messages.clear()
        self._toasts.clear()


@dataclass
class MockSecretsManager:
    """Mock secrets manager."""

    _secrets: Dict[str, str] = field(default_factory=dict)

    def get(self, key: str) -> Optional[str]:
        """Get a secret value."""
        return self._secrets.get(key)

    def set(self, key: str, value: str) -> None:
        """Set a secret value (for testing)."""
        self._secrets[key] = value


@dataclass
class MockWorkflowsAPI:
    """Mock API for querying and signaling other workflows."""

    _instances: Dict[str, Any] = field(default_factory=dict)
    signals_sent: List[Dict[str, Any]] = field(default_factory=list)
    cancellations: List[Dict[str, Any]] = field(default_factory=list)

    def find(
        self,
        workflow_class: Optional[str] = None,
        filter: Optional[Dict[str, Any]] = None,
        status: Optional[List[str]] = None,
    ) -> List[Any]:
        """Find workflow instances."""
        results = list(self._instances.values())

        if workflow_class:
            results = [i for i in results if i.workflow_class == workflow_class]
        if status:
            results = [i for i in results if i.status in status]
        if filter:
            filtered = []
            for instance in results:
                match = True
                for key, value in filter.items():
                    if getattr(instance, key, None) != value:
                        match = False
                        break
                if match:
                    filtered.append(instance)
            results = filtered

        return results

    def signal(
        self,
        instance_id: str,
        event_type: str,
        data: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Signal another workflow."""
        self.signals_sent.append({
            "instance_id": instance_id,
            "event_type": event_type,
            "data": data or {},
        })

    def cancel(
        self,
        instance_id: str,
        reason: Optional[str] = None,
    ) -> None:
        """Cancel a workflow."""
        self.cancellations.append({
            "instance_id": instance_id,
            "reason": reason,
        })

    def register_instance(self, instance: Any) -> None:
        """Register an instance (for testing)."""
        self._instances[instance.id] = instance


@dataclass
class MockConfig:
    """Mock workflow configuration."""

    company_name: str = "Test Company"
    environment: str = "test"
    _values: Dict[str, Any] = field(default_factory=dict)

    def get(self, key: str, default: Any = None) -> Any:
        """Get a configuration value."""
        return self._values.get(key, default)

    def set(self, key: str, value: Any) -> None:
        """Set a configuration value (for testing)."""
        self._values[key] = value


class MockContext:
    """
    Complete mock implementation of the WorkflowContext.

    Provides mock implementations of all APIs available to workflows:
    - Kernel APIs: records, tables, relations
    - App APIs: crm, finance, spreadsheet, analytics, etc.
    - External APIs: http, notify, secrets
    - Time/Workflow: now(), sleep(), spawn(), emit(), workflows

    Usage:
        ctx = MockContext({
            "expenses": {
                "exp1": {"id": "exp1", "amount": 100, "employee_id": "emp1"}
            }
        })

        # Mock app API responses
        ctx.apps.crm.mock_responses({"get_deal": {...}})

        # Use with workflow test
        instance = test.trigger(ctx, event={...})

        # Verify behavior
        assert ctx.records.updates["expenses"]["exp1"]["status"] == "approved"
        assert ctx.apps.finance.calls["create_invoice"][0]["amount"] == 100
    """

    def __init__(
        self,
        initial_data: Optional[Dict[str, TableData]] = None,
        initial_time: Optional[datetime] = None,
    ) -> None:
        """
        Initialize the mock context.

        Args:
            initial_data: Initial record data by table.
            initial_time: Starting time for the time traveler.
        """
        # Kernel APIs
        self._records = MockRecordsAPI(_data=initial_data or {})
        self._tables = MockTablesAPI()
        self._relations = MockRelationsAPI()

        # App APIs
        self._apps = MockAppsRegistry()

        # External APIs
        self._http = MockHttpClient()
        self._notify = MockNotificationService()
        self._secrets = MockSecretsManager()

        # Workflow management
        self._workflows_api = MockWorkflowsAPI()
        self._config = MockConfig()

        # Time travel
        self._time = TimeTraveler(initial_time=initial_time)

        # Event simulation
        self._events = EventSimulator()
        self._events.set_time_source(self._time.now)

        # Instance tracking
        self._instance_id: str = ""
        self._current_step: str = ""
        self._runtime: Literal["local", "cloud"] = "local"
        self._spawned_workflows: List[Dict[str, Any]] = []
        self._emitted_events: List[Dict[str, Any]] = []

    # =========================================================================
    # Kernel APIs
    # =========================================================================

    @property
    def records(self) -> MockRecordsAPI:
        """Access the records API."""
        return self._records

    @property
    def tables(self) -> MockTablesAPI:
        """Access the tables API."""
        return self._tables

    @property
    def relations(self) -> MockRelationsAPI:
        """Access the relations API."""
        return self._relations

    # =========================================================================
    # App APIs
    # =========================================================================

    @property
    def apps(self) -> MockAppsRegistry:
        """Access app APIs."""
        return self._apps

    # =========================================================================
    # External APIs
    # =========================================================================

    @property
    def http(self) -> MockHttpClient:
        """Access the HTTP client."""
        return self._http

    @property
    def notify(self) -> MockNotificationService:
        """Access the notification service."""
        return self._notify

    @property
    def secrets(self) -> MockSecretsManager:
        """Access the secrets manager."""
        return self._secrets

    # =========================================================================
    # Time
    # =========================================================================

    @property
    def time(self) -> TimeTraveler:
        """Access the time traveler for advancing time."""
        return self._time

    def now(self) -> datetime:
        """Get current simulated time."""
        return self._time.now()

    def sleep(self, duration: timedelta) -> None:
        """
        Sleep for a duration.

        In tests, this registers a pending sleep that can be
        completed by advancing time.
        """
        wake_at = self._time.now() + duration
        self._time.register_sleep(
            wake_at=wake_at,
            instance_id=self._instance_id,
            step_name=self._current_step,
        )

    # =========================================================================
    # Events
    # =========================================================================

    @property
    def events(self) -> EventSimulator:
        """Access the event simulator."""
        return self._events

    # =========================================================================
    # Workflow Control
    # =========================================================================

    def spawn(self, workflow_class: type, input: Dict[str, Any]) -> str:
        """Spawn a child workflow."""
        child_id = f"inst_{uuid4().hex[:12]}"
        self._spawned_workflows.append({
            "id": child_id,
            "workflow_class": workflow_class.__name__,
            "input": input,
            "parent_id": self._instance_id,
        })
        return child_id

    def emit(self, event_type: str, data: Dict[str, Any]) -> None:
        """Emit an event."""
        self._emitted_events.append({
            "type": event_type,
            "data": data,
            "source_instance": self._instance_id,
        })

    @property
    def workflows(self) -> MockWorkflowsAPI:
        """Access the workflows API."""
        return self._workflows_api

    def promote_to_cloud(self) -> None:
        """Promote workflow to cloud runtime."""
        self._runtime = "cloud"

    # =========================================================================
    # Instance Info
    # =========================================================================

    @property
    def instance_id(self) -> str:
        """Get current instance ID."""
        return self._instance_id

    @property
    def current_step(self) -> str:
        """Get current step name."""
        return self._current_step

    @property
    def runtime(self) -> Literal["local", "cloud"]:
        """Get current runtime."""
        return self._runtime

    @property
    def config(self) -> MockConfig:
        """Get workflow configuration."""
        return self._config

    # =========================================================================
    # Test Setup Methods
    # =========================================================================

    def set_instance_info(
        self,
        instance_id: str,
        current_step: str = "",
        runtime: Literal["local", "cloud"] = "local",
    ) -> None:
        """Set instance info (used by test harness)."""
        self._instance_id = instance_id
        self._current_step = current_step
        self._runtime = runtime

    # =========================================================================
    # Convenience Properties for Assertions
    # =========================================================================

    @property
    def emails(self) -> List[Dict[str, Any]]:
        """Get all sent emails."""
        return self._notify.emails

    @property
    def slack_messages(self) -> List[Dict[str, Any]]:
        """Get all sent Slack messages."""
        return self._notify.slack_messages

    @property
    def toasts(self) -> List[Dict[str, Any]]:
        """Get all shown toasts."""
        return self._notify.toasts

    @property
    def spawned_workflows(self) -> List[Dict[str, Any]]:
        """Get all spawned child workflows."""
        return list(self._spawned_workflows)

    @property
    def emitted_events(self) -> List[Dict[str, Any]]:
        """Get all emitted events."""
        return list(self._emitted_events)

    @property
    def http_requests(self) -> List[Dict[str, Any]]:
        """Get all HTTP requests made."""
        return self._http.requests

    # =========================================================================
    # Reset Methods
    # =========================================================================

    def reset_tracking(self) -> None:
        """Reset all call/operation tracking but keep data."""
        self._records.reset_tracking()
        self._apps.reset_all_calls()
        self._http.requests.clear()
        self._notify.clear()
        self._spawned_workflows.clear()
        self._emitted_events.clear()

    def reset_all(self) -> None:
        """Reset everything including data."""
        self._records = MockRecordsAPI()
        self._tables = MockTablesAPI()
        self._relations = MockRelationsAPI()
        self._apps = MockAppsRegistry()
        self._http = MockHttpClient()
        self._notify = MockNotificationService()
        self._time.clear()
        self._events.clear()
        self._spawned_workflows.clear()
        self._emitted_events.clear()
