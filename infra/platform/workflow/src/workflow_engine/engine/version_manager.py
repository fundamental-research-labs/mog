"""
Version Manager - Handle workflow versioning (replace, parallel, migrate strategies).

The VersionManager is responsible for:
- Managing multiple versions of workflow definitions
- Implementing versioning strategies (replace, parallel, migrate)
- Handling running instances during version upgrades
- Executing state migration functions for the migrate strategy
- Tracking version compatibility

Design Principles:
- Versioning is explicit (semantic versioning)
- Running instances can continue on old code
- Migration functions transform state between versions
- Version policies are per-workflow configurable

Versioning Strategies:
- REPLACE: New instances use new code; running instances continue on old
- PARALLEL: Both versions run independently; user chooses for new triggers
- MIGRATE: Running instances migrated to new version via migration function

Usage:
    manager = VersionManager(workflow_store, instance_store)

    # Register new version
    await manager.register_version(new_definition)

    # Migrate running instances
    results = await manager.migrate_instances(
        workflow_id="ExpenseApproval",
        from_version="1.0.0",
        to_version="2.0.0",
    )
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Tuple, Type

from .types import (
    EventLogStore,
    InstanceStatus,
    InstanceStore,
    VersioningStrategy,
    VersionMismatchError,
    WorkflowDefinition,
    WorkflowDefinitionError,
    WorkflowInstance,
    WorkflowStore,
)


logger = logging.getLogger(__name__)


@dataclass
class Version:
    """
    Parsed semantic version.

    Attributes:
        major: Major version (breaking changes)
        minor: Minor version (new features, backward compatible)
        patch: Patch version (bug fixes)
        prerelease: Prerelease identifier (e.g., "alpha.1")
    """
    major: int
    minor: int
    patch: int
    prerelease: Optional[str] = None

    def __str__(self) -> str:
        base = f"{self.major}.{self.minor}.{self.patch}"
        if self.prerelease:
            base += f"-{self.prerelease}"
        return base

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Version):
            return False
        return (self.major, self.minor, self.patch, self.prerelease) == \
               (other.major, other.minor, other.patch, other.prerelease)

    def __lt__(self, other: "Version") -> bool:
        # Compare major.minor.patch first
        if (self.major, self.minor, self.patch) != (other.major, other.minor, other.patch):
            return (self.major, self.minor, self.patch) < (other.major, other.minor, other.patch)
        # Prerelease versions are less than release versions
        if self.prerelease is None and other.prerelease is not None:
            return False
        if self.prerelease is not None and other.prerelease is None:
            return True
        # Compare prerelease strings
        return (self.prerelease or "") < (other.prerelease or "")

    def __le__(self, other: "Version") -> bool:
        return self == other or self < other

    def __gt__(self, other: "Version") -> bool:
        return not self <= other

    def __ge__(self, other: "Version") -> bool:
        return not self < other

    @classmethod
    def parse(cls, version_str: str) -> "Version":
        """
        Parse a semantic version string.

        Args:
            version_str: Version string (e.g., "1.2.3", "1.0.0-alpha.1")

        Returns:
            Parsed Version

        Raises:
            ValueError: If format is invalid
        """
        pattern = r"^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$"
        match = re.match(pattern, version_str)

        if not match:
            raise ValueError(f"Invalid version format: {version_str}")

        return cls(
            major=int(match.group(1)),
            minor=int(match.group(2)),
            patch=int(match.group(3)),
            prerelease=match.group(4),
        )

    def is_compatible_with(self, other: "Version") -> bool:
        """
        Check if this version is backward compatible with another.

        Same major version is considered compatible.
        """
        return self.major == other.major

    def is_breaking_change_from(self, other: "Version") -> bool:
        """Check if this is a breaking change from another version."""
        return self.major > other.major


@dataclass
class MigrationResult:
    """
    Result of migrating a single instance.

    Attributes:
        success: Whether migration succeeded
        instance_id: The migrated instance
        from_version: Original version
        to_version: Target version
        error: Error message if failed
    """
    success: bool
    instance_id: str
    from_version: str
    to_version: str
    error: Optional[str] = None


@dataclass
class VersionInfo:
    """
    Information about a workflow version.

    Attributes:
        workflow_id: The workflow
        version: Version string
        strategy: Versioning strategy
        created_at: When registered
        is_active: Whether this version is active for new instances
        instance_count: Number of running instances
    """
    workflow_id: str
    version: str
    strategy: VersioningStrategy
    created_at: datetime
    is_active: bool
    instance_count: int = 0


# Type alias for migration functions
MigrationFunc = Callable[[Dict[str, Any]], Dict[str, Any]]


class VersionManager:
    """
    Manages workflow versioning and migrations.

    The VersionManager handles the complexity of running multiple
    workflow versions simultaneously and migrating between them.

    Attributes:
        workflow_store: Storage for workflow definitions
        instance_store: Storage for instances
        event_log: Audit log storage
        migration_functions: Registry of migration functions
        workflow_registry: Registry of workflow classes
    """

    def __init__(
        self,
        workflow_store: WorkflowStore,
        instance_store: Optional[InstanceStore] = None,
        event_log: Optional[EventLogStore] = None,
    ):
        """
        Initialize the VersionManager.

        Args:
            workflow_store: Storage for definitions
            instance_store: Storage for instances
            event_log: Audit log storage
        """
        self.workflow_store = workflow_store
        self.instance_store = instance_store
        self.event_log = event_log

        # Registry of migration functions: (workflow_id, from_version, to_version) -> func
        self._migrations: Dict[Tuple[str, str, str], MigrationFunc] = {}

        # Registry of workflow classes by version: (workflow_id, version) -> class
        self._workflow_classes: Dict[Tuple[str, str], Type[Any]] = {}

        # Track active version per workflow
        self._active_versions: Dict[str, str] = {}

    # =========================================================================
    # Version Registration
    # =========================================================================

    async def register_version(
        self,
        definition: WorkflowDefinition,
        workflow_class: Optional[Type[Any]] = None,
        make_active: bool = True,
    ) -> VersionInfo:
        """
        Register a new workflow version.

        Args:
            definition: The workflow definition
            workflow_class: The Python class implementing the workflow
            make_active: Whether to make this the active version

        Returns:
            VersionInfo for the registered version
        """
        # Validate version format
        try:
            Version.parse(definition.version)
        except ValueError as e:
            raise WorkflowDefinitionError(f"Invalid version format: {e}")

        # Save definition
        await self.workflow_store.save(definition)

        # Register class if provided
        if workflow_class:
            self._workflow_classes[(definition.workflow_id, definition.version)] = workflow_class

        # Make active if requested
        if make_active:
            self._active_versions[definition.workflow_id] = definition.version

        # Log registration
        if self.event_log:
            await self.event_log.log_event(
                instance_id=f"version:{definition.workflow_id}:{definition.version}",
                event_type="version_registered",
                data={
                    "workflow_id": definition.workflow_id,
                    "version": definition.version,
                    "strategy": definition.versioning_strategy.value,
                    "is_active": make_active,
                },
            )

        logger.info(
            f"Registered workflow {definition.workflow_id} "
            f"v{definition.version} (active={make_active})"
        )

        return VersionInfo(
            workflow_id=definition.workflow_id,
            version=definition.version,
            strategy=definition.versioning_strategy,
            created_at=datetime.utcnow(),
            is_active=make_active,
        )

    async def deactivate_version(
        self,
        workflow_id: str,
        version: str,
    ) -> bool:
        """
        Deactivate a version (no new instances will use it).

        Args:
            workflow_id: The workflow
            version: The version to deactivate

        Returns:
            True if version was deactivated
        """
        current_active = self._active_versions.get(workflow_id)

        if current_active == version:
            # Find another version to make active
            all_versions = await self.workflow_store.get_all_versions(workflow_id)
            other_versions = [v for v in all_versions if v.version != version]

            if other_versions:
                # Use the latest other version
                latest = max(other_versions, key=lambda v: Version.parse(v.version))
                self._active_versions[workflow_id] = latest.version
                logger.info(
                    f"Switched active version for {workflow_id} "
                    f"from {version} to {latest.version}"
                )
            else:
                del self._active_versions[workflow_id]

        return True

    def register_migration(
        self,
        workflow_id: str,
        from_version: str,
        to_version: str,
        migration_func: MigrationFunc,
    ) -> None:
        """
        Register a state migration function.

        The migration function transforms instance state from one version to another.

        Args:
            workflow_id: The workflow type
            from_version: Source version
            to_version: Target version
            migration_func: Function that transforms state dict

        Example:
            def migrate_v1_to_v2(state: dict) -> dict:
                return {
                    **state,
                    "new_field": compute_new_field(state),
                }

            manager.register_migration("ExpenseApproval", "1.0.0", "2.0.0", migrate_v1_to_v2)
        """
        key = (workflow_id, from_version, to_version)
        self._migrations[key] = migration_func

        logger.debug(
            f"Registered migration for {workflow_id}: {from_version} -> {to_version}"
        )

    def register_workflow_class(
        self,
        workflow_id: str,
        version: str,
        workflow_class: Type[Any],
    ) -> None:
        """
        Register a workflow class for a specific version.

        Args:
            workflow_id: The workflow
            version: The version
            workflow_class: The Python class
        """
        self._workflow_classes[(workflow_id, version)] = workflow_class

    # =========================================================================
    # Version Queries
    # =========================================================================

    async def get_active_version(
        self,
        workflow_id: str,
    ) -> Optional[WorkflowDefinition]:
        """
        Get the active version of a workflow.

        Args:
            workflow_id: The workflow

        Returns:
            Active version definition, or None
        """
        version = self._active_versions.get(workflow_id)
        if version:
            return await self.workflow_store.get(workflow_id, version)

        # If no explicit active, use latest
        return await self.workflow_store.get(workflow_id)  # None version = latest

    async def get_all_versions(
        self,
        workflow_id: str,
    ) -> List[VersionInfo]:
        """
        Get all versions of a workflow.

        Args:
            workflow_id: The workflow

        Returns:
            List of VersionInfo ordered by version
        """
        definitions = await self.workflow_store.get_all_versions(workflow_id)

        # Count instances per version
        instance_counts: Dict[str, int] = {}
        if self.instance_store:
            for status in [InstanceStatus.RUNNING, InstanceStatus.WAITING, InstanceStatus.PENDING]:
                instances = await self.instance_store.get_by_status(
                    status=status,
                    workflow_id=workflow_id,
                    limit=10000,
                )
                for inst in instances:
                    version = inst.workflow_version
                    instance_counts[version] = instance_counts.get(version, 0) + 1

        active_version = self._active_versions.get(workflow_id)

        result = []
        for defn in definitions:
            result.append(VersionInfo(
                workflow_id=defn.workflow_id,
                version=defn.version,
                strategy=defn.versioning_strategy,
                created_at=datetime.utcnow(),  # TODO: Store actual creation time
                is_active=(defn.version == active_version),
                instance_count=instance_counts.get(defn.version, 0),
            ))

        # Sort by version
        result.sort(key=lambda v: Version.parse(v.version))
        return result

    def get_workflow_class(
        self,
        workflow_id: str,
        version: str,
    ) -> Optional[Type[Any]]:
        """
        Get the workflow class for a specific version.

        Args:
            workflow_id: The workflow
            version: The version

        Returns:
            The workflow class, or None if not registered
        """
        return self._workflow_classes.get((workflow_id, version))

    # =========================================================================
    # Instance Migration
    # =========================================================================

    async def migrate_instance(
        self,
        instance: WorkflowInstance,
        to_version: str,
    ) -> MigrationResult:
        """
        Migrate a single instance to a new version.

        Args:
            instance: The instance to migrate
            to_version: Target version

        Returns:
            MigrationResult
        """
        from_version = instance.workflow_version

        if from_version == to_version:
            return MigrationResult(
                success=True,
                instance_id=instance.instance_id,
                from_version=from_version,
                to_version=to_version,
            )

        # Check for migration function
        migration_func = self._get_migration_path(
            instance.workflow_id,
            from_version,
            to_version,
        )

        if migration_func is None:
            return MigrationResult(
                success=False,
                instance_id=instance.instance_id,
                from_version=from_version,
                to_version=to_version,
                error=f"No migration path from {from_version} to {to_version}",
            )

        try:
            # Apply migration to instance state
            new_state = migration_func(instance.instance_state)

            # Validate new state
            if not isinstance(new_state, dict):
                raise ValueError("Migration function must return a dict")

            # Update instance
            instance.instance_state = new_state
            instance.workflow_version = to_version
            instance.metadata["migrated_from"] = from_version
            instance.metadata["migrated_at"] = datetime.utcnow().isoformat()

            if self.instance_store:
                await self.instance_store.save(instance)

            # Log migration
            if self.event_log:
                await self.event_log.log_event(
                    instance_id=instance.instance_id,
                    event_type="instance_migrated",
                    data={
                        "workflow_id": instance.workflow_id,
                        "from_version": from_version,
                        "to_version": to_version,
                    },
                )

            logger.info(
                f"Migrated instance {instance.instance_id} "
                f"from v{from_version} to v{to_version}"
            )

            return MigrationResult(
                success=True,
                instance_id=instance.instance_id,
                from_version=from_version,
                to_version=to_version,
            )

        except Exception as e:
            logger.exception(
                f"Migration failed for {instance.instance_id}: {e}"
            )
            return MigrationResult(
                success=False,
                instance_id=instance.instance_id,
                from_version=from_version,
                to_version=to_version,
                error=str(e),
            )

    async def migrate_instances(
        self,
        workflow_id: str,
        from_version: str,
        to_version: str,
        status_filter: Optional[List[InstanceStatus]] = None,
        batch_size: int = 100,
    ) -> List[MigrationResult]:
        """
        Migrate all instances from one version to another.

        Args:
            workflow_id: The workflow type
            from_version: Source version
            to_version: Target version
            status_filter: Only migrate instances with these statuses
            batch_size: Process in batches

        Returns:
            List of MigrationResults
        """
        if self.instance_store is None:
            logger.error("Cannot migrate: no instance store")
            return []

        # Check migration path exists
        if self._get_migration_path(workflow_id, from_version, to_version) is None:
            logger.error(
                f"No migration path from {from_version} to {to_version}"
            )
            return []

        statuses = status_filter or [
            InstanceStatus.PENDING,
            InstanceStatus.RUNNING,
            InstanceStatus.WAITING,
        ]

        results: List[MigrationResult] = []

        for status in statuses:
            instances = await self.instance_store.get_by_status(
                status=status,
                workflow_id=workflow_id,
                limit=batch_size,
            )

            # Filter to source version
            instances = [i for i in instances if i.workflow_version == from_version]

            for instance in instances:
                result = await self.migrate_instance(instance, to_version)
                results.append(result)

        success_count = sum(1 for r in results if r.success)
        logger.info(
            f"Migrated {success_count}/{len(results)} instances "
            f"from v{from_version} to v{to_version}"
        )

        return results

    def _get_migration_path(
        self,
        workflow_id: str,
        from_version: str,
        to_version: str,
    ) -> Optional[MigrationFunc]:
        """
        Find a migration function between two versions.

        Supports direct migration or chained migrations.

        Args:
            workflow_id: The workflow
            from_version: Source version
            to_version: Target version

        Returns:
            Migration function, or None if no path exists
        """
        # Direct migration
        key = (workflow_id, from_version, to_version)
        if key in self._migrations:
            return self._migrations[key]

        # TODO: Implement chained migrations (e.g., 1.0 -> 1.1 -> 2.0)
        # For now, only direct migrations are supported

        return None

    # =========================================================================
    # Versioning Strategy Implementation
    # =========================================================================

    async def handle_new_trigger(
        self,
        workflow_id: str,
        trigger_event: Any,
    ) -> Optional[str]:
        """
        Determine which version to use for a new trigger.

        Based on the versioning strategy of the workflow.

        Args:
            workflow_id: The workflow being triggered
            trigger_event: The trigger event

        Returns:
            Version string to use, or None if no version available
        """
        # Get active version
        definition = await self.get_active_version(workflow_id)

        if definition is None:
            return None

        strategy = definition.versioning_strategy

        if strategy == VersioningStrategy.REPLACE:
            # Always use active/latest version
            return definition.version

        elif strategy == VersioningStrategy.PARALLEL:
            # User-specified or default to active
            # Check trigger_event for version preference
            if hasattr(trigger_event, "data") and trigger_event.data.get("workflow_version"):
                preferred = trigger_event.data["workflow_version"]
                # Validate version exists
                if await self.workflow_store.get(workflow_id, preferred):
                    return preferred
            return definition.version

        elif strategy == VersioningStrategy.MIGRATE:
            # Always use latest version
            return definition.version

        return definition.version

    async def cleanup_old_versions(
        self,
        workflow_id: str,
        keep_versions: int = 3,
        require_no_instances: bool = True,
    ) -> List[str]:
        """
        Clean up old workflow versions.

        Args:
            workflow_id: The workflow
            keep_versions: Number of recent versions to keep
            require_no_instances: Only delete if no running instances

        Returns:
            List of deleted version strings
        """
        all_versions = await self.get_all_versions(workflow_id)

        if len(all_versions) <= keep_versions:
            return []

        # Sort by version (newest first)
        all_versions.sort(key=lambda v: Version.parse(v.version), reverse=True)

        # Identify versions to delete
        to_delete = all_versions[keep_versions:]

        deleted = []
        for version_info in to_delete:
            # Skip if has running instances and required
            if require_no_instances and version_info.instance_count > 0:
                logger.debug(
                    f"Skipping deletion of {version_info.version}: "
                    f"{version_info.instance_count} running instances"
                )
                continue

            # Skip if active
            if version_info.is_active:
                continue

            # Delete from store
            await self.workflow_store.delete(workflow_id, version_info.version)

            # Clean up class registry
            key = (workflow_id, version_info.version)
            if key in self._workflow_classes:
                del self._workflow_classes[key]

            deleted.append(version_info.version)
            logger.info(f"Deleted version {workflow_id} v{version_info.version}")

        return deleted


def compare_versions(v1: str, v2: str) -> int:
    """
    Compare two version strings.

    Returns:
        -1 if v1 < v2, 0 if v1 == v2, 1 if v1 > v2
    """
    parsed_v1 = Version.parse(v1)
    parsed_v2 = Version.parse(v2)

    if parsed_v1 < parsed_v2:
        return -1
    elif parsed_v1 > parsed_v2:
        return 1
    return 0


def is_breaking_change(from_version: str, to_version: str) -> bool:
    """
    Check if upgrading from one version to another is a breaking change.

    A breaking change is a major version bump.
    """
    from_parsed = Version.parse(from_version)
    to_parsed = Version.parse(to_version)
    return to_parsed.major > from_parsed.major
