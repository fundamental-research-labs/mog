"""
NotificationService - Email, Slack, and in-app notifications for workflows.

This module provides the NotificationService for sending notifications:
- Email: With templates, attachments, and action buttons
- Slack: Channel messages and DMs
- Toast: In-app toast notifications
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import httpx


logger = logging.getLogger(__name__)


@dataclass
class EmailAction:
    """
    An action button in an email.

    Attributes:
        label: Button label text
        event: Event type to emit when clicked
        data: Additional data to include with the event
        style: Button style (primary, secondary, danger)
    """

    label: str
    event: str
    data: Dict[str, Any] = field(default_factory=dict)
    style: str = "primary"

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "label": self.label,
            "event": self.event,
            "data": self.data,
            "style": self.style,
        }


@dataclass
class SlackBlock:
    """
    A Slack message block.

    Simplified representation of Slack Block Kit blocks.

    Attributes:
        type: Block type (section, divider, actions, context, etc.)
        text: Text content (for section blocks)
        elements: Elements for actions/context blocks
    """

    type: str
    text: str | Dict[str, Any] = ""
    elements: List[Dict[str, Any]] = field(default_factory=list)
    fields: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to Slack block format."""
        result: Dict[str, Any] = {"type": self.type}

        if self.type == "section":
            if isinstance(self.text, str):
                result["text"] = {"type": "mrkdwn", "text": self.text}
            else:
                result["text"] = self.text
            if self.fields:
                result["fields"] = self.fields
        elif self.type == "divider":
            pass  # Divider has no additional fields
        elif self.type in ("actions", "context"):
            result["elements"] = self.elements

        return result


