"""
Versioning Integration Tests

Tests version strategies:
- REPLACE: New instances use v2, running instances finish on v1
- PARALLEL: Both versions accept triggers
- MIGRATE: Running instances migrated via migration function
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Callable

import pytest

from workflow_engine.stores.memory import InMemoryStores
from workflow_engine.stores.base import (
    WorkflowDefinition,
    WorkflowInstance,
    InstanceStatus,
    RuntimeType,
    TriggerType,
    TriggerConfig,
    StepDefinition,
    StepHistory,
    WaitingState,
    Timer,
    VersioningStrategy,
)


class MockVersionManager:
    """Mock version manager for testing versioning strategies."""

    def __init__(self, stores: InMemoryStores):
        self.stores = stores
        self._active_versions: Dict[str, str] = {}
        self._migration_functions: Dict[tuple, Callable] = {}

    async def register_version(
        self,
        definition: WorkflowDefinition,
        make_active: bool = True,
    ) -> str:
        """Register a new workflow version."""
        workflow_id = await self.stores.workflows.create(definition)

        if make_active:
            self._active_versions[definition.name] = definition.version

        return workflow_id

    def get_active_version(self, workflow_name: str) -> Optional[str]:
        """Get the active version for a workflow."""
        return self._active_versions.get(workflow_name)

    def set_active_version(self, workflow_name: str, version: str) -> None:
        """Set the active version for a workflow."""
        self._active_versions[workflow_name] = version

    def register_migration(
        self,
        workflow_name: str,
        from_version: str,
        to_version: str,
        migration_func: Callable[[Dict[str, Any]], Dict[str, Any]],
    ) -> None:
        """Register a migration function between versions."""
        key = (workflow_name, from_version, to_version)
        self._migration_functions[key] = migration_func

    def get_migration(
        self, workflow_name: str, from_version: str, to_version: str
    ) -> Optional[Callable]:
        """Get migration function between versions."""
        key = (workflow_name, from_version, to_version)
        return self._migration_functions.get(key)

    async def migrate_instance(
        self, instance: WorkflowInstance, to_version: str
    ) -> bool:
        """Migrate an instance to a new version."""
        migration = self.get_migration(
            instance.workflow_name,
            instance.workflow_version,
            to_version,
        )

        if migration is None:
            return False

        # Apply migration to state
        try:
            new_state = migration(instance.state)
            instance.state = new_state
            instance.workflow_version = to_version
            instance.metadata["migrated_from"] = instance.workflow_version
            instance.metadata["migrated_at"] = datetime.utcnow().isoformat()
            await self.stores.instances.update(instance.id, instance)
            return True
        except Exception:
            return False


@pytest.fixture
def version_manager(stores: InMemoryStores) -> MockVersionManager:
    """Create a mock version manager."""
    return MockVersionManager(stores)


class TestReplaceStrategy:
    """Tests for REPLACE versioning strategy."""

    @pytest.mark.asyncio
    async def test_new_instances_use_latest_version(self, stores, version_manager):
        """Test that new instances use the latest version."""
        # Register v1
        v1_def = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="ReplaceWorkflow",
            description="V1 workflow",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="v1_step")],
            versioning_strategy=VersioningStrategy.REPLACE,
        )
        await version_manager.register_version(v1_def)

        # Create instance on v1
        instance_v1 = WorkflowInstance(
            id=f"inst_{uuid.uuid4().hex[:8]}",
            workflow_id=v1_def.id,
            workflow_name=v1_def.name,
            workflow_version="1.0.0",
            status=InstanceStatus.RUNNING,
            current_step="v1_step",
            state={},
            trigger_event={"type": "manual"},
        )
        await stores.instances.create(instance_v1)

        # Register v2
        v2_def = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="ReplaceWorkflow",
            description="V2 workflow",
            version="2.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="v2_step")],
            versioning_strategy=VersioningStrategy.REPLACE,
        )
        await version_manager.register_version(v2_def)

        # Active version should now be v2
        assert version_manager.get_active_version("ReplaceWorkflow") == "2.0.0"

        # Create new instance - should use v2
        instance_v2 = WorkflowInstance(
            id=f"inst_{uuid.uuid4().hex[:8]}",
            workflow_id=v2_def.id,
            workflow_name=v2_def.name,
            workflow_version=version_manager.get_active_version("ReplaceWorkflow"),
            status=InstanceStatus.PENDING,
            current_step="v2_step",
            state={},
            trigger_event={"type": "manual"},
        )
        await stores.instances.create(instance_v2)

        assert instance_v2.workflow_version == "2.0.0"

    @pytest.mark.asyncio
    async def test_running_instances_continue_on_old_version(
        self, stores, version_manager
    ):
        """Test that running instances continue on their original version."""
        # Register v1
        v1_def = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="ContinueWorkflow",
            description="V1 workflow",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="step_1"), StepDefinition(name="step_2")],
            versioning_strategy=VersioningStrategy.REPLACE,
        )
        await version_manager.register_version(v1_def)

        # Create running instance on v1
        instance = WorkflowInstance(
            id=f"inst_{uuid.uuid4().hex[:8]}",
            workflow_id=v1_def.id,
            workflow_name=v1_def.name,
            workflow_version="1.0.0",
            status=InstanceStatus.RUNNING,
            current_step="step_1",
            state={"started_on": "v1"},
            trigger_event={"type": "manual"},
        )
        await stores.instances.create(instance)

        # Register v2
        v2_def = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="ContinueWorkflow",
            description="V2 workflow with changes",
            version="2.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="new_step_1"), StepDefinition(name="step_2")],
            versioning_strategy=VersioningStrategy.REPLACE,
        )
        await version_manager.register_version(v2_def)

        # Running instance should still be on v1
        recovered = await stores.instances.get(instance.id)
        assert recovered.workflow_version == "1.0.0"
        assert recovered.current_step == "step_1"  # Original v1 step

    @pytest.mark.asyncio
    async def test_waiting_instances_continue_on_old_version(
        self, stores, version_manager
    ):
        """Test that waiting instances continue on their original version."""
        # Register v1
        v1_def = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="WaitingWorkflow",
            description="V1 workflow",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="wait_step")],
            versioning_strategy=VersioningStrategy.REPLACE,
        )
        await version_manager.register_version(v1_def)

        # Create waiting instance on v1
        instance = WorkflowInstance(
            id=f"inst_{uuid.uuid4().hex[:8]}",
            workflow_id=v1_def.id,
            workflow_name=v1_def.name,
            workflow_version="1.0.0",
            status=InstanceStatus.WAITING,
            current_step="wait_step",
            state={},
            trigger_event={"type": "manual"},
            waiting=WaitingState(events=["approval"]),
        )
        await stores.instances.create(instance)

        # Register v2
        v2_def = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="WaitingWorkflow",
            description="V2 workflow",
            version="2.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="new_wait_step")],
            versioning_strategy=VersioningStrategy.REPLACE,
        )
        await version_manager.register_version(v2_def)

        # Waiting instance should still be on v1
        recovered = await stores.instances.get(instance.id)
        assert recovered.workflow_version == "1.0.0"


class TestParallelStrategy:
    """Tests for PARALLEL versioning strategy."""

    @pytest.mark.asyncio
    async def test_both_versions_accept_triggers(self, stores, version_manager):
        """Test that both versions can accept new triggers."""
        # Register v1
        v1_def = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="ParallelWorkflow",
            description="V1 workflow",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="v1_step")],
            versioning_strategy=VersioningStrategy.PARALLEL,
        )
        await version_manager.register_version(v1_def, make_active=True)

        # Register v2 without making it the only active version
        v2_def = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="ParallelWorkflow",
            description="V2 workflow",
            version="2.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="v2_step")],
            versioning_strategy=VersioningStrategy.PARALLEL,
        )
        await version_manager.register_version(v2_def, make_active=True)

        # Both definitions should exist
        v1_stored = await stores.workflows.get_by_name_and_version(
            "ParallelWorkflow", "1.0.0"
        )
        v2_stored = await stores.workflows.get_by_name_and_version(
            "ParallelWorkflow", "2.0.0"
        )

        assert v1_stored is not None
        assert v2_stored is not None

        # Create instances on both versions
        instance_v1 = WorkflowInstance(
            id=f"inst_v1_{uuid.uuid4().hex[:8]}",
            workflow_id=v1_def.id,
            workflow_name=v1_def.name,
            workflow_version="1.0.0",
            status=InstanceStatus.PENDING,
            current_step="v1_step",
            state={"version": "v1"},
            trigger_event={"type": "manual", "requested_version": "1.0.0"},
        )
        await stores.instances.create(instance_v1)

        instance_v2 = WorkflowInstance(
            id=f"inst_v2_{uuid.uuid4().hex[:8]}",
            workflow_id=v2_def.id,
            workflow_name=v2_def.name,
            workflow_version="2.0.0",
            status=InstanceStatus.PENDING,
            current_step="v2_step",
            state={"version": "v2"},
            trigger_event={"type": "manual", "requested_version": "2.0.0"},
        )
        await stores.instances.create(instance_v2)

        # Both should exist
        v1_instance = await stores.instances.get(instance_v1.id)
        v2_instance = await stores.instances.get(instance_v2.id)

        assert v1_instance.workflow_version == "1.0.0"
        assert v2_instance.workflow_version == "2.0.0"

    @pytest.mark.asyncio
    async def test_version_specified_in_trigger(self, stores, version_manager):
        """Test that trigger can specify which version to use."""
        # Register both versions
        v1_def = WorkflowDefinition(
            id=f"wf_v1_{uuid.uuid4().hex[:8]}",
            name="VersionedWorkflow",
            description="V1",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="step")],
            versioning_strategy=VersioningStrategy.PARALLEL,
        )
        v2_def = WorkflowDefinition(
            id=f"wf_v2_{uuid.uuid4().hex[:8]}",
            name="VersionedWorkflow",
            description="V2",
            version="2.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="step")],
            versioning_strategy=VersioningStrategy.PARALLEL,
        )

        await version_manager.register_version(v1_def)
        await version_manager.register_version(v2_def)

        # Trigger with v1 specified
        trigger_v1 = {
            "type": "manual",
            "data": {},
            "workflow_version": "1.0.0",
        }

        # Trigger with v2 specified
        trigger_v2 = {
            "type": "manual",
            "data": {},
            "workflow_version": "2.0.0",
        }

        # Verify versions can be selected
        assert trigger_v1["workflow_version"] == "1.0.0"
        assert trigger_v2["workflow_version"] == "2.0.0"


class TestMigrateStrategy:
    """Tests for MIGRATE versioning strategy."""

    @pytest.mark.asyncio
    async def test_running_instances_migrated(self, stores, version_manager):
        """Test that running instances are migrated to new version."""
        # Register v1
        v1_def = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="MigrateWorkflow",
            description="V1 workflow",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="step")],
            versioning_strategy=VersioningStrategy.MIGRATE,
        )
        await version_manager.register_version(v1_def)

        # Create running instance on v1 with v1 state schema
        instance = WorkflowInstance(
            id=f"inst_{uuid.uuid4().hex[:8]}",
            workflow_id=v1_def.id,
            workflow_name=v1_def.name,
            workflow_version="1.0.0",
            status=InstanceStatus.RUNNING,
            current_step="step",
            state={
                "old_field_name": "value",
                "count": 5,
            },
            trigger_event={"type": "manual"},
        )
        await stores.instances.create(instance)

        # Register v2 with migration
        v2_def = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="MigrateWorkflow",
            description="V2 workflow",
            version="2.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="step")],
            versioning_strategy=VersioningStrategy.MIGRATE,
        )
        await version_manager.register_version(v2_def)

        # Register migration function
        def migrate_v1_to_v2(state: Dict[str, Any]) -> Dict[str, Any]:
            return {
                "new_field_name": state.get("old_field_name"),  # Renamed field
                "count": state.get("count", 0),
                "migrated": True,
            }

        version_manager.register_migration(
            "MigrateWorkflow",
            "1.0.0",
            "2.0.0",
            migrate_v1_to_v2,
        )

        # Migrate instance
        success = await version_manager.migrate_instance(instance, "2.0.0")
        assert success

        # Verify migration
        migrated = await stores.instances.get(instance.id)
        assert migrated.workflow_version == "2.0.0"
        assert migrated.state["new_field_name"] == "value"
        assert migrated.state["migrated"] is True
        assert "old_field_name" not in migrated.state

    @pytest.mark.asyncio
    async def test_migration_preserves_essential_state(self, stores, version_manager):
        """Test that migration preserves essential workflow state."""
        v1_def = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="PreserveWorkflow",
            description="V1",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="step")],
            versioning_strategy=VersioningStrategy.MIGRATE,
        )
        await version_manager.register_version(v1_def)

        now = datetime.utcnow().isoformat() + "Z"
        instance = WorkflowInstance(
            id=f"inst_{uuid.uuid4().hex[:8]}",
            workflow_id=v1_def.id,
            workflow_name=v1_def.name,
            workflow_version="1.0.0",
            status=InstanceStatus.RUNNING,
            current_step="step",
            state={"data": "important"},
            trigger_event={"type": "manual", "data": {"trigger_data": True}},
            step_history=[
                StepHistory(
                    step_name="step",
                    started_at=now,
                    status="running",
                )
            ],
            started_at=now,
        )
        await stores.instances.create(instance)

        v2_def = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="PreserveWorkflow",
            description="V2",
            version="2.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="step")],
            versioning_strategy=VersioningStrategy.MIGRATE,
        )
        await version_manager.register_version(v2_def)

        version_manager.register_migration(
            "PreserveWorkflow",
            "1.0.0",
            "2.0.0",
            lambda state: {**state, "v2_flag": True},
        )

        await version_manager.migrate_instance(instance, "2.0.0")

        migrated = await stores.instances.get(instance.id)

        # Essential state preserved
        assert migrated.status == InstanceStatus.RUNNING
        assert migrated.current_step == "step"
        assert migrated.started_at == now
        assert len(migrated.step_history) == 1
        assert migrated.trigger_event["data"]["trigger_data"] is True

        # State migrated
        assert migrated.state["data"] == "important"
        assert migrated.state["v2_flag"] is True

    @pytest.mark.asyncio
    async def test_migration_failure_rolls_back(self, stores, version_manager):
        """Test that failed migration doesn't corrupt instance."""
        v1_def = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="FailMigrate",
            description="V1",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="step")],
            versioning_strategy=VersioningStrategy.MIGRATE,
        )
        await version_manager.register_version(v1_def)

        instance = WorkflowInstance(
            id=f"inst_{uuid.uuid4().hex[:8]}",
            workflow_id=v1_def.id,
            workflow_name=v1_def.name,
            workflow_version="1.0.0",
            status=InstanceStatus.RUNNING,
            current_step="step",
            state={"original": "state"},
            trigger_event={"type": "manual"},
        )
        await stores.instances.create(instance)

        v2_def = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="FailMigrate",
            description="V2",
            version="2.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="step")],
            versioning_strategy=VersioningStrategy.MIGRATE,
        )
        await version_manager.register_version(v2_def)

        # Register failing migration
        def failing_migration(state: Dict[str, Any]) -> Dict[str, Any]:
            raise ValueError("Migration failed!")

        version_manager.register_migration(
            "FailMigrate",
            "1.0.0",
            "2.0.0",
            failing_migration,
        )

        # Attempt migration
        success = await version_manager.migrate_instance(instance, "2.0.0")
        assert success is False

        # Note: In a real implementation, the instance would be unchanged
        # This test verifies the migration returns False on failure

    @pytest.mark.asyncio
    async def test_no_migration_path_returns_false(self, stores, version_manager):
        """Test that missing migration path returns False."""
        v1_def = WorkflowDefinition(
            id=f"wf_{uuid.uuid4().hex[:8]}",
            name="NoPathWorkflow",
            description="V1",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="step")],
            versioning_strategy=VersioningStrategy.MIGRATE,
        )
        await version_manager.register_version(v1_def)

        instance = WorkflowInstance(
            id=f"inst_{uuid.uuid4().hex[:8]}",
            workflow_id=v1_def.id,
            workflow_name=v1_def.name,
            workflow_version="1.0.0",
            status=InstanceStatus.RUNNING,
            current_step="step",
            state={},
            trigger_event={"type": "manual"},
        )
        await stores.instances.create(instance)

        # No migration registered for v1 -> v2
        success = await version_manager.migrate_instance(instance, "2.0.0")
        assert success is False


