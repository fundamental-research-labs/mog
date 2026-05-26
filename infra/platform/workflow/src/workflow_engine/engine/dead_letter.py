"""
Dead Letter Queue - Handle permanently failed workflows.

The DeadLetterQueue is responsible for:
- Storing failed workflow instances after retries exhausted
- Providing inspection and analysis of failures
- Supporting manual retry of dead-lettered workflows
- Aggregating failure statistics for monitoring

Design Principles:
- Dead letter entries preserve full instance state for debugging
- Entries can be retried, archived, or deleted
- Failure patterns can be analyzed for systemic issues
- Integration with alerting for operations

Usage:
    dlq = DeadLetterQueue(dead_letter_store, instance_manager)

    # List failed workflows
    entries = await dlq.list_entries(workflow_id="ExpenseApproval")

    # Get details about a failure
    entry = await dlq.get_entry(entry_id)

    # Retry a failed workflow
    result = await dlq.retry_entry(entry_id)

    # Get failure statistics
    stats = await dlq.get_failure_stats()
"""

from __future__ import annotations

import logging
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, List, Optional

from .types import (
    DeadLetterEntry,
    DeadLetterStore,
    EventLogStore,
    EventPayload,
    InstanceStatus,
    RuntimeType,
    WorkflowInstance,
)


logger = logging.getLogger(__name__)


@dataclass
class FailureStats:
    """
    Aggregated failure statistics.

    Attributes:
        total_entries: Total entries in dead letter queue
        by_workflow: Count by workflow type
        by_error_type: Count by error type
        by_step: Count by step name
        by_day: Count by day (last 30 days)
        oldest_entry: Oldest entry timestamp
        newest_entry: Newest entry timestamp
    """
    total_entries: int = 0
    by_workflow: Dict[str, int] = field(default_factory=dict)
    by_error_type: Dict[str, int] = field(default_factory=dict)
    by_step: Dict[str, int] = field(default_factory=dict)
    by_day: Dict[str, int] = field(default_factory=dict)
    oldest_entry: Optional[datetime] = None
    newest_entry: Optional[datetime] = None
    retryable_count: int = 0
    non_retryable_count: int = 0


@dataclass
class RetryResult:
    """
    Result of retrying a dead-lettered workflow.

    Attributes:
        success: Whether retry was successful
        entry_id: The dead letter entry
        new_instance_id: ID of newly created instance (if success)
        error: Error message (if failed)
    """
    success: bool
    entry_id: str
    new_instance_id: Optional[str] = None
    error: Optional[str] = None