class NotificationService:
    """
    Service for sending notifications from workflows.

    Supports multiple notification channels:
    - Email: Send emails with optional templates and action buttons
    - Slack: Send messages to channels or users
    - Toast: Show in-app toast notifications

    Email actions create clickable buttons that emit workflow events
    when clicked, allowing approvals and other interactions directly
    from email.

    Example:
        # Send approval email with action buttons
        ctx.notify.email(
            to="manager@company.com",
            subject=f"Approval needed: ${expense['amount']} expense",
            body="Please review the attached expense report.",
            actions=[
                EmailAction("Approve", "approved"),
                EmailAction("Reject", "rejected", style="danger"),
            ]
        )

        # Send Slack notification
        ctx.notify.slack(
            channel="#sales-alerts",
            message=f"New deal closed: {deal['name']} for ${deal['value']}"
        )

        # Show in-app toast
        ctx.notify.toast(user=submitter_id, message="Your expense was approved!")
    """

    def __init__(
        self,
        gateway_url: str = "http://localhost:8000",
        http_client: httpx.Client | None = None,
        source_instance_id: str | None = None,
    ) -> None:
        """
        Initialize the notification service.

        Args:
            gateway_url: URL of the unified gateway
            http_client: Optional pre-configured HTTP client
            source_instance_id: Workflow instance ID for event routing
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
        endpoint: str,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Make a request to the notification service."""
        client = self._get_client()
        url = f"{self._gateway_url}/api/notifications{endpoint}"

        logger.debug(f"Notification request: POST {url}")

        response = client.post(url, json=payload)
        response.raise_for_status()

        if response.content:
            return response.json()
        return {}

    def email(
        self,
        to: str | List[str],
        subject: str,
        body: str = "",
        template: str = "",
        data: Dict[str, Any] | None = None,
        actions: List[EmailAction | Dict[str, Any]] | None = None,
        cc: str | List[str] | None = None,
        bcc: str | List[str] | None = None,
        reply_to: str | None = None,
        attachments: List[Dict[str, Any]] | None = None,
    ) -> str:
        """
        Send an email notification.

        Args:
            to: Recipient email(s)
            subject: Email subject
            body: Plain text body (used if no template)
            template: Template name (for rich HTML emails)
            data: Template data (variables for the template)
            actions: Action buttons that emit workflow events
            cc: CC recipients
            bcc: BCC recipients
            reply_to: Reply-To address
            attachments: List of attachments

        Returns:
            Email ID for tracking

        Example:
            # Simple email
            ctx.notify.email(
                to="user@example.com",
                subject="Welcome!",
                body="Thanks for signing up."
            )

            # Email with template and actions
            ctx.notify.email(
                to="manager@company.com",
                subject="Expense Approval Required",
                template="expense_approval",
                data={
                    "expense_amount": 500,
                    "submitter": "Alice",
                    "description": "Client dinner"
                },
                actions=[
                    EmailAction("Approve", "approved"),
                    EmailAction("Request Info", "info_requested"),
                    EmailAction("Reject", "rejected", style="danger"),
                ]
            )
        """
        # Normalize recipients to lists
        to_list = [to] if isinstance(to, str) else to
        cc_list = [cc] if isinstance(cc, str) else (cc or [])
        bcc_list = [bcc] if isinstance(bcc, str) else (bcc or [])

        logger.info(
            "Sending email notification",
            extra={
                "to": to_list,
                "subject": subject,
                "template": template or "(none)",
                "has_actions": bool(actions),
            }
        )

        payload: Dict[str, Any] = {
            "to": to_list,
            "subject": subject,
        }

        if body:
            payload["body"] = body
        if template:
            payload["template"] = template
        if data:
            payload["data"] = data
        if cc_list:
            payload["cc"] = cc_list
        if bcc_list:
            payload["bcc"] = bcc_list
        if reply_to:
            payload["reply_to"] = reply_to
        if attachments:
            payload["attachments"] = attachments

        # Process actions
        if actions:
            action_list = []
            for action in actions:
                if isinstance(action, EmailAction):
                    action_dict = action.to_dict()
                else:
                    action_dict = action

                # Add workflow context for event routing
                if self._source_instance_id:
                    action_dict["workflow_instance_id"] = self._source_instance_id

                action_list.append(action_dict)
            payload["actions"] = action_list

        result = self._make_request("/email", payload)
        return result.get("email_id", "")

    def slack(
        self,
        channel: str,
        message: str,
        blocks: List[SlackBlock | Dict[str, Any]] | None = None,
        thread_ts: str | None = None,
        username: str | None = None,
        icon_emoji: str | None = None,
    ) -> str:
        """
        Send a Slack message.

        Args:
            channel: Channel name (with #) or user ID (for DM)
            message: Message text (used as fallback if blocks provided)
            blocks: Slack Block Kit blocks for rich formatting
            thread_ts: Thread timestamp (for replies)
            username: Override bot username
            icon_emoji: Override bot emoji

        Returns:
            Message timestamp (ts)

        Example:
            # Simple message
            ctx.notify.slack(
                channel="#sales-alerts",
                message="New deal closed: Acme Corp for $50,000"
            )

            # Rich message with blocks
            ctx.notify.slack(
                channel="#deployments",
                message="Deployment complete",
                blocks=[
                    SlackBlock("section", ":rocket: *Deployment Complete*"),
                    SlackBlock("divider"),
                    SlackBlock("section", f"Version: {version}\\nEnvironment: {env}"),
                ]
            )
        """
        logger.info(
            "Sending Slack notification",
            extra={
                "channel": channel,
                "has_blocks": bool(blocks),
            }
        )

        payload: Dict[str, Any] = {
            "channel": channel,
            "message": message,
        }

        if blocks:
            block_list = []
            for block in blocks:
                if isinstance(block, SlackBlock):
                    block_list.append(block.to_dict())
                else:
                    block_list.append(block)
            payload["blocks"] = block_list

        if thread_ts:
            payload["thread_ts"] = thread_ts
        if username:
            payload["username"] = username
        if icon_emoji:
            payload["icon_emoji"] = icon_emoji

        result = self._make_request("/slack", payload)
        return result.get("ts", "")

    def toast(
        self,
        message: str,
        user: str | None = None,
        variant: str = "info",
        duration: int = 5000,
        action_label: str = "",
        action_url: str = "",
    ) -> None:
        """
        Show an in-app toast notification.

        Args:
            message: Toast message
            user: User ID to show toast to (None = current user)
            variant: Toast variant (info, success, warning, error)
            duration: Auto-dismiss duration in milliseconds
            action_label: Optional action button label
            action_url: URL to open when action clicked

        Example:
            # Simple toast
            ctx.notify.toast(
                user=submitter_id,
                message="Your expense was approved!",
                variant="success"
            )

            # Toast with action
            ctx.notify.toast(
                user=user_id,
                message="New comment on your deal",
                action_label="View",
                action_url=f"/deals/{deal_id}"
            )
        """
        logger.info(
            "Sending toast notification",
            extra={
                "user": user or "(current)",
                "variant": variant,
            }
        )

        payload: Dict[str, Any] = {
            "message": message,
            "variant": variant,
            "duration": duration,
        }

        if user:
            payload["user"] = user
        if action_label:
            payload["action_label"] = action_label
        if action_url:
            payload["action_url"] = action_url

        self._make_request("/toast", payload)

    def close(self) -> None:
        """Close the HTTP client."""
        if self._http_client is not None:
            self._http_client.close()
            self._http_client = None