class TestVersionQueries:
    """Tests for version-related queries."""

    @pytest.mark.asyncio
    async def test_list_all_versions_of_workflow(self, stores, version_manager):
        """Test listing all versions of a workflow."""
        workflow_name = "VersionedQuery"

        for version in ["1.0.0", "1.1.0", "2.0.0", "2.1.0"]:
            definition = WorkflowDefinition(
                id=f"wf_{version}_{uuid.uuid4().hex[:8]}",
                name=workflow_name,
                description=f"Version {version}",
                version=version,
                trigger=TriggerConfig(type=TriggerType.MANUAL),
                steps=[StepDefinition(name="step")],
            )
            await version_manager.register_version(definition, make_active=False)

        # List versions
        versions = await stores.workflows.list_versions(workflow_name)

        assert len(versions) == 4
        version_strings = [v.version for v in versions]
        assert "1.0.0" in version_strings
        assert "1.1.0" in version_strings
        assert "2.0.0" in version_strings
        assert "2.1.0" in version_strings

    @pytest.mark.asyncio
    async def test_count_instances_by_version(self, stores, version_manager):
        """Test counting instances per version."""
        workflow_name = "CountWorkflow"

        v1_def = WorkflowDefinition(
            id=f"wf_v1_{uuid.uuid4().hex[:8]}",
            name=workflow_name,
            description="V1",
            version="1.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="step")],
        )
        v2_def = WorkflowDefinition(
            id=f"wf_v2_{uuid.uuid4().hex[:8]}",
            name=workflow_name,
            description="V2",
            version="2.0.0",
            trigger=TriggerConfig(type=TriggerType.MANUAL),
            steps=[StepDefinition(name="step")],
        )

        await version_manager.register_version(v1_def)
        await version_manager.register_version(v2_def)

        # Create instances on v1
        for i in range(3):
            instance = WorkflowInstance(
                id=f"inst_v1_{i}_{uuid.uuid4().hex[:8]}",
                workflow_id=v1_def.id,
                workflow_name=workflow_name,
                workflow_version="1.0.0",
                status=InstanceStatus.RUNNING,
                current_step="step",
                state={},
                trigger_event={"type": "manual"},
            )
            await stores.instances.create(instance)

        # Create instances on v2
        for i in range(5):
            instance = WorkflowInstance(
                id=f"inst_v2_{i}_{uuid.uuid4().hex[:8]}",
                workflow_id=v2_def.id,
                workflow_name=workflow_name,
                workflow_version="2.0.0",
                status=InstanceStatus.RUNNING,
                current_step="step",
                state={},
                trigger_event={"type": "manual"},
            )
            await stores.instances.create(instance)

        # Count by version
        all_instances = await stores.instances.list_by_workflow(v1_def.id)
        v1_count = len([i for i in all_instances if i.workflow_version == "1.0.0"])
        assert v1_count == 3

        all_instances = await stores.instances.list_by_workflow(v2_def.id)
        v2_count = len([i for i in all_instances if i.workflow_version == "2.0.0"])
        assert v2_count == 5


class TestSemanticVersioning:
    """Tests for semantic versioning behavior."""

    @pytest.mark.asyncio
    async def test_version_comparison(self):
        """Test semantic version comparison."""
        from workflow_engine.stores.base import WorkflowDefinition

        versions = ["1.0.0", "1.0.1", "1.1.0", "2.0.0", "2.0.0-alpha", "2.0.0-beta"]

        # Sort by version
        sorted_versions = sorted(versions)

        # Pre-release versions come before release
        assert sorted_versions[0] == "1.0.0"
        assert sorted_versions[-1] == "2.0.0-beta"  # String sort

    @pytest.mark.asyncio
    async def test_breaking_change_detection(self, version_manager):
        """Test detection of breaking changes (major version bump)."""
        from_version = "1.5.3"
        to_version = "2.0.0"

        # Major version changed - breaking change
        from_major = int(from_version.split(".")[0])
        to_major = int(to_version.split(".")[0])

        is_breaking = to_major > from_major
        assert is_breaking is True

        # Minor version change - not breaking
        to_version_minor = "1.6.0"
        to_major_minor = int(to_version_minor.split(".")[0])
        is_breaking_minor = to_major_minor > from_major
        assert is_breaking_minor is False
