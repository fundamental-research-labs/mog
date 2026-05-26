"""
Harness - WorkflowTest base class for testing workflows.

This module provides the WorkflowTest base class which simplifies
testing workflows by providing common test helpers and assertions.

Example:
    from workflow_engine.testing import WorkflowTest, MockContext
    from my_workflows import ExpenseApprovalWorkflow

    class TestExpenseApproval(WorkflowTest):
        workflow = ExpenseApprovalWorkflow

        def test_auto_approve_small_expense(self):
            ctx = MockContext({
                "expenses": {"exp1": {"id": "exp1", "amount": 100}}
            })

            instance = self.trigger(ctx, event={
                "type": "record:created",
                "table": "expenses",
                "recordId": "exp1"
            })

            self.assert_completed(instance)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Sequence, Type
from uuid import uuid4

from workflow_engine.testing.mock_context import MockContext
from workflow_engine.testing.assertions import WorkflowAssertions, WorkflowAssertionError


@dataclass
class WorkflowInstance:
    """
    Represents a running or completed workflow instance in tests.

    This is a simplified representation used in tests to track
    workflow state and execution history.
    """

    id: str
    workflow_class: str
    status: str = "pending"  # pending, running, waiting, completed, failed
    current_step: str = ""
    step_history: List[str] = field(default_factory=list)
    waiting_for_events: List[str] = field(default_factory=list)
    state: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    _ctx: Optional[MockContext] = field(default=None, repr=False)
    _workflow_obj: Optional[Any] = field(default=None, repr=False)

    def get_state(self, key: str, default: Any = None) -> Any:
        """Get a state value."""
        return self.state.get(key, default)


class WorkflowExecutor:
    """
    Executes workflows step by step for testing.

    This is a simplified executor that runs workflow steps synchronously
    and tracks state transitions.
    """

    def __init__(self, workflow_class: Type[Any], ctx: MockContext) -> None:
        """
        Initialize the executor.

        Args:
            workflow_class: The workflow class to execute.
            ctx: The mock context.
        """
        self.workflow_class = workflow_class
        self.ctx = ctx
        self.instance: Optional[WorkflowInstance] = None

    def start(self, event: Dict[str, Any]) -> WorkflowInstance:
        """
        Start a new workflow instance with an event.

        Args:
            event: The triggering event.

        Returns:
            The created workflow instance.
        """
        instance_id = f"inst_{uuid4().hex[:12]}"
        now = self.ctx.now()

        self.instance = WorkflowInstance(
            id=instance_id,
            workflow_class=self.workflow_class.__name__,
            status="running",
            started_at=now,
            _ctx=self.ctx,
        )

        # Set up context with instance info
        self.ctx.set_instance_info(instance_id=instance_id, current_step="start")

        # Create workflow object
        workflow_obj = self.workflow_class()
        self.instance._workflow_obj = workflow_obj

        # Copy workflow state to instance
        self._sync_state()

        # Find and execute the start step
        self._execute_step("start", event=event)

        return self.instance

    def _execute_step(
        self,
        step_name: str,
        event: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> Optional[str]:
        """
        Execute a workflow step.

        Args:
            step_name: The step method name.
            event: Optional event to pass to the step.
            **kwargs: Additional keyword arguments.

        Returns:
            The next step name, or None if completed/waiting.
        """
        if self.instance is None or self.instance._workflow_obj is None:
            raise RuntimeError("No active workflow instance")

        workflow_obj = self.instance._workflow_obj

        # Update instance state
        self.instance.current_step = step_name
        self.instance.step_history.append(step_name)
        self.ctx.set_instance_info(
            instance_id=self.instance.id,
            current_step=step_name,
        )

        # Get the step method
        step_method = getattr(workflow_obj, step_name, None)
        if step_method is None:
            self.instance.status = "failed"
            self.instance.error = f"Step '{step_name}' not found"
            return None

        try:
            # Build arguments
            call_kwargs: Dict[str, Any] = {"ctx": self.ctx}
            if event is not None:
                call_kwargs["event"] = event
            call_kwargs.update(kwargs)

            # Execute the step
            result = step_method(**call_kwargs)

            # Sync state from workflow object
            self._sync_state()

            # Handle result
            return self._handle_step_result(result)

        except Exception as e:
            self.instance.status = "failed"
            self.instance.error = str(e)
            return None

    def _handle_step_result(self, result: Any) -> Optional[str]:
        """
        Handle the result of a step execution.

        Args:
            result: The value returned from the step.

        Returns:
            The next step name, or None if completed/waiting.
        """
        if self.instance is None:
            raise RuntimeError("No active workflow instance")

        # Check if result is a method reference (transition)
        if callable(result):
            method_name = result.__name__
            return self._execute_step(method_name)

        # Check for completion
        if result is None and self.instance.current_step == "complete":
            self.instance.status = "completed"
            self.instance.completed_at = self.ctx.now()
            return None

        # Check for explicit completion marker
        if isinstance(result, dict):
            if result.get("_complete"):
                self.instance.status = "completed"
                self.instance.completed_at = self.ctx.now()
                return None
            if result.get("_wait_for"):
                self.instance.status = "waiting"
                self.instance.waiting_for_events = result.get("_wait_for", [])
                # Register waiter with event simulator
                self.ctx.events.register_waiter(
                    event_types=self.instance.waiting_for_events,
                    instance_id=self.instance.id,
                    callback=lambda e: self._handle_event(e),
                )
                return None

        # If result is a string, treat it as next step name
        if isinstance(result, str):
            return self._execute_step(result)

        # No explicit next step - workflow is done
        self.instance.status = "completed"
        self.instance.completed_at = self.ctx.now()
        return None

    def _handle_event(self, event: Dict[str, Any]) -> None:
        """
        Handle an external event arriving at a waiting workflow.

        Args:
            event: The event data.
        """
        if self.instance is None:
            return

        self.instance.status = "running"
        self.instance.waiting_for_events = []

        # Re-execute the waiting step with the event
        current = self.instance.current_step
        self._execute_step(current, event=event)

    def _sync_state(self) -> None:
        """Sync state from workflow object to instance."""
        if self.instance is None or self.instance._workflow_obj is None:
            return

        workflow_obj = self.instance._workflow_obj
        # Copy all instance variables
        for key, value in vars(workflow_obj).items():
            if not key.startswith("_"):
                self.instance.state[key] = value

    def advance_to_step(self, step_name: str, max_steps: int = 100) -> None:
        """
        Advance the workflow until it reaches a specific step.

        Args:
            step_name: The step to advance to.
            max_steps: Maximum steps to execute (prevents infinite loops).

        Raises:
            RuntimeError: If max steps exceeded or workflow completes/fails.
        """
        if self.instance is None:
            raise RuntimeError("No active workflow instance")

        steps = 0
        while steps < max_steps:
            if self.instance.current_step == step_name:
                return
            if self.instance.status in ("completed", "failed"):
                raise RuntimeError(
                    f"Workflow {self.instance.status} before reaching step '{step_name}'"
                )
            if self.instance.status == "waiting":
                raise RuntimeError(
                    f"Workflow waiting at step '{self.instance.current_step}' before reaching '{step_name}'"
                )
            steps += 1

        raise RuntimeError(f"Max steps ({max_steps}) exceeded before reaching step '{step_name}'")

    def inject_event(self, event: Dict[str, Any]) -> None:
        """
        Inject an event into the waiting workflow.

        Args:
            event: The event to inject.
        """
        if self.instance is None:
            raise RuntimeError("No active workflow instance")

        if self.instance.status != "waiting":
            raise RuntimeError(
                f"Cannot inject event: workflow is {self.instance.status}, not waiting"
            )

        self._handle_event(event)


class WorkflowTest:
    """
    Base class for workflow test cases.

    Provides helper methods for triggering workflows, advancing state,
    and making assertions about workflow behavior.

    Usage:
        class TestMyWorkflow(WorkflowTest):
            workflow = MyWorkflowClass

            def test_happy_path(self):
                ctx = MockContext({...})
                instance = self.trigger(ctx, event={...})
                self.assert_completed(instance)
    """

    # Subclasses should set this to their workflow class
    workflow: Type[Any]

    def __init__(self) -> None:
        """Initialize the test class."""
        self._assertions = WorkflowAssertions()
        self._executors: Dict[str, WorkflowExecutor] = {}

    def trigger(
        self,
        ctx: MockContext,
        event: Dict[str, Any],
    ) -> WorkflowInstance:
        """
        Start a workflow with the given event.

        Args:
            ctx: The mock context.
            event: The triggering event.

        Returns:
            The workflow instance.
        """
        if not hasattr(self, "workflow") or self.workflow is None:
            raise RuntimeError("WorkflowTest subclass must set 'workflow' class attribute")

        executor = WorkflowExecutor(self.workflow, ctx)
        instance = executor.start(event)

        # Track executor for later operations
        self._executors[instance.id] = executor

        return instance

    def advance_to_step(
        self,
        instance: WorkflowInstance,
        step_name: str,
    ) -> None:
        """
        Run the workflow until it reaches a specific step.

        Args:
            instance: The workflow instance.
            step_name: The step to advance to.
        """
        executor = self._executors.get(instance.id)
        if executor is None:
            raise RuntimeError(f"No executor found for instance {instance.id}")

        executor.advance_to_step(step_name)

    def inject_event(
        self,
        instance: WorkflowInstance,
        event: Dict[str, Any],
    ) -> None:
        """
        Send an event to a waiting workflow.

        Args:
            instance: The workflow instance (must be waiting).
            event: The event to send.
        """
        executor = self._executors.get(instance.id)
        if executor is None:
            raise RuntimeError(f"No executor found for instance {instance.id}")

        executor.inject_event(event)

    def assert_completed(
        self,
        instance: WorkflowInstance,
        message: Optional[str] = None,
    ) -> None:
        """
        Assert the workflow has completed successfully.

        Args:
            instance: The workflow instance.
            message: Optional custom error message.
        """
        self._assertions.assert_completed(instance, message)

    def assert_failed(
        self,
        instance: WorkflowInstance,
        error_contains: Optional[str] = None,
        message: Optional[str] = None,
    ) -> None:
        """
        Assert the workflow has failed.

        Args:
            instance: The workflow instance.
            error_contains: Optional substring expected in error.
            message: Optional custom error message.
        """
        self._assertions.assert_failed(instance, error_contains, message)

    def assert_status(
        self,
        instance: WorkflowInstance,
        expected_status: str,
        message: Optional[str] = None,
    ) -> None:
        """
        Assert the workflow has a specific status.

        Args:
            instance: The workflow instance.
            expected_status: The expected status.
            message: Optional custom error message.
        """
        self._assertions.assert_status(instance, expected_status, message)

    def assert_current_step(
        self,
        instance: WorkflowInstance,
        expected_step: str,
        message: Optional[str] = None,
    ) -> None:
        """
        Assert the workflow is at a specific step.

        Args:
            instance: The workflow instance.
            expected_step: The expected current step.
            message: Optional custom error message.
        """
        self._assertions.assert_current_step(instance, expected_step, message)

    def assert_step_history(
        self,
        instance: WorkflowInstance,
        expected_steps: Sequence[str],
        message: Optional[str] = None,
    ) -> None:
        """
        Assert the workflow executed steps in the expected order.

        Args:
            instance: The workflow instance.
            expected_steps: List of step names in expected order.
            message: Optional custom error message.
        """
        self._assertions.assert_step_history(instance, expected_steps, message)

    def assert_waiting_for_events(
        self,
        instance: WorkflowInstance,
        event_types: Optional[Sequence[str]] = None,
        message: Optional[str] = None,
    ) -> None:
        """
        Assert the workflow is waiting for events.

        Args:
            instance: The workflow instance.
            event_types: Optional list of expected event types.
            message: Optional custom error message.
        """
        self._assertions.assert_waiting_for_events(instance, event_types, message)


def complete() -> Dict[str, bool]:
    """
    Return a completion marker from a workflow step.

    Usage:
        @step
        def final_step(self, ctx):
            # Do final work
            return complete()
    """
    return {"_complete": True}


def wait_for(events: List[str]) -> Dict[str, Any]:
    """
    Return a wait marker from a workflow step.

    Usage:
        @step
        def wait_step(self, ctx):
            return wait_for(["approved", "rejected"])
    """
    return {"_wait_for": events}
