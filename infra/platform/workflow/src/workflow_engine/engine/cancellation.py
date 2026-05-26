"""
Cancellation Handler - Cancel workflows with optional compensation.

The CancellationHandler is responsible for:
- Cancelling running or waiting workflow instances
- Executing compensation logic for partial completions
- Handling cascading cancellation (parent -> children)
- Managing cancellation reasons and audit trail

Design Principles:
- Cancellation is graceful - allows cleanup logic
- Compensation steps can undo partial work
- Child workflows can be cancelled automatically
- Full audit trail of cancellation

Usage:
    handler = CancellationHandler(instance_manager, timer_service)

    # Cancel a workflow
    result = await handler.cancel(
        instance_id="inst_123",
        reason="User requested cancellation",
        cancelled_by="user@example.com",
        run_compensation=True,
    )

    # Cancel with cascade to children
    result = await handler.cancel_with_cascade(
        instance_id="inst_123",
        reason="Parent workflow cancelled",
    )
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Set, Type

from .types import (
    CancellationError,
    EventLogStore,
    EventPayload,
    InstanceStatus,
    StepDefinition,
    StepExecution,
    StepStatus,
    WorkflowDefinition,
    WorkflowInstance,
    WorkflowStore,
)


logger = logging.getLogger(__name__)


@dataclass
class CancellationResult:
    """
    Result of a cancellation operation.

    Attributes:
        success: Whether cancellation succeeded
        instance_id: The cancelled instance
        cancelled_at: When cancellation completed
        reason: Cancellation reason
        cancelled_by: Who/what initiated cancellation
        compensation_ran: Whether compensation was executed
        compensation_error: Error during compensation (if any)
        child_cancellations: Results of child cancellations
        error: Error message if cancellation failed
    """
    success: bool
    instance_id: str
    cancelled_at: Optional[datetime] = None
    reason: str = ""
    cancelled_by: Optional[str] = None
    compensation_ran: bool = False
    compensation_error: Optional[str] = None
    child_cancellations: List["CancellationResult"] = field(default_factory=list)
    error: Optional[str] = None


@dataclass
class CompensationStep:
    """
    Definition of a compensation step.

    Compensation steps are run in reverse order when a workflow is cancelled.

    Attributes:
        step_name: Name of the original step
        compensation_method: Name of the compensation method
        completed_at: When original step completed
        output: Output from original step (for compensation use)
    """
    step_name: str
    compensation_method: str
    completed_at: datetime
    output: Optional[Any] = None


class CancellationHandler:
    """
    Handles workflow cancellation with optional compensation.

    The CancellationHandler provides:
    - Graceful cancellation with cleanup
    - Compensation execution (undo partial work)
    - Cascading cancellation to child workflows
    - Audit logging

    Compensation:
    When run_compensation=True, the handler looks for compensation methods
    defined on the workflow class. For each completed step, if a method
    named `compensate_{step_name}` exists, it will be called.

    Example:
        class MyWorkflow(WorkflowBase):
            @step
            def create_order(self, ctx):
                self.order_id = ctx.apps.orders.create(...)
                return self.process_payment()

            def compensate_create_order(self, ctx):
                # Called during cancellation to undo order creation
                ctx.apps.orders.cancel(self.order_id)
    """

    def __init__(
        self,
        instance_store: Any,  # InstanceStore
        workflow_store: Optional[WorkflowStore] = None,
        timer_store: Optional[Any] = None,  # TimerStore
        event_log: Optional[EventLogStore] = None,
        workflow_registry: Optional[Dict[str, Type[Any]]] = None,
    ):
        """
        Initialize the CancellationHandler.

        Args:
            instance_store: Storage for instances
            workflow_store: Storage for definitions
            timer_store: Storage for timers (to clean up)
            event_log: Audit log storage
            workflow_registry: Map of workflow_id -> workflow class
        """
        self.instance_store = instance_store
        self.workflow_store = workflow_store
        self.timer_store = timer_store
        self.event_log = event_log
        self.workflow_registry = workflow_registry or {}

    # =========================================================================
    # Cancellation Operations
    # =========================================================================

    async def cancel(
        self,
        instance_id: str,
        reason: str,
        cancelled_by: Optional[str] = None,
        run_compensation: bool = True,
        context_factory: Optional[Callable[[], Any]] = None,
    ) -> CancellationResult:
        """
        Cancel a workflow instance.

        Args:
            instance_id: The instance to cancel
            reason: Why it's being cancelled
            cancelled_by: Who/what is cancelling (user_id, system, etc.)
            run_compensation: Whether to run compensation steps
            context_factory: Factory to create context for compensation

        Returns:
            CancellationResult with details
        """
        # Load instance
        instance = await self.instance_store.get(instance_id)

        if instance is None:
            return CancellationResult(
                success=False,
                instance_id=instance_id,
                error=f"Instance not found: {instance_id}",
            )

        # Check if cancellable
        if not self._is_cancellable(instance):
            return CancellationResult(
                success=False,
                instance_id=instance_id,
                error=f"Instance cannot be cancelled (status: {instance.status.value})",
            )

        # Log cancellation start
        await self._log_event(instance, "cancellation_started", {
            "reason": reason,
            "cancelled_by": cancelled_by,
            "run_compensation": run_compensation,
        })

        compensation_error: Optional[str] = None

        # Run compensation if requested
        if run_compensation:
            try:
                await self._run_compensation(instance, context_factory)
            except Exception as e:
                compensation_error = str(e)
                logger.exception(f"Compensation failed for {instance_id}: {e}")

        # Clean up timers
        if self.timer_store:
            await self.timer_store.delete_by_instance(instance_id)

        # Update instance status
        now = datetime.utcnow()
        instance.status = InstanceStatus.CANCELLED
        instance.completed_at = now
        instance.waiting_for = None
        instance.wait_timeout_at = None
        instance.metadata["cancellation"] = {
            "reason": reason,
            "cancelled_by": cancelled_by,
            "cancelled_at": now.isoformat(),
            "compensation_ran": run_compensation,
            "compensation_error": compensation_error,
        }

        await self.instance_store.save(instance)

        # Log completion
        await self._log_event(instance, "cancellation_completed", {
            "reason": reason,
            "compensation_ran": run_compensation,
            "compensation_error": compensation_error,
        })

        logger.info(f"Cancelled instance {instance_id}: {reason}")

        return CancellationResult(
            success=True,
            instance_id=instance_id,
            cancelled_at=now,
            reason=reason,
            cancelled_by=cancelled_by,
            compensation_ran=run_compensation,
            compensation_error=compensation_error,
        )

    async def cancel_with_cascade(
        self,
        instance_id: str,
        reason: str,
        cancelled_by: Optional[str] = None,
        run_compensation: bool = True,
        context_factory: Optional[Callable[[], Any]] = None,
    ) -> CancellationResult:
        """
        Cancel a workflow and all its child workflows.

        Cancels children first, then the parent.

        Args:
            instance_id: The parent instance to cancel
            reason: Cancellation reason
            cancelled_by: Who initiated
            run_compensation: Whether to run compensation
            context_factory: Factory for compensation context

        Returns:
            CancellationResult with child results
        """
        # Find all child instances
        child_ids = await self._find_child_instances(instance_id)

        child_results: List[CancellationResult] = []

        # Cancel children first (depth-first to handle nested children)
        for child_id in child_ids:
            child_result = await self.cancel_with_cascade(
                instance_id=child_id,
                reason=f"Parent workflow cancelled: {reason}",
                cancelled_by=cancelled_by,
                run_compensation=run_compensation,
                context_factory=context_factory,
            )
            child_results.append(child_result)

        # Cancel parent
        parent_result = await self.cancel(
            instance_id=instance_id,
            reason=reason,
            cancelled_by=cancelled_by,
            run_compensation=run_compensation,
            context_factory=context_factory,
        )

        parent_result.child_cancellations = child_results

        return parent_result

    async def bulk_cancel(
        self,
        instance_ids: List[str],
        reason: str,
        cancelled_by: Optional[str] = None,
        run_compensation: bool = False,  # Usually skip for bulk
    ) -> List[CancellationResult]:
        """
        Cancel multiple instances.

        Args:
            instance_ids: Instances to cancel
            reason: Cancellation reason
            cancelled_by: Who initiated
            run_compensation: Whether to run compensation (default False for bulk)

        Returns:
            List of CancellationResults
        """
        results = []

        # Process in parallel
        tasks = [
            self.cancel(
                instance_id=iid,
                reason=reason,
                cancelled_by=cancelled_by,
                run_compensation=run_compensation,
            )
            for iid in instance_ids
        ]

        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Convert exceptions to results
        final_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                final_results.append(CancellationResult(
                    success=False,
                    instance_id=instance_ids[i],
                    error=str(result),
                ))
            else:
                final_results.append(result)

        return final_results

    # =========================================================================
    # Compensation
    # =========================================================================

    async def _run_compensation(
        self,
        instance: WorkflowInstance,
        context_factory: Optional[Callable[[], Any]] = None,
    ) -> None:
        """
        Run compensation steps for a cancelled workflow.

        Compensation steps are executed in reverse order.

        Args:
            instance: The instance being cancelled
            context_factory: Factory to create execution context

        Raises:
            CancellationError: If compensation fails
        """
        # Get workflow class
        workflow_class = self.workflow_registry.get(instance.workflow_id)
        if workflow_class is None:
            logger.warning(
                f"Cannot run compensation: workflow class not found "
                f"for {instance.workflow_id}"
            )
            return

        # Find completed steps to compensate
        completed_steps = self._get_completed_steps(instance)

        if not completed_steps:
            logger.debug(f"No completed steps to compensate for {instance.instance_id}")
            return

        # Create context if factory provided
        context = context_factory() if context_factory else None

        # Create workflow object with current state
        workflow_obj = workflow_class()
        for key, value in instance.instance_state.items():
            setattr(workflow_obj, key, value)

        # Run compensation in reverse order
        for comp_step in reversed(completed_steps):
            compensation_method = f"compensate_{comp_step.step_name}"

            if hasattr(workflow_obj, compensation_method):
                logger.info(
                    f"Running compensation for {comp_step.step_name} "
                    f"on {instance.instance_id}"
                )

                try:
                    method = getattr(workflow_obj, compensation_method)

                    # Call compensation method
                    if context:
                        result = method(context)
                    else:
                        result = method()

                    # Handle async
                    if asyncio.iscoroutine(result):
                        await result

                except Exception as e:
                    logger.error(
                        f"Compensation failed for {comp_step.step_name}: {e}"
                    )
                    # Continue with other compensations
            else:
                logger.debug(
                    f"No compensation method for {comp_step.step_name}"
                )

    def _get_completed_steps(
        self,
        instance: WorkflowInstance,
    ) -> List[CompensationStep]:
        """
        Get completed steps that may need compensation.

        Returns steps in execution order (will be reversed for compensation).

        Args:
            instance: The workflow instance

        Returns:
            List of CompensationStep records
        """
        completed: List[CompensationStep] = []
        seen_steps: Set[str] = set()

        for execution in instance.step_history:
            if execution.status == StepStatus.COMPLETED:
                # Only include first completion of each step
                # (in case of retries)
                if execution.step_name not in seen_steps:
                    seen_steps.add(execution.step_name)
                    completed.append(CompensationStep(
                        step_name=execution.step_name,
                        compensation_method=f"compensate_{execution.step_name}",
                        completed_at=execution.completed_at or datetime.utcnow(),
                        output=execution.result,
                    ))

        return completed

    # =========================================================================
    # Helpers
    # =========================================================================

    def _is_cancellable(self, instance: WorkflowInstance) -> bool:
        """
        Check if an instance can be cancelled.

        Instances that are already completed, failed, or cancelled
        cannot be cancelled again.
        """
        return instance.status in [
            InstanceStatus.PENDING,
            InstanceStatus.RUNNING,
            InstanceStatus.WAITING,
        ]

    async def _find_child_instances(self, parent_id: str) -> List[str]:
        """
        Find all child instances spawned by a parent.

        Args:
            parent_id: The parent instance ID

        Returns:
            List of child instance IDs
        """
        child_ids: List[str] = []

        # Check each active status
        for status in [InstanceStatus.PENDING, InstanceStatus.RUNNING, InstanceStatus.WAITING]:
            instances = await self.instance_store.get_by_status(status=status, limit=1000)
            for inst in instances:
                if inst.parent_instance_id == parent_id:
                    child_ids.append(inst.instance_id)

        return child_ids

    async def _log_event(
        self,
        instance: WorkflowInstance,
        event_type: str,
        data: Dict[str, Any],
    ) -> None:
        """Log an event to the audit log."""
        if self.event_log:
            await self.event_log.log_event(
                instance_id=instance.instance_id,
                event_type=event_type,
                data={
                    **data,
                    "workflow_id": instance.workflow_id,
                    "workflow_version": instance.workflow_version,
                    "current_step": instance.current_step,
                },
            )

    # =========================================================================
    # Batch Operations
    # =========================================================================

    async def cancel_by_workflow(
        self,
        workflow_id: str,
        reason: str,
        cancelled_by: Optional[str] = None,
        status_filter: Optional[List[InstanceStatus]] = None,
    ) -> List[CancellationResult]:
        """
        Cancel all instances of a specific workflow type.

        Args:
            workflow_id: The workflow type
            reason: Cancellation reason
            cancelled_by: Who initiated
            status_filter: Only cancel instances with these statuses

        Returns:
            List of CancellationResults
        """
        statuses = status_filter or [
            InstanceStatus.PENDING,
            InstanceStatus.RUNNING,
            InstanceStatus.WAITING,
        ]

        instance_ids: List[str] = []

        for status in statuses:
            instances = await self.instance_store.get_by_status(
                status=status,
                workflow_id=workflow_id,
                limit=1000,
            )
            instance_ids.extend(inst.instance_id for inst in instances)

        if not instance_ids:
            logger.info(f"No instances to cancel for workflow {workflow_id}")
            return []

        return await self.bulk_cancel(
            instance_ids=instance_ids,
            reason=reason,
            cancelled_by=cancelled_by,
            run_compensation=False,
        )

    async def cancel_timed_out_instances(
        self,
        older_than: datetime,
        reason: str = "Timed out",
    ) -> List[CancellationResult]:
        """
        Cancel instances that have been waiting too long.

        Args:
            older_than: Cancel instances created before this time
            reason: Cancellation reason

        Returns:
            List of CancellationResults
        """
        instance_ids: List[str] = []

        for status in [InstanceStatus.WAITING, InstanceStatus.RUNNING]:
            instances = await self.instance_store.get_by_status(
                status=status,
                limit=1000,
            )
            for inst in instances:
                if inst.created_at and inst.created_at < older_than:
                    instance_ids.append(inst.instance_id)

        if not instance_ids:
            return []

        return await self.bulk_cancel(
            instance_ids=instance_ids,
            reason=reason,
            cancelled_by="system:timeout",
            run_compensation=False,
        )


class CancellationPolicy:
    """
    Pre-defined cancellation policies.

    Policies control what happens when a workflow is cancelled.
    """

    # Cancel with compensation (safest)
    SAFE = {
        "run_compensation": True,
        "cascade_to_children": True,
    }

    # Cancel without compensation (faster)
    FAST = {
        "run_compensation": False,
        "cascade_to_children": True,
    }

    # Cancel only this instance (no cascade)
    ISOLATED = {
        "run_compensation": True,
        "cascade_to_children": False,
    }

    # Aggressive cancellation (no compensation, no cascade)
    FORCE = {
        "run_compensation": False,
        "cascade_to_children": False,
    }
