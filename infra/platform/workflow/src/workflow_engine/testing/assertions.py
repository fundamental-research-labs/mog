"""
Assertions - Custom assertions for workflow testing.

This module provides specialized assertion helpers for verifying
workflow behavior, making tests more readable and providing
better error messages.

Example:
    from workflow_engine.testing import WorkflowAssertions

    assertions = WorkflowAssertions()

    # Assert workflow completed
    assertions.assert_completed(instance)

    # Assert step history
    assertions.assert_step_history(instance, ["start", "process", "complete"])

    # Assert notifications sent
    assertions.assert_email_sent(ctx, to="manager@company.com", subject_contains="Approval")
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Callable, Dict, List, Optional, Sequence, Union

if TYPE_CHECKING:
    from workflow_engine.testing.mock_context import MockContext


class WorkflowAssertionError(AssertionError):
    """Custom assertion error with detailed workflow context."""

    def __init__(
        self,
        message: str,
        expected: Any = None,
        actual: Any = None,
        context: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.expected = expected
        self.actual = actual
        self.context = context or {}

        details = [message]
        if expected is not None:
            details.append(f"  Expected: {expected!r}")
        if actual is not None:
            details.append(f"  Actual: {actual!r}")
        if context:
            details.append("  Context:")
            for key, value in context.items():
                details.append(f"    {key}: {value!r}")

        super().__init__("\n".join(details))


class WorkflowAssertions:
    """
    Custom assertions for workflow testing.

    Provides assertion helpers that give clear error messages
    and understand workflow-specific concepts.
    """

    def assert_completed(
        self,
        instance: Any,
        message: Optional[str] = None,
    ) -> None:
        """
        Assert that a workflow instance has completed successfully.

        Args:
            instance: The workflow instance.
            message: Optional custom error message.

        Raises:
            WorkflowAssertionError: If instance is not completed.
        """
        if instance.status != "completed":
            raise WorkflowAssertionError(
                message or f"Workflow not completed (status: {instance.status})",
                expected="completed",
                actual=instance.status,
                context={
                    "instance_id": instance.id,
                    "current_step": getattr(instance, "current_step", None),
                    "step_history": getattr(instance, "step_history", []),
                    "error": getattr(instance, "error", None),
                },
            )

    def assert_failed(
        self,
        instance: Any,
        error_contains: Optional[str] = None,
        message: Optional[str] = None,
    ) -> None:
        """
        Assert that a workflow instance has failed.

        Args:
            instance: The workflow instance.
            error_contains: Optional substring expected in error.
            message: Optional custom error message.

        Raises:
            WorkflowAssertionError: If instance is not failed or error doesn't match.
        """
        if instance.status != "failed":
            raise WorkflowAssertionError(
                message or f"Workflow not failed (status: {instance.status})",
                expected="failed",
                actual=instance.status,
                context={
                    "instance_id": instance.id,
                    "current_step": getattr(instance, "current_step", None),
                },
            )

        if error_contains is not None:
            error = getattr(instance, "error", "") or ""
            if error_contains not in error:
                raise WorkflowAssertionError(
                    message or f"Error message doesn't contain expected substring",
                    expected=error_contains,
                    actual=error,
                    context={"instance_id": instance.id},
                )

    def assert_status(
        self,
        instance: Any,
        expected_status: str,
        message: Optional[str] = None,
    ) -> None:
        """
        Assert that a workflow instance has a specific status.

        Args:
            instance: The workflow instance.
            expected_status: The expected status.
            message: Optional custom error message.

        Raises:
            WorkflowAssertionError: If status doesn't match.
        """
        if instance.status != expected_status:
            raise WorkflowAssertionError(
                message or f"Workflow status mismatch",
                expected=expected_status,
                actual=instance.status,
                context={
                    "instance_id": instance.id,
                    "current_step": getattr(instance, "current_step", None),
                },
            )

    def assert_current_step(
        self,
        instance: Any,
        expected_step: str,
        message: Optional[str] = None,
    ) -> None:
        """
        Assert that a workflow is at a specific step.

        Args:
            instance: The workflow instance.
            expected_step: The expected current step name.
            message: Optional custom error message.

        Raises:
            WorkflowAssertionError: If current step doesn't match.
        """
        current = getattr(instance, "current_step", None)
        if current != expected_step:
            raise WorkflowAssertionError(
                message or f"Workflow not at expected step",
                expected=expected_step,
                actual=current,
                context={
                    "instance_id": instance.id,
                    "status": instance.status,
                    "step_history": getattr(instance, "step_history", []),
                },
            )

    def assert_step_history(
        self,
        instance: Any,
        expected_steps: Sequence[str],
        message: Optional[str] = None,
    ) -> None:
        """
        Assert that a workflow executed the expected steps in order.

        Args:
            instance: The workflow instance.
            expected_steps: List of step names in expected order.
            message: Optional custom error message.

        Raises:
            WorkflowAssertionError: If step history doesn't match.
        """
        actual_steps = getattr(instance, "step_history", [])
        if list(actual_steps) != list(expected_steps):
            raise WorkflowAssertionError(
                message or f"Step history doesn't match expected",
                expected=list(expected_steps),
                actual=list(actual_steps),
                context={
                    "instance_id": instance.id,
                    "status": instance.status,
                },
            )

    def assert_step_in_history(
        self,
        instance: Any,
        step_name: str,
        message: Optional[str] = None,
    ) -> None:
        """
        Assert that a specific step was executed.

        Args:
            instance: The workflow instance.
            step_name: The step name to check for.
            message: Optional custom error message.

        Raises:
            WorkflowAssertionError: If step not in history.
        """
        actual_steps = getattr(instance, "step_history", [])
        if step_name not in actual_steps:
            raise WorkflowAssertionError(
                message or f"Step '{step_name}' not found in history",
                expected=step_name,
                actual=list(actual_steps),
                context={"instance_id": instance.id},
            )

    def assert_waiting_for_events(
        self,
        instance: Any,
        event_types: Optional[Sequence[str]] = None,
        message: Optional[str] = None,
    ) -> None:
        """
        Assert that a workflow is waiting for external events.

        Args:
            instance: The workflow instance.
            event_types: Optional list of expected event types.
            message: Optional custom error message.

        Raises:
            WorkflowAssertionError: If not waiting or event types don't match.
        """
        if instance.status != "waiting":
            raise WorkflowAssertionError(
                message or f"Workflow not waiting for events",
                expected="waiting",
                actual=instance.status,
                context={
                    "instance_id": instance.id,
                    "current_step": getattr(instance, "current_step", None),
                },
            )

        if event_types is not None:
            waiting_for = getattr(instance, "waiting_for_events", [])
            if set(waiting_for) != set(event_types):
                raise WorkflowAssertionError(
                    message or f"Waiting for different events",
                    expected=list(event_types),
                    actual=list(waiting_for),
                    context={"instance_id": instance.id},
                )

    def assert_email_sent(
        self,
        ctx: "MockContext",
        to: Optional[str] = None,
        subject_contains: Optional[str] = None,
        body_contains: Optional[str] = None,
        count: Optional[int] = None,
        message: Optional[str] = None,
    ) -> None:
        """
        Assert that emails were sent with expected properties.

        Args:
            ctx: The MockContext.
            to: Expected recipient (partial match).
            subject_contains: Expected substring in subject.
            body_contains: Expected substring in body.
            count: Expected number of matching emails.
            message: Optional custom error message.

        Raises:
            WorkflowAssertionError: If emails don't match expectations.
        """
        emails = ctx.emails

        # Filter by criteria
        matching = emails
        if to is not None:
            matching = [e for e in matching if to in e.get("to", "")]
        if subject_contains is not None:
            matching = [e for e in matching if subject_contains in e.get("subject", "")]
        if body_contains is not None:
            matching = [e for e in matching if body_contains in e.get("body", "")]

        if count is not None and len(matching) != count:
            raise WorkflowAssertionError(
                message or f"Expected {count} matching email(s), found {len(matching)}",
                expected=count,
                actual=len(matching),
                context={
                    "filter": {"to": to, "subject_contains": subject_contains, "body_contains": body_contains},
                    "all_emails": emails,
                    "matching_emails": matching,
                },
            )
        elif count is None and len(matching) == 0:
            raise WorkflowAssertionError(
                message or "No matching emails found",
                context={
                    "filter": {"to": to, "subject_contains": subject_contains, "body_contains": body_contains},
                    "all_emails": emails,
                },
            )

    def assert_slack_sent(
        self,
        ctx: "MockContext",
        channel: Optional[str] = None,
        message_contains: Optional[str] = None,
        count: Optional[int] = None,
        assert_message: Optional[str] = None,
    ) -> None:
        """
        Assert that Slack messages were sent.

        Args:
            ctx: The MockContext.
            channel: Expected channel (partial match).
            message_contains: Expected substring in message.
            count: Expected number of matching messages.
            assert_message: Optional custom error message.

        Raises:
            WorkflowAssertionError: If Slack messages don't match.
        """
        messages = ctx.slack_messages

        matching = messages
        if channel is not None:
            matching = [m for m in matching if channel in m.get("channel", "")]
        if message_contains is not None:
            matching = [m for m in matching if message_contains in m.get("message", "")]

        if count is not None and len(matching) != count:
            raise WorkflowAssertionError(
                assert_message or f"Expected {count} matching Slack message(s), found {len(matching)}",
                expected=count,
                actual=len(matching),
                context={
                    "filter": {"channel": channel, "message_contains": message_contains},
                    "all_messages": messages,
                },
            )
        elif count is None and len(matching) == 0:
            raise WorkflowAssertionError(
                assert_message or "No matching Slack messages found",
                context={
                    "filter": {"channel": channel, "message_contains": message_contains},
                    "all_messages": messages,
                },
            )

    def assert_toast_shown(
        self,
        ctx: "MockContext",
        user: Optional[str] = None,
        message_contains: Optional[str] = None,
        count: Optional[int] = None,
        assert_message: Optional[str] = None,
    ) -> None:
        """
        Assert that toast notifications were shown.

        Args:
            ctx: The MockContext.
            user: Expected user ID.
            message_contains: Expected substring in message.
            count: Expected number of matching toasts.
            assert_message: Optional custom error message.

        Raises:
            WorkflowAssertionError: If toasts don't match.
        """
        toasts = ctx.toasts

        matching = toasts
        if user is not None:
            matching = [t for t in matching if t.get("user") == user]
        if message_contains is not None:
            matching = [t for t in matching if message_contains in t.get("message", "")]

        if count is not None and len(matching) != count:
            raise WorkflowAssertionError(
                assert_message or f"Expected {count} matching toast(s), found {len(matching)}",
                expected=count,
                actual=len(matching),
                context={
                    "filter": {"user": user, "message_contains": message_contains},
                    "all_toasts": toasts,
                },
            )
        elif count is None and len(matching) == 0:
            raise WorkflowAssertionError(
                assert_message or "No matching toasts found",
                context={
                    "filter": {"user": user, "message_contains": message_contains},
                    "all_toasts": toasts,
                },
            )

    def assert_record_created(
        self,
        ctx: "MockContext",
        table: str,
        data_matches: Optional[Dict[str, Any]] = None,
        message: Optional[str] = None,
    ) -> None:
        """
        Assert that a record was created.

        Args:
            ctx: The MockContext.
            table: The table name.
            data_matches: Optional dict of expected field values.
            message: Optional custom error message.

        Raises:
            WorkflowAssertionError: If record not created.
        """
        creates = ctx.records.creates.get(table, [])
        if not creates:
            raise WorkflowAssertionError(
                message or f"No records created in table '{table}'",
                context={"table": table, "all_creates": ctx.records.creates},
            )

        if data_matches is not None:
            matching = []
            for record in creates:
                if all(record.get(k) == v for k, v in data_matches.items()):
                    matching.append(record)

            if not matching:
                raise WorkflowAssertionError(
                    message or f"No created record matches expected data",
                    expected=data_matches,
                    actual=creates,
                    context={"table": table},
                )

    def assert_record_updated(
        self,
        ctx: "MockContext",
        table: str,
        record_id: str,
        field_values: Optional[Dict[str, Any]] = None,
        message: Optional[str] = None,
    ) -> None:
        """
        Assert that a record was updated.

        Args:
            ctx: The MockContext.
            table: The table name.
            record_id: The record ID.
            field_values: Optional dict of expected field values.
            message: Optional custom error message.

        Raises:
            WorkflowAssertionError: If record not updated correctly.
        """
        updates = ctx.records.updates.get(table, {})
        if record_id not in updates:
            raise WorkflowAssertionError(
                message or f"Record '{record_id}' not updated in table '{table}'",
                context={
                    "table": table,
                    "record_id": record_id,
                    "all_updates": updates,
                },
            )

        if field_values is not None:
            actual = updates[record_id]
            for field, expected_value in field_values.items():
                if field not in actual or actual[field] != expected_value:
                    raise WorkflowAssertionError(
                        message or f"Field '{field}' not updated correctly",
                        expected=expected_value,
                        actual=actual.get(field),
                        context={
                            "table": table,
                            "record_id": record_id,
                            "all_updates_for_record": actual,
                        },
                    )

    def assert_api_called(
        self,
        ctx: "MockContext",
        app: str,
        method: str,
        count: Optional[int] = None,
        with_params: Optional[Dict[str, Any]] = None,
        message: Optional[str] = None,
    ) -> None:
        """
        Assert that an app API was called.

        Args:
            ctx: The MockContext.
            app: The app name (e.g., "crm", "finance").
            method: The method name (e.g., "create_deal").
            count: Expected number of calls.
            with_params: Expected parameters in at least one call.
            message: Optional custom error message.

        Raises:
            WorkflowAssertionError: If API not called correctly.
        """
        app_mock = getattr(ctx.apps, app, None)
        if app_mock is None:
            raise WorkflowAssertionError(
                message or f"App '{app}' not found",
                context={"available_apps": dir(ctx.apps)},
            )

        calls = app_mock.calls.get(method, [])

        if count is not None and len(calls) != count:
            raise WorkflowAssertionError(
                message or f"Expected {count} call(s) to {app}.{method}, found {len(calls)}",
                expected=count,
                actual=len(calls),
                context={"app": app, "method": method, "all_calls": calls},
            )
        elif count is None and len(calls) == 0:
            raise WorkflowAssertionError(
                message or f"Method {app}.{method} was never called",
                context={
                    "app": app,
                    "method": method,
                    "all_methods_called": list(app_mock.calls.keys()),
                },
            )

        if with_params is not None:
            matching = [c for c in calls if all(c.get(k) == v for k, v in with_params.items())]
            if not matching:
                raise WorkflowAssertionError(
                    message or f"No call to {app}.{method} matches expected params",
                    expected=with_params,
                    actual=calls,
                    context={"app": app, "method": method},
                )
