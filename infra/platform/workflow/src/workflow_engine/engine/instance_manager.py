"""
Workflow Instance Manager.

The InstanceManager is responsible for the lifecycle of workflow instances:
- Creating new instances from workflow definitions
- Loading incomplete instances on startup (crash recovery)
- Persisting state after each step completion (durability guarantee)
- Tracking instance status transitions

Design Principles:
- Every state change is persisted before proceeding
- Crash at any point can be recovered by replaying from last checkpoint
- Instance state must always be JSON-serializable
- No in-memory state that isn't backed by persistent storage

Usage:
    manager = InstanceManager(instance_store, workflow_store, event_log)

    # Create new instance from trigger event
    instance = await manager.create_instance(
        workflow_id="ExpenseApproval",
        trigger_event=event_payload,
    )

    # Load instance for execution
    instance = await manager.load_instance(instance_id)

    # Save after step completion
    await manager.save_instance(instance)

    # Update status
    await manager.transition_status(instance, InstanceStatus.COMPLETED)
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Sequence

from .types import (
    DeadLetterEntry,
    DeadLetterStore,
    EventLogStore,
    EventPayload,
    InstanceNotFoundError,
    InstanceStatus,
    InstanceStore,
    PendingTimer,
    RuntimeType,
    SerializationError,
    StepExecution,
    StepStatus,
    TimerStore,
    WaitingInstance,
    WorkflowDefinition,
    WorkflowDefinitionError,
    WorkflowError,
    WorkflowInstance,
    WorkflowStore,
)


logger = logging.getLogger(__name__)


class InstanceManager:
    """
    Manages workflow instance lifecycle.

    The InstanceManager ensures durability by persisting instance state
    after every significant operation. On crash recovery, it can reload
    all incomplete instances and resume execution from the last checkpoint.

    Attributes:
        instance_store: Storage for workflow instances
        workflow_store: Storage for workflow definitions
        timer_store: Storage for pending timers
        dead_letter_store: Storage for failed instances
        event_log: Audit log storage
    """

    def __init__(
        self,
        instance_store: InstanceStore,
        workflow_store: WorkflowStore,
        timer_store: Optional[TimerStore] = None,
        dead_letter_store: Optional[DeadLetterStore] = None,
        event_log: Optional[EventLogStore] = None,
        id_generator: Optional[Callable[[], str]] = None,
    ):
        """
        Initialize the InstanceManager.

        Args:
            instance_store: Storage backend for instances
            workflow_store: Storage backend for workflow definitions
            timer_store: Optional storage for timers
            dead_letter_store: Optional storage for dead letter queue
            event_log: Optional audit log storage
            id_generator: Optional custom ID generator (default: UUID4)
        """
        self.instance_store = instance_store
        self.workflow_store = workflow_store
        self.timer_store = timer_store
        self.dead_letter_store = dead_letter_store
        self.event_log = event_log
        self._id_generator = id_generator or (lambda: f"inst_{uuid.uuid4().hex[:16]}")

    # =========================================================================
    # Instance Creation
    # =========================================================================

    async def create_instance(
        self,
        workflow_id: str,
        trigger_event: EventPayload,
        runtime: RuntimeType = RuntimeType.LOCAL,
        parent_instance_id: Optional[str] = None,
        correlation_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        version: Optional[str] = None,
    ) -> WorkflowInstance:
        """
        Create a new workflow instance from a trigger event.

        This is the primary entry point for starting new workflows. It:
        1. Loads the workflow definition
        2. Creates a new instance with initial state
        3. Persists the instance before returning
        4. Logs the creation event

        Args:
            workflow_id: ID of the workflow definition to instantiate
            trigger_event: Event that triggered this workflow
            runtime: Where to execute (local/cloud)
            parent_instance_id: If spawned by another workflow
            correlation_id: For grouping related instances
            metadata: Additional metadata (user_id, etc.)
            version: Specific version to use (None = latest)

        Returns:
            The newly created WorkflowInstance

        Raises:
            WorkflowDefinitionError: If workflow definition not found
            SerializationError: If trigger event not serializable
        """
        # Load workflow definition
        definition = await self.workflow_store.get(workflow_id, version)
        if definition is None:
            raise WorkflowDefinitionError(
                f"Workflow definition not found: {workflow_id}",
                {"workflow_id": workflow_id, "version": version},
            )

        # Validate trigger event is serializable
        try:
            trigger_dict = trigger_event.to_dict()
        except Exception as e:
            raise SerializationError(
                f"Trigger event not serializable: {e}",
                {"workflow_id": workflow_id},
            )

        # Generate unique instance ID
        instance_id = self._id_generator()

        # Create instance
        now = datetime.utcnow()
        instance = WorkflowInstance(
            instance_id=instance_id,
            workflow_id=workflow_id,
            workflow_version=definition.version,
            status=InstanceStatus.PENDING,
            runtime=runtime,
            current_step=definition.entry_step,
            step_history=[],
            instance_state={},
            trigger_event=trigger_dict,
            waiting_for=None,
            wait_timeout_at=None,
            created_at=now,
            started_at=None,
            completed_at=None,
            parent_instance_id=parent_instance_id,
            correlation_id=correlation_id or instance_id,
            metadata=metadata or {},
        )

        # Persist before returning (durability guarantee)
        await self.instance_store.save(instance)

        # Log creation event
        await self._log_event(instance, "instance_created", {
            "trigger_event": trigger_dict,
            "runtime": runtime.value,
        })

        logger.info(
            f"Created instance {instance_id} for workflow {workflow_id} v{definition.version}"
        )

        return instance

    async def create_instance_from_definition(
        self,
        definition: WorkflowDefinition,
        trigger_event: EventPayload,
        runtime: RuntimeType = RuntimeType.LOCAL,
        parent_instance_id: Optional[str] = None,
        correlation_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> WorkflowInstance:
        """
        Create instance directly from a definition (for testing/internal use).

        Like create_instance but takes definition directly instead of looking it up.
        """
        try:
            trigger_dict = trigger_event.to_dict()
        except Exception as e:
            raise SerializationError(f"Trigger event not serializable: {e}")

        instance_id = self._id_generator()
        now = datetime.utcnow()

        instance = WorkflowInstance(
            instance_id=instance_id,
            workflow_id=definition.workflow_id,
            workflow_version=definition.version,
            status=InstanceStatus.PENDING,
            runtime=runtime,
            current_step=definition.entry_step,
            step_history=[],
            instance_state={},
            trigger_event=trigger_dict,
            waiting_for=None,
            wait_timeout_at=None,
            created_at=now,
            started_at=None,
            completed_at=None,
            parent_instance_id=parent_instance_id,
            correlation_id=correlation_id or instance_id,
            metadata=metadata or {},
        )

        await self.instance_store.save(instance)
        await self._log_event(instance, "instance_created", {
            "trigger_event": trigger_dict,
            "runtime": runtime.value,
        })

        return instance

    # =========================================================================
    # Instance Loading
    # =========================================================================

    async def load_instance(self, instance_id: str) -> WorkflowInstance:
        """
        Load an instance by ID.

        Args:
            instance_id: The instance to load

        Returns:
            The WorkflowInstance

        Raises:
            InstanceNotFoundError: If instance doesn't exist
        """
        instance = await self.instance_store.get(instance_id)
        if instance is None:
            raise InstanceNotFoundError(
                f"Instance not found: {instance_id}",
                {"instance_id": instance_id},
            )
        return instance

    async def load_instance_if_exists(self, instance_id: str) -> Optional[WorkflowInstance]:
        """Load an instance by ID, or None if not found."""
        return await self.instance_store.get(instance_id)

    async def load_incomplete_instances(
        self,
        workflow_id: Optional[str] = None,
        runtime: Optional[RuntimeType] = None,
        limit: int = 100,
    ) -> List[WorkflowInstance]:
        """
        Load all incomplete instances for crash recovery.

        Incomplete instances are those in PENDING, RUNNING, or WAITING status.
        On startup, the engine should call this to resume interrupted workflows.

        Args:
            workflow_id: Filter to specific workflow type
            runtime: Filter to specific runtime
            limit: Maximum instances to load

        Returns:
            List of incomplete instances to resume
        """
        incomplete: List[WorkflowInstance] = []

        for status in [InstanceStatus.PENDING, InstanceStatus.RUNNING, InstanceStatus.WAITING]:
            instances = await self.instance_store.get_by_status(
                status=status,
                limit=limit,
                workflow_id=workflow_id,
            )
            incomplete.extend(instances)

        # Filter by runtime if specified
        if runtime is not None:
            incomplete = [i for i in incomplete if i.runtime == runtime]

        # Sort by created_at to process older instances first
        incomplete.sort(key=lambda i: i.created_at or datetime.min)

        logger.info(f"Loaded {len(incomplete)} incomplete instances for recovery")
        return incomplete[:limit]

    async def load_waiting_for_event(
        self,
        event_type: str,
    ) -> List[WaitingInstance]:
        """
        Load instances waiting for a specific event type.

        Used by EventRouter to find instances to wake up.

        Args:
            event_type: The event type to match

        Returns:
            List of WaitingInstance records
        """
        return await self.instance_store.get_waiting_for_event(event_type)

    # =========================================================================
    # Instance Persistence
    # =========================================================================

    async def save_instance(self, instance: WorkflowInstance) -> None:
        """
        Save/update an instance.

        This is the core durability mechanism. Must be called after every
        step completion to ensure crash recovery can resume from this point.

        Args:
            instance: The instance to save

        Raises:
            SerializationError: If instance state is not serializable
        """
        # Validate serialization before saving
        try:
            _ = instance.to_dict()
        except Exception as e:
            raise SerializationError(
                f"Instance state not serializable: {e}",
                {"instance_id": instance.instance_id},
            )

        await self.instance_store.save(instance)
        logger.debug(f"Saved instance {instance.instance_id}, status={instance.status.value}")

    async def save_with_step(
        self,
        instance: WorkflowInstance,
        step_execution: StepExecution,
    ) -> None:
        """
        Save instance with a new step execution record.

        Convenience method that adds step to history and saves atomically.

        Args:
            instance: The instance to update
            step_execution: The step execution to add
        """
        instance.step_history.append(step_execution)
        await self.save_instance(instance)

        await self._log_event(instance, "step_executed", {
            "step": step_execution.step_name,
            "status": step_execution.status.value,
            "attempt": step_execution.attempt,
        })

    # =========================================================================
    # Status Transitions
    # =========================================================================

    async def transition_to_running(self, instance: WorkflowInstance) -> None:
        """
        Transition instance to RUNNING status.

        Called when starting to execute a step.
        """
        old_status = instance.status
        instance.status = InstanceStatus.RUNNING

        if instance.started_at is None:
            instance.started_at = datetime.utcnow()

        # Clear waiting state
        instance.waiting_for = None
        instance.wait_timeout_at = None

        await self.save_instance(instance)
        await self._log_event(instance, "status_transition", {
            "from": old_status.value,
            "to": InstanceStatus.RUNNING.value,
        })

    async def transition_to_waiting(
        self,
        instance: WorkflowInstance,
        waiting_for: List[str],
        timeout_at: Optional[datetime] = None,
    ) -> None:
        """
        Transition instance to WAITING status.

        Called when a step has @wait_for decorator.

        Args:
            instance: The instance
            waiting_for: List of event types to wait for
            timeout_at: When the wait times out (if any)
        """
        old_status = instance.status
        instance.status = InstanceStatus.WAITING
        instance.waiting_for = waiting_for
        instance.wait_timeout_at = timeout_at

        await self.save_instance(instance)
        await self._log_event(instance, "status_transition", {
            "from": old_status.value,
            "to": InstanceStatus.WAITING.value,
            "waiting_for": waiting_for,
            "timeout_at": timeout_at.isoformat() if timeout_at else None,
        })

    async def transition_to_completed(self, instance: WorkflowInstance) -> None:
        """
        Transition instance to COMPLETED status.

        Called when workflow reaches terminal state successfully.
        """
        old_status = instance.status
        instance.status = InstanceStatus.COMPLETED
        instance.completed_at = datetime.utcnow()
        instance.waiting_for = None
        instance.wait_timeout_at = None

        await self.save_instance(instance)

        # Clean up any pending timers
        if self.timer_store:
            await self.timer_store.delete_by_instance(instance.instance_id)

        await self._log_event(instance, "status_transition", {
            "from": old_status.value,
            "to": InstanceStatus.COMPLETED.value,
        })

        logger.info(f"Instance {instance.instance_id} completed")

    async def transition_to_failed(
        self,
        instance: WorkflowInstance,
        error: str,
        error_type: str,
        move_to_dlq: bool = True,
    ) -> None:
        """
        Transition instance to FAILED status.

        Called when workflow fails permanently (after retries exhausted).

        Args:
            instance: The instance
            error: Error message
            error_type: Type of error
            move_to_dlq: Whether to move to dead letter queue
        """
        old_status = instance.status
        instance.status = InstanceStatus.FAILED
        instance.completed_at = datetime.utcnow()
        instance.waiting_for = None
        instance.wait_timeout_at = None

        await self.save_instance(instance)

        # Clean up timers
        if self.timer_store:
            await self.timer_store.delete_by_instance(instance.instance_id)

        # Move to dead letter queue
        if move_to_dlq and self.dead_letter_store:
            await self._move_to_dead_letter(instance, error, error_type)

        await self._log_event(instance, "status_transition", {
            "from": old_status.value,
            "to": InstanceStatus.FAILED.value,
            "error": error,
            "error_type": error_type,
        })

        logger.error(f"Instance {instance.instance_id} failed: {error}")

    async def transition_to_cancelled(
        self,
        instance: WorkflowInstance,
        reason: str,
        cancelled_by: Optional[str] = None,
    ) -> None:
        """
        Transition instance to CANCELLED status.

        Args:
            instance: The instance
            reason: Why it was cancelled
            cancelled_by: Who/what cancelled it (user_id, system, etc.)
        """
        old_status = instance.status
        instance.status = InstanceStatus.CANCELLED
        instance.completed_at = datetime.utcnow()
        instance.waiting_for = None
        instance.wait_timeout_at = None

        await self.save_instance(instance)

        # Clean up timers
        if self.timer_store:
            await self.timer_store.delete_by_instance(instance.instance_id)

        await self._log_event(instance, "status_transition", {
            "from": old_status.value,
            "to": InstanceStatus.CANCELLED.value,
            "reason": reason,
            "cancelled_by": cancelled_by,
        })

        logger.info(f"Instance {instance.instance_id} cancelled: {reason}")

    # =========================================================================
    # Instance State Management
    # =========================================================================

    async def update_instance_state(
        self,
        instance: WorkflowInstance,
        state_updates: Dict[str, Any],
    ) -> None:
        """
        Update the user's workflow state variables.

        These are the `self.x` variables in the workflow class.

        Args:
            instance: The instance to update
            state_updates: Dict of state key -> value to merge
        """
        instance.instance_state.update(state_updates)
        await self.save_instance(instance)

    async def set_current_step(
        self,
        instance: WorkflowInstance,
        step_name: str,
    ) -> None:
        """
        Set the next step to execute.

        Args:
            instance: The instance
            step_name: Name of the step to execute next
        """
        instance.current_step = step_name
        await self.save_instance(instance)

    # =========================================================================
    # Instance Queries
    # =========================================================================

    async def get_instances_by_workflow(
        self,
        workflow_id: str,
        status: Optional[InstanceStatus] = None,
        limit: int = 100,
    ) -> List[WorkflowInstance]:
        """
        Get instances for a specific workflow.

        Args:
            workflow_id: The workflow type
            status: Filter by status (None = all)
            limit: Maximum to return

        Returns:
            List of matching instances
        """
        if status:
            instances = await self.instance_store.get_by_status(
                status=status,
                workflow_id=workflow_id,
                limit=limit,
            )
        else:
            # Get all statuses
            all_instances: List[WorkflowInstance] = []
            for s in InstanceStatus:
                instances = await self.instance_store.get_by_status(
                    status=s,
                    workflow_id=workflow_id,
                    limit=limit,
                )
                all_instances.extend(instances)
            instances = all_instances[:limit]

        return instances

    async def get_child_instances(self, parent_id: str) -> List[WorkflowInstance]:
        """
        Get all child instances spawned by a parent.

        Note: This requires a storage backend that supports parent_id queries.
        Default implementation is inefficient (loads all and filters).
        """
        # This is a naive implementation - real storage should have an index
        all_instances: List[WorkflowInstance] = []
        for status in InstanceStatus:
            instances = await self.instance_store.get_by_status(status=status, limit=1000)
            for inst in instances:
                if inst.parent_instance_id == parent_id:
                    all_instances.append(inst)
        return all_instances

    async def instance_exists(self, instance_id: str) -> bool:
        """Check if an instance exists."""
        return await self.instance_store.exists(instance_id)

    # =========================================================================
    # Instance Deletion
    # =========================================================================

    async def delete_instance(self, instance_id: str) -> bool:
        """
        Delete an instance.

        Should only be called for completed/cancelled instances or cleanup.

        Args:
            instance_id: The instance to delete

        Returns:
            True if instance existed and was deleted
        """
        # Clean up timers first
        if self.timer_store:
            await self.timer_store.delete_by_instance(instance_id)

        result = await self.instance_store.delete(instance_id)

        if result:
            logger.info(f"Deleted instance {instance_id}")

        return result

    # =========================================================================
    # Runtime Migration
    # =========================================================================

    async def promote_to_cloud(self, instance: WorkflowInstance) -> WorkflowInstance:
        """
        Promote an instance from local to cloud runtime.

        Called when auto-promotion is triggered (wait_for, sleep, etc.).

        Args:
            instance: The instance to promote

        Returns:
            Updated instance with cloud runtime
        """
        if instance.runtime == RuntimeType.CLOUD:
            return instance  # Already on cloud

        old_runtime = instance.runtime
        instance.runtime = RuntimeType.CLOUD

        await self.save_instance(instance)

        await self._log_event(instance, "runtime_promotion", {
            "from": old_runtime.value,
            "to": RuntimeType.CLOUD.value,
        })

        logger.info(f"Promoted instance {instance.instance_id} to cloud runtime")
        return instance

    # =========================================================================
    # Helpers
    # =========================================================================

    async def _log_event(
        self,
        instance: WorkflowInstance,
        event_type: str,
        data: Dict[str, Any],
    ) -> None:
        """Log an event to the audit log if available."""
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

    async def _move_to_dead_letter(
        self,
        instance: WorkflowInstance,
        error: str,
        error_type: str,
    ) -> None:
        """Move failed instance to dead letter queue."""
        if not self.dead_letter_store:
            return

        # Count attempts from step history
        attempts = 0
        if instance.step_history:
            last_step = instance.step_history[-1]
            attempts = last_step.attempt

        entry = DeadLetterEntry(
            entry_id=f"dlq_{uuid.uuid4().hex[:16]}",
            instance_id=instance.instance_id,
            workflow_id=instance.workflow_id,
            workflow_version=instance.workflow_version,
            final_state=instance.to_dict(),
            failure_reason=error,
            failure_type=error_type,
            step_name=instance.current_step,
            attempts=attempts,
            failed_at=datetime.utcnow(),
            can_retry=True,  # Most failures can be retried after fixing
            metadata=instance.metadata,
        )

        await self.dead_letter_store.save(entry)
        logger.info(f"Moved instance {instance.instance_id} to dead letter queue")

    # =========================================================================
    # Idempotency Support
    # =========================================================================

    async def check_idempotency(
        self,
        workflow_id: str,
        idempotency_key: str,
    ) -> Optional[WorkflowInstance]:
        """
        Check if an instance already exists with this idempotency key.

        Returns existing instance if found, None if not.

        Note: Requires storage backend that supports metadata queries.
        Default implementation is naive.
        """
        # Naive implementation - real storage should have an index
        for status in [InstanceStatus.PENDING, InstanceStatus.RUNNING,
                       InstanceStatus.WAITING, InstanceStatus.COMPLETED]:
            instances = await self.instance_store.get_by_status(
                status=status,
                workflow_id=workflow_id,
                limit=100,
            )
            for inst in instances:
                if inst.metadata.get("idempotency_key") == idempotency_key:
                    return inst
        return None

    async def create_instance_idempotent(
        self,
        workflow_id: str,
        trigger_event: EventPayload,
        idempotency_key: str,
        runtime: RuntimeType = RuntimeType.LOCAL,
        **kwargs: Any,
    ) -> tuple[WorkflowInstance, bool]:
        """
        Create instance with idempotency guarantee.

        Returns (instance, created) where created is False if existing.

        Args:
            workflow_id: Workflow to instantiate
            trigger_event: Trigger event
            idempotency_key: Key for deduplication
            runtime: Where to execute
            **kwargs: Additional args for create_instance

        Returns:
            Tuple of (instance, was_created)
        """
        existing = await self.check_idempotency(workflow_id, idempotency_key)
        if existing:
            logger.debug(
                f"Idempotent create: returning existing instance {existing.instance_id}"
            )
            return existing, False

        # Add idempotency key to metadata
        metadata = kwargs.pop("metadata", {}) or {}
        metadata["idempotency_key"] = idempotency_key

        instance = await self.create_instance(
            workflow_id=workflow_id,
            trigger_event=trigger_event,
            runtime=runtime,
            metadata=metadata,
            **kwargs,
        )

        return instance, True
