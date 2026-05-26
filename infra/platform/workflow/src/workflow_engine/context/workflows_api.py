"""
WorkflowsAPI - Query and control other workflows from within a workflow.

This module provides the WorkflowsAPI for workflow-to-workflow communication:
- Find: Query running workflows by type, status, filter
- Signal: Send events to waiting workflows
- Cancel: Cancel running workflows
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx


logger = logging.getLogger(__name__)


@dataclass
class WorkflowInstanceInfo:
    """
    Information about a workflow instance.

    This is a lightweight representation returned by queries -
    not the full instance state.

    Attributes:
        instance_id: Unique instance identifier
        workflow_id: Workflow type identifier
        workflow_name: Human-readable workflow name
        status: Current status
        current_step: Current step name
        created_at: When instance was created
        started_at: When execution started
        data: Instance data (workflow variables)
    """

    instance_id: str
    workflow_id: str
    workflow_name: str = ""
    status: str = ""
    current_step: str = ""
    created_at: str | None = None
    started_at: str | None = None
    data: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "WorkflowInstanceInfo":
        """Create WorkflowInstanceInfo from dictionary."""
        return cls(
            instance_id=data["instance_id"],
            workflow_id=data["workflow_id"],
            workflow_name=data.get("workflow_name", ""),
            status=data.get("status", ""),
            current_step=data.get("current_step", ""),
            created_at=data.get("created_at"),
            started_at=data.get("started_at"),
            data=data.get("data", {}),
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "instance_id": self.instance_id,
            "workflow_id": self.workflow_id,
            "workflow_name": self.workflow_name,
            "status": self.status,
            "current_step": self.current_step,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "data": self.data,
        }


class WorkflowsAPI:
    """
    API for querying and controlling other workflows.

    This API allows workflows to interact with other workflow instances:
    - Query for running instances by type, status, or data
    - Send signals to waiting workflows
    - Cancel running workflows

    This enables coordination patterns like:
    - Parent-child workflows
    - Saga patterns with compensation
    - Approval chains
    - Parallel processing with aggregation

    Example:
        # Find related workflows
        instances = ctx.workflows.find(
            workflow_class="CustomerOnboarding",
            filter={"deal_id": deal_id},
            status=["running", "waiting"]
        )

        if instances:
            # Signal the first matching instance
            ctx.workflows.signal(
                instances[0].instance_id,
                "payment_received",
                {"amount": payment_amount}
            )

        # Cancel a workflow
        ctx.workflows.cancel(old_instance_id, reason="Superseded by new workflow")
    """

    def __init__(
        self,
        gateway_url: str = "http://localhost:8000",
        http_client: httpx.Client | None = None,
        source_instance_id: str | None = None,
    ) -> None:
        """
        Initialize the workflows API.

        Args:
            gateway_url: URL of the workflow engine service
            http_client: Optional pre-configured HTTP client
            source_instance_id: ID of the calling workflow instance (for auditing)
        """
        self._gateway_url = gateway_url.rstrip("/")
        self._http_client = http_client
        self._source_instance_id = source_instance_id

    def _get_client(self) -> httpx.Client:
        """Get or create HTTP client."""
        if self._http_client is None:
            self._http_client = httpx.Client(timeout=30.0)
        return self._http_client

    def _make_request(
        self,
        method: str,
        endpoint: str,
        params: Dict[str, Any] | None = None,
        json_body: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        """Make a request to the workflow service."""
        client = self._get_client()
        url = f"{self._gateway_url}/api/workflows{endpoint}"

        headers = {}
        if self._source_instance_id:
            headers["X-Source-Instance-ID"] = self._source_instance_id

        logger.debug(f"Workflows API request: {method} {url}")

        response = client.request(
            method,
            url,
            params=params,
            json=json_body,
            headers=headers,
        )
        response.raise_for_status()

        if response.content:
            return response.json()
        return {}

    def find(
        self,
        workflow_class: str | None = None,
        workflow_id: str | None = None,
        status: str | List[str] | None = None,
        filter: Dict[str, Any] | None = None,
        parent_instance_id: str | None = None,
        correlation_id: str | None = None,
        limit: int = 100,
    ) -> List[WorkflowInstanceInfo]:
        """
        Find workflow instances matching criteria.

        Args:
            workflow_class: Filter by workflow class name
            workflow_id: Filter by workflow ID
            status: Filter by status (string or list)
            filter: Filter by instance data values
            parent_instance_id: Filter by parent instance
            correlation_id: Filter by correlation ID
            limit: Maximum results

        Returns:
            List of matching WorkflowInstanceInfo

        Example:
            # Find all running expense approvals
            instances = ctx.workflows.find(
                workflow_class="ExpenseApproval",
                status=["running", "waiting"]
            )

            # Find child workflows
            children = ctx.workflows.find(
                parent_instance_id=ctx.instance_id
            )

            # Find by custom filter
            deals = ctx.workflows.find(
                workflow_class="DealOnboarding",
                filter={"deal_id": deal_id}
            )
        """
        params: Dict[str, Any] = {"limit": limit}

        if workflow_class:
            params["workflow_class"] = workflow_class
        if workflow_id:
            params["workflow_id"] = workflow_id
        if status:
            if isinstance(status, list):
                params["status"] = ",".join(status)
            else:
                params["status"] = status
        if parent_instance_id:
            params["parent_instance_id"] = parent_instance_id
        if correlation_id:
            params["correlation_id"] = correlation_id

        # Filter is sent as JSON in body for complex queries
        json_body = None
        if filter:
            json_body = {"filter": filter}
            # Use POST for filter queries
            result = self._make_request("POST", "/instances/search", json_body=json_body)
        else:
            result = self._make_request("GET", "/instances", params=params)

        instances = result.get("instances", [])
        return [WorkflowInstanceInfo.from_dict(i) for i in instances]

    def get(self, instance_id: str) -> WorkflowInstanceInfo | None:
        """
        Get a specific workflow instance.

        Args:
            instance_id: Instance ID

        Returns:
            WorkflowInstanceInfo or None if not found

        Example:
            instance = ctx.workflows.get("inst_abc123")
            if instance:
                print(f"Status: {instance.status}")
        """
        try:
            result = self._make_request("GET", f"/instances/{instance_id}")
            return WorkflowInstanceInfo.from_dict(result)
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return None
            raise

    def signal(
        self,
        instance_id: str,
        event_type: str,
        data: Dict[str, Any] | None = None,
    ) -> bool:
        """
        Send a signal (event) to a workflow instance.

        This is used to wake up workflows waiting for events via @wait_for.
        The event is delivered asynchronously.

        Args:
            instance_id: Target instance ID
            event_type: Event type (e.g., "approved", "payment_received")
            data: Event data payload

        Returns:
            True if signal was accepted

        Example:
            # Signal an approval
            ctx.workflows.signal(
                approval_instance_id,
                "approved",
                {"approved_by": approver_email}
            )

            # Signal payment received
            ctx.workflows.signal(
                order_instance_id,
                "payment_received",
                {"amount": 99.99, "transaction_id": txn_id}
            )
        """
        logger.info(
            "Signaling workflow",
            extra={
                "source_instance": self._source_instance_id,
                "target_instance": instance_id,
                "event_type": event_type,
            }
        )

        payload: Dict[str, Any] = {
            "event_type": event_type,
            "data": data or {},
        }

        if self._source_instance_id:
            payload["source_instance_id"] = self._source_instance_id

        try:
            self._make_request("POST", f"/instances/{instance_id}/signal", json_body=payload)
            return True
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                logger.warning(f"Signal target not found: {instance_id}")
                return False
            raise

    def cancel(
        self,
        instance_id: str,
        reason: str = "",
    ) -> bool:
        """
        Cancel a running workflow instance.

        The workflow will transition to "cancelled" status. If the workflow
        has compensation steps defined, they may be executed.

        Args:
            instance_id: Instance ID to cancel
            reason: Reason for cancellation

        Returns:
            True if cancellation was accepted

        Example:
            # Cancel an outdated workflow
            ctx.workflows.cancel(
                old_instance_id,
                reason="Superseded by updated request"
            )
        """
        logger.info(
            "Cancelling workflow",
            extra={
                "source_instance": self._source_instance_id,
                "target_instance": instance_id,
                "reason": reason,
            }
        )

        payload: Dict[str, Any] = {}
        if reason:
            payload["reason"] = reason
        if self._source_instance_id:
            payload["cancelled_by_instance"] = self._source_instance_id

        try:
            self._make_request("POST", f"/instances/{instance_id}/cancel", json_body=payload or None)
            return True
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                logger.warning(f"Cancel target not found: {instance_id}")
                return False
            raise

    def wait_for_child(
        self,
        child_instance_id: str,
        timeout_seconds: int | None = None,
    ) -> WorkflowInstanceInfo | None:
        """
        Wait for a child workflow to complete.

        Note: This is a polling-based check. For event-driven waiting,
        have the child emit an event and use @wait_for.

        Args:
            child_instance_id: Child instance ID
            timeout_seconds: Maximum seconds to wait

        Returns:
            Final instance info, or None if timeout

        Example:
            child_id = ctx.spawn(ChildWorkflow, input_data)
            result = ctx.workflows.wait_for_child(child_id, timeout_seconds=3600)
            if result and result.status == "completed":
                # Process result
                pass
        """
        # Note: Real implementation would use a more sophisticated
        # waiting mechanism (events, polling, etc.)
        instance = self.get(child_instance_id)
        if instance and instance.status in ("completed", "failed", "cancelled"):
            return instance
        return None

    def get_children(
        self,
        parent_instance_id: str | None = None,
        status: str | List[str] | None = None,
    ) -> List[WorkflowInstanceInfo]:
        """
        Get child workflows of an instance.

        Args:
            parent_instance_id: Parent instance (defaults to current)
            status: Optional status filter

        Returns:
            List of child workflow instances

        Example:
            children = ctx.workflows.get_children()
            completed = [c for c in children if c.status == "completed"]
        """
        parent = parent_instance_id or self._source_instance_id
        if not parent:
            return []

        return self.find(
            parent_instance_id=parent,
            status=status,
        )

    def close(self) -> None:
        """Close the HTTP client."""
        if self._http_client is not None:
            self._http_client.close()
            self._http_client = None