class DeadLetterQueue:
    """
    Manages the dead letter queue for failed workflows.

    The dead letter queue stores workflows that have failed permanently
    (after retries exhausted) for inspection, debugging, and potential
    manual retry.

    Features:
    - Query and filter failed workflows
    - Inspect full state at time of failure
    - Retry failed workflows (creates new instance)
    - Archive or delete processed entries
    - Failure analytics and alerting

    Attributes:
        store: Storage backend for dead letter entries
        instance_manager: Manager for creating retry instances
        event_log: Audit log storage
    """

    def __init__(
        self,
        store: DeadLetterStore,
        instance_manager: Optional[Any] = None,  # InstanceManager
        event_log: Optional[EventLogStore] = None,
    ):
        """
        Initialize the DeadLetterQueue.

        Args:
            store: Storage backend
            instance_manager: For creating retry instances
            event_log: For audit logging
        """
        self.store = store
        self.instance_manager = instance_manager
        self.event_log = event_log

    # =========================================================================
    # Entry Management
    # =========================================================================

    async def add_entry(
        self,
        instance: WorkflowInstance,
        error: str,
        error_type: str,
        step_name: str,
        attempts: int,
        can_retry: bool = True,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> DeadLetterEntry:
        """
        Add a failed workflow to the dead letter queue.

        Args:
            instance: The failed workflow instance
            error: Error message
            error_type: Type of error
            step_name: Step where failure occurred
            attempts: Total retry attempts made
            can_retry: Whether manual retry is possible
            metadata: Additional metadata

        Returns:
            The created DeadLetterEntry
        """
        entry = DeadLetterEntry(
            entry_id=f"dlq_{uuid.uuid4().hex[:16]}",
            instance_id=instance.instance_id,
            workflow_id=instance.workflow_id,
            workflow_version=instance.workflow_version,
            final_state=instance.to_dict(),
            failure_reason=error,
            failure_type=error_type,
            step_name=step_name,
            attempts=attempts,
            failed_at=datetime.utcnow(),
            can_retry=can_retry,
            metadata=metadata or {},
        )

        await self.store.save(entry)

        # Log event
        if self.event_log:
            await self.event_log.log_event(
                instance_id=instance.instance_id,
                event_type="added_to_dead_letter",
                data={
                    "entry_id": entry.entry_id,
                    "error": error,
                    "error_type": error_type,
                    "step_name": step_name,
                },
            )

        logger.info(
            f"Added instance {instance.instance_id} to dead letter queue: {error}"
        )

        return entry

    async def get_entry(self, entry_id: str) -> Optional[DeadLetterEntry]:
        """
        Get a dead letter entry by ID.

        Args:
            entry_id: The entry ID

        Returns:
            The entry, or None if not found
        """
        return await self.store.get(entry_id)

    async def list_entries(
        self,
        workflow_id: Optional[str] = None,
        error_type: Optional[str] = None,
        step_name: Optional[str] = None,
        can_retry: Optional[bool] = None,
        since: Optional[datetime] = None,
        until: Optional[datetime] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[DeadLetterEntry]:
        """
        List dead letter entries with optional filtering.

        Args:
            workflow_id: Filter by workflow type
            error_type: Filter by error type
            step_name: Filter by step name
            can_retry: Filter by retryable status
            since: Only entries after this time
            until: Only entries before this time
            limit: Maximum entries to return
            offset: Pagination offset

        Returns:
            List of matching entries
        """
        # Get all entries from store
        entries = await self.store.list_entries(
            workflow_id=workflow_id,
            limit=limit * 2,  # Get extra for filtering
            offset=offset,
        )

        # Apply additional filters
        filtered = []
        for entry in entries:
            if error_type and entry.failure_type != error_type:
                continue
            if step_name and entry.step_name != step_name:
                continue
            if can_retry is not None and entry.can_retry != can_retry:
                continue
            if since and entry.failed_at < since:
                continue
            if until and entry.failed_at > until:
                continue
            filtered.append(entry)

            if len(filtered) >= limit:
                break

        return filtered

    async def delete_entry(self, entry_id: str) -> bool:
        """
        Delete a dead letter entry.

        Use after manual intervention or when entry is no longer needed.

        Args:
            entry_id: The entry to delete

        Returns:
            True if entry existed and was deleted
        """
        result = await self.store.delete(entry_id)

        if result:
            logger.info(f"Deleted dead letter entry {entry_id}")

        return result

    async def count_entries(
        self,
        workflow_id: Optional[str] = None,
    ) -> int:
        """
        Count entries in the dead letter queue.

        Args:
            workflow_id: Filter by workflow type

        Returns:
            Number of entries
        """
        return await self.store.count(workflow_id=workflow_id)

    # =========================================================================
    # Retry Operations
    # =========================================================================

    async def retry_entry(
        self,
        entry_id: str,
        reset_state: bool = False,
        override_step: Optional[str] = None,
    ) -> RetryResult:
        """
        Retry a dead-lettered workflow.

        Creates a new workflow instance from the dead letter entry.
        By default, resumes from the failed step with existing state.

        Args:
            entry_id: The dead letter entry to retry
            reset_state: If True, start fresh from beginning
            override_step: Optionally start from a different step

        Returns:
            RetryResult with new instance ID if successful
        """
        if self.instance_manager is None:
            return RetryResult(
                success=False,
                entry_id=entry_id,
                error="No instance manager configured",
            )

        entry = await self.store.get(entry_id)

        if entry is None:
            return RetryResult(
                success=False,
                entry_id=entry_id,
                error=f"Entry not found: {entry_id}",
            )

        if not entry.can_retry:
            return RetryResult(
                success=False,
                entry_id=entry_id,
                error="Entry is not retryable",
            )

        try:
            # Reconstruct trigger event
            trigger_event = EventPayload.from_dict(
                entry.final_state.get("trigger_event", {})
            )

            # Create new instance
            new_instance = await self.instance_manager.create_instance(
                workflow_id=entry.workflow_id,
                trigger_event=trigger_event,
                runtime=RuntimeType.CLOUD,  # Retries go to cloud
                metadata={
                    "retry_from_dlq": entry_id,
                    "original_instance_id": entry.instance_id,
                },
            )

            # Restore state if not resetting
            if not reset_state:
                new_instance.instance_state = entry.final_state.get("instance_state", {})

            # Set starting step
            if override_step:
                new_instance.current_step = override_step
            elif not reset_state:
                new_instance.current_step = entry.step_name

            await self.instance_manager.save_instance(new_instance)

            # Log retry
            if self.event_log:
                await self.event_log.log_event(
                    instance_id=new_instance.instance_id,
                    event_type="retried_from_dead_letter",
                    data={
                        "entry_id": entry_id,
                        "original_instance_id": entry.instance_id,
                        "reset_state": reset_state,
                    },
                )

            # Mark entry as retried (add metadata)
            entry.metadata["retried_at"] = datetime.utcnow().isoformat()
            entry.metadata["retry_instance_id"] = new_instance.instance_id
            await self.store.save(entry)

            logger.info(
                f"Retried dead letter entry {entry_id} -> {new_instance.instance_id}"
            )

            return RetryResult(
                success=True,
                entry_id=entry_id,
                new_instance_id=new_instance.instance_id,
            )

        except Exception as e:
            logger.exception(f"Failed to retry entry {entry_id}: {e}")
            return RetryResult(
                success=False,
                entry_id=entry_id,
                error=str(e),
            )

    async def bulk_retry(
        self,
        entry_ids: List[str],
        reset_state: bool = False,
    ) -> List[RetryResult]:
        """
        Retry multiple dead-lettered workflows.

        Args:
            entry_ids: Entries to retry
            reset_state: Whether to reset state

        Returns:
            List of RetryResults
        """
        results = []
        for entry_id in entry_ids:
            result = await self.retry_entry(entry_id, reset_state=reset_state)
            results.append(result)
        return results

    async def retry_all_retryable(
        self,
        workflow_id: Optional[str] = None,
        limit: int = 100,
    ) -> List[RetryResult]:
        """
        Retry all retryable entries.

        Args:
            workflow_id: Filter by workflow type
            limit: Maximum entries to retry

        Returns:
            List of RetryResults
        """
        entries = await self.list_entries(
            workflow_id=workflow_id,
            can_retry=True,
            limit=limit,
        )

        results = []
        for entry in entries:
            result = await self.retry_entry(entry.entry_id)
            results.append(result)

        return results

    # =========================================================================
    # Analytics
    # =========================================================================

    async def get_failure_stats(
        self,
        since: Optional[datetime] = None,
    ) -> FailureStats:
        """
        Get aggregated failure statistics.

        Args:
            since: Only count entries since this time

        Returns:
            FailureStats with aggregated data
        """
        # Get all entries (or recent entries)
        entries = await self.store.list_entries(limit=10000)

        if since:
            entries = [e for e in entries if e.failed_at >= since]

        stats = FailureStats()
        stats.total_entries = len(entries)

        by_workflow: Dict[str, int] = defaultdict(int)
        by_error_type: Dict[str, int] = defaultdict(int)
        by_step: Dict[str, int] = defaultdict(int)
        by_day: Dict[str, int] = defaultdict(int)

        for entry in entries:
            by_workflow[entry.workflow_id] += 1
            by_error_type[entry.failure_type] += 1
            by_step[entry.step_name] += 1

            day_key = entry.failed_at.strftime("%Y-%m-%d")
            by_day[day_key] += 1

            if entry.can_retry:
                stats.retryable_count += 1
            else:
                stats.non_retryable_count += 1

            # Track oldest/newest
            if stats.oldest_entry is None or entry.failed_at < stats.oldest_entry:
                stats.oldest_entry = entry.failed_at
            if stats.newest_entry is None or entry.failed_at > stats.newest_entry:
                stats.newest_entry = entry.failed_at

        stats.by_workflow = dict(by_workflow)
        stats.by_error_type = dict(by_error_type)
        stats.by_step = dict(by_step)
        stats.by_day = dict(by_day)

        return stats

    async def get_top_failures(
        self,
        top_n: int = 10,
        since: Optional[datetime] = None,
    ) -> Dict[str, List[Dict[str, Any]]]:
        """
        Get top failure patterns.

        Args:
            top_n: Number of top items per category
            since: Time range filter

        Returns:
            Dict with top failures by workflow, error_type, and step
        """
        stats = await self.get_failure_stats(since=since)

        def top_items(d: Dict[str, int]) -> List[Dict[str, Any]]:
            sorted_items = sorted(d.items(), key=lambda x: -x[1])
            return [
                {"name": k, "count": v}
                for k, v in sorted_items[:top_n]
            ]

        return {
            "by_workflow": top_items(stats.by_workflow),
            "by_error_type": top_items(stats.by_error_type),
            "by_step": top_items(stats.by_step),
        }

    # =========================================================================
    # Cleanup Operations
    # =========================================================================

    async def archive_old_entries(
        self,
        older_than: datetime,
        archive_callback: Optional[Callable[[List[DeadLetterEntry]], Any]] = None,
    ) -> int:
        """
        Archive entries older than a given date.

        Args:
            older_than: Archive entries failed before this time
            archive_callback: Optional callback to process archived entries

        Returns:
            Number of entries archived/deleted
        """
        entries = await self.store.list_entries(limit=10000)

        to_archive = [e for e in entries if e.failed_at < older_than]

        if archive_callback:
            result = archive_callback(to_archive)
            if hasattr(result, "__await__"):
                await result

        count = 0
        for entry in to_archive:
            if await self.store.delete(entry.entry_id):
                count += 1

        logger.info(f"Archived {count} dead letter entries older than {older_than}")
        return count

    async def purge_retried_entries(self) -> int:
        """
        Delete entries that have been successfully retried.

        Returns:
            Number of entries deleted
        """
        entries = await self.store.list_entries(limit=10000)

        to_delete = [
            e for e in entries
            if e.metadata.get("retry_instance_id")
        ]

        count = 0
        for entry in to_delete:
            if await self.store.delete(entry.entry_id):
                count += 1

        logger.info(f"Purged {count} retried dead letter entries")
        return count

    async def mark_non_retryable(
        self,
        entry_id: str,
        reason: str,
    ) -> bool:
        """
        Mark an entry as non-retryable.

        Args:
            entry_id: The entry
            reason: Why it can't be retried

        Returns:
            True if entry was updated
        """
        entry = await self.store.get(entry_id)
        if entry is None:
            return False

        entry.can_retry = False
        entry.metadata["non_retryable_reason"] = reason
        entry.metadata["marked_non_retryable_at"] = datetime.utcnow().isoformat()

        await self.store.save(entry)
        return True


class DeadLetterAlertManager:
    """
    Manages alerts for dead letter queue conditions.

    Integrates with the dead letter queue to trigger alerts
    when thresholds are exceeded.
    """

    def __init__(
        self,
        dlq: DeadLetterQueue,
        alert_callback: Callable[[str, Dict[str, Any]], Any],
    ):
        """
        Initialize the alert manager.

        Args:
            dlq: The dead letter queue
            alert_callback: Function to call when alert triggered
                           signature: (alert_type, data) -> None
        """
        self.dlq = dlq
        self.alert_callback = alert_callback
        self.thresholds = {
            "total_entries": 100,
            "entries_per_hour": 10,
            "same_error_threshold": 5,
        }

    async def check_alerts(self) -> List[Dict[str, Any]]:
        """
        Check for alert conditions.

        Returns:
            List of triggered alerts
        """
        alerts = []

        stats = await self.dlq.get_failure_stats()

        # Check total entries
        if stats.total_entries >= self.thresholds["total_entries"]:
            alert = {
                "type": "high_dlq_count",
                "message": f"Dead letter queue has {stats.total_entries} entries",
                "count": stats.total_entries,
                "threshold": self.thresholds["total_entries"],
            }
            alerts.append(alert)
            self.alert_callback("high_dlq_count", alert)

        # Check entries per hour
        one_hour_ago = datetime.utcnow() - timedelta(hours=1)
        recent_stats = await self.dlq.get_failure_stats(since=one_hour_ago)

        if recent_stats.total_entries >= self.thresholds["entries_per_hour"]:
            alert = {
                "type": "high_failure_rate",
                "message": f"{recent_stats.total_entries} failures in the last hour",
                "count": recent_stats.total_entries,
                "threshold": self.thresholds["entries_per_hour"],
            }
            alerts.append(alert)
            self.alert_callback("high_failure_rate", alert)

        # Check for repeated errors
        for error_type, count in stats.by_error_type.items():
            if count >= self.thresholds["same_error_threshold"]:
                alert = {
                    "type": "repeated_error",
                    "message": f"Error '{error_type}' occurred {count} times",
                    "error_type": error_type,
                    "count": count,
                    "threshold": self.thresholds["same_error_threshold"],
                }
                alerts.append(alert)
                self.alert_callback("repeated_error", alert)

        return alerts

    def set_threshold(self, name: str, value: int) -> None:
        """Set an alert threshold."""
        self.thresholds[name] = value
