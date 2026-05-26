"""
Workflow and Step definition classes.

This module defines the core classes that represent workflow and step definitions.
These classes are populated by the decorators and used by the engine to execute workflows.
"""

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Type, TYPE_CHECKING

from .types import (
    BackoffStrategy,
    ParallelConfig,
    RetryConfig,
    RuntimeType,
    StepMetadata,
    TriggerConfig,
    TriggerType,
    VersioningStrategy,
    WaitForConfig,
    WorkflowMetadata,
)
from .errors import WorkflowDefinitionError, StepDefinitionError

if TYPE_CHECKING:
    from .registry import WorkflowRegistry


# Attribute name for storing workflow metadata on classes
WORKFLOW_META_ATTR = "__workflow_meta__"

# Attribute name for storing step metadata on methods
STEP_META_ATTR = "__step_meta__"


# =============================================================================
# Step Definition
# =============================================================================


@dataclass
class StepDefinition:
    """
    Definition of a single workflow step.

    This class holds all the information about a step, including:
    - The method that implements the step
    - Configuration from decorators (@wait_for, @retry, @parallel)
    - Step metadata (name, description, etc.)

    StepDefinition is created by the @step decorator and stored
    on the method as __step_meta__.
    """

    name: str
    """Step name (method name by default)."""

    method: Callable[..., Any]
    """The actual step method."""

    # Decorator configurations
    wait_for: Optional[WaitForConfig] = None
    """Configuration from @wait_for decorator."""

    retry: Optional[RetryConfig] = None
    """Configuration from @retry decorator."""

    parallel: Optional[ParallelConfig] = None
    """Configuration from @parallel decorator."""

    # Metadata
    is_entry_point: bool = False
    """If True, this step can be the first step in the workflow."""

    description: Optional[str] = None
    """Human-readable description from docstring."""

    accepts_event: bool = False
    """If True, step method accepts an 'event' parameter."""

    @classmethod
    def from_method(cls, method: Callable[..., Any]) -> "StepDefinition":
        """
        Create a StepDefinition from a method with step metadata.

        Args:
            method: Method decorated with @step

        Returns:
            StepDefinition populated from method metadata

        Raises:
            StepDefinitionError: If method is not properly decorated
        """
        meta: Optional[StepMetadata] = getattr(method, STEP_META_ATTR, None)
        if meta is None:
            raise StepDefinitionError(
                f"Method '{method.__name__}' is not decorated with @step"
            )

        # Check if method accepts 'event' parameter by inspecting signature
        import inspect
        sig = inspect.signature(method)
        params = list(sig.parameters.keys())
        # Remove 'self' from params
        if params and params[0] == 'self':
            params = params[1:]
        accepts_event = 'event' in params

        return cls(
            name=meta.name,
            method=method,
            wait_for=meta.wait_for,
            retry=meta.retry,
            parallel=meta.parallel,
            is_entry_point=meta.is_entry_point,
            description=meta.description or method.__doc__,
            accepts_event=accepts_event,
        )

    def to_metadata(self) -> StepMetadata:
        """Convert to StepMetadata."""
        return StepMetadata(
            name=self.name,
            wait_for=self.wait_for,
            retry=self.retry,
            parallel=self.parallel,
            is_entry_point=self.is_entry_point,
            description=self.description,
        )

    @property
    def triggers_promotion(self) -> bool:
        """
        Check if this step triggers auto-promotion to cloud.

        Returns True if the step has @wait_for with a timeout.
        """
        return self.wait_for is not None and self.wait_for.timeout is not None

    @property
    def has_retry(self) -> bool:
        """Check if this step has retry configuration."""
        return self.retry is not None

    @property
    def has_parallel(self) -> bool:
        """Check if this step has parallel configuration."""
        return self.parallel is not None


# =============================================================================
# Workflow Definition
# =============================================================================


@dataclass
class WorkflowDefinition:
    """
    Complete definition of a workflow.

    This class holds all the information about a workflow, including:
    - The class that implements the workflow
    - Trigger configuration from @workflow decorator
    - All step definitions
    - Runtime and versioning configuration

    WorkflowDefinition is created by the @workflow decorator and stored
    on the class as __workflow_meta__.
    """

    # Identity
    workflow_id: str
    """Unique identifier (usually class name)."""

    workflow_class: Type[Any]
    """The workflow class."""

    name: str
    """Human-readable name."""

    description: Optional[str] = None
    """Description from docstring."""

    # Trigger configuration
    trigger_type: TriggerType = TriggerType.MANUAL
    """Type of trigger that starts this workflow."""

    trigger_config: TriggerConfig = None
    """Configuration specific to the trigger type."""

    # Runtime configuration
    runtime: RuntimeType = RuntimeType.AUTO
    """Where the workflow executes."""

    idempotency_key: Optional[str] = None
    """Expression to compute idempotency key from event."""

    # Versioning
    version: str = "1.0.0"
    """Semantic version."""

    versioning_strategy: VersioningStrategy = VersioningStrategy.REPLACE
    """How to handle version changes."""

    # Steps
    steps: Dict[str, StepDefinition] = field(default_factory=dict)
    """All step definitions, keyed by name."""

    entry_point: Optional[str] = None
    """Name of the first step to execute."""

    @classmethod
    def from_class(cls, workflow_class: Type[Any]) -> "WorkflowDefinition":
        """
        Create a WorkflowDefinition from a class with workflow metadata.

        This method:
        1. Extracts workflow metadata from the class
        2. Discovers all step methods
        3. Builds step definitions
        4. Validates the workflow

        Args:
            workflow_class: Class decorated with @workflow

        Returns:
            WorkflowDefinition populated from class

        Raises:
            WorkflowDefinitionError: If class is not properly decorated or invalid
        """
        meta: Optional[WorkflowMetadata] = getattr(workflow_class, WORKFLOW_META_ATTR, None)
        if meta is None:
            raise WorkflowDefinitionError(
                f"Class '{workflow_class.__name__}' is not decorated with @workflow"
            )

        # Discover steps
        steps: Dict[str, StepDefinition] = {}
        entry_point: Optional[str] = None

        for attr_name in dir(workflow_class):
            if attr_name.startswith('_'):
                continue

            attr = getattr(workflow_class, attr_name, None)
            if attr is None:
                continue

            # Check if it's a step
            if hasattr(attr, STEP_META_ATTR):
                step_def = StepDefinition.from_method(attr)
                steps[step_def.name] = step_def

                # Find entry point
                if step_def.is_entry_point:
                    if entry_point is not None:
                        raise WorkflowDefinitionError(
                            f"Workflow '{workflow_class.__name__}' has multiple entry points: "
                            f"'{entry_point}' and '{step_def.name}'"
                        )
                    entry_point = step_def.name

        # If no explicit entry point, look for common names
        if entry_point is None:
            for name in ['start', 'begin', 'run', 'execute', 'handle']:
                if name in steps:
                    entry_point = name
                    break

        # If still no entry point, use the first step (alphabetically)
        if entry_point is None and steps:
            entry_point = min(steps.keys())

        definition = cls(
            workflow_id=workflow_class.__name__,
            workflow_class=workflow_class,
            name=meta.name or workflow_class.__name__,
            description=meta.description or workflow_class.__doc__,
            trigger_type=meta.trigger_type,
            trigger_config=meta.trigger_config,
            runtime=meta.runtime,
            idempotency_key=meta.idempotency_key,
            version=meta.version,
            versioning_strategy=meta.versioning_strategy,
            steps=steps,
            entry_point=entry_point,
        )

        # Validate
        definition.validate()

        return definition

    def validate(self) -> None:
        """
        Validate the workflow definition.

        Raises:
            WorkflowDefinitionError: If the workflow is invalid
        """
        # Must have at least one step
        if not self.steps:
            raise WorkflowDefinitionError(
                f"Workflow '{self.workflow_id}' has no steps defined"
            )

        # Must have an entry point
        if self.entry_point is None:
            raise WorkflowDefinitionError(
                f"Workflow '{self.workflow_id}' has no entry point step"
            )

        # Entry point must exist
        if self.entry_point not in self.steps:
            raise WorkflowDefinitionError(
                f"Entry point '{self.entry_point}' not found in workflow '{self.workflow_id}'"
            )

        # Validate trigger configuration
        self._validate_trigger()

        # Validate runtime/trigger compatibility
        self._validate_runtime()

    def _validate_trigger(self) -> None:
        """Validate trigger configuration."""
        from .types import (
            RecordTriggerConfig,
            CellTriggerConfig,
            ScheduleTriggerConfig,
            WebhookTriggerConfig,
        )

        trigger_type = self.trigger_type

        # Record triggers require table
        if trigger_type in (
            TriggerType.RECORD_CREATED,
            TriggerType.RECORD_UPDATED,
            TriggerType.RECORD_DELETED,
        ):
            if not isinstance(self.trigger_config, RecordTriggerConfig):
                raise WorkflowDefinitionError(
                    f"Trigger '{trigger_type.value}' requires 'table' parameter"
                )
            if not self.trigger_config.table:
                raise WorkflowDefinitionError(
                    f"Trigger '{trigger_type.value}' requires 'table' parameter"
                )

        # Cell triggers require sheet
        elif trigger_type == TriggerType.CELL_CHANGED:
            if not isinstance(self.trigger_config, CellTriggerConfig):
                raise WorkflowDefinitionError(
                    f"Trigger '{trigger_type.value}' requires 'sheet' parameter"
                )
            if not self.trigger_config.sheet:
                raise WorkflowDefinitionError(
                    f"Trigger '{trigger_type.value}' requires 'sheet' parameter"
                )

        # Schedule triggers require cron
        elif trigger_type == TriggerType.SCHEDULE:
            if not isinstance(self.trigger_config, ScheduleTriggerConfig):
                raise WorkflowDefinitionError(
                    f"Trigger '{trigger_type.value}' requires 'cron' parameter"
                )
            if not self.trigger_config.cron:
                raise WorkflowDefinitionError(
                    f"Trigger '{trigger_type.value}' requires 'cron' parameter"
                )

        # Webhook triggers require path
        elif trigger_type == TriggerType.WEBHOOK:
            if not isinstance(self.trigger_config, WebhookTriggerConfig):
                raise WorkflowDefinitionError(
                    f"Trigger '{trigger_type.value}' requires 'path' parameter"
                )
            if not self.trigger_config.path:
                raise WorkflowDefinitionError(
                    f"Trigger '{trigger_type.value}' requires 'path' parameter"
                )

    def _validate_runtime(self) -> None:
        """Validate runtime/trigger compatibility."""
        # Schedule and webhook triggers are cloud-only
        if self.trigger_type in (TriggerType.SCHEDULE, TriggerType.WEBHOOK):
            if self.runtime == RuntimeType.LOCAL:
                raise WorkflowDefinitionError(
                    f"Trigger '{self.trigger_type.value}' requires runtime='cloud' or runtime='auto', "
                    f"not runtime='local'"
                )

    def get_step(self, name: str) -> Optional[StepDefinition]:
        """Get a step definition by name."""
        return self.steps.get(name)

    def get_entry_step(self) -> Optional[StepDefinition]:
        """Get the entry point step."""
        if self.entry_point:
            return self.steps.get(self.entry_point)
        return None

    def to_metadata(self) -> WorkflowMetadata:
        """Convert to WorkflowMetadata."""
        return WorkflowMetadata(
            trigger_type=self.trigger_type,
            trigger_config=self.trigger_config,
            runtime=self.runtime,
            idempotency_key=self.idempotency_key,
            version=self.version,
            versioning_strategy=self.versioning_strategy,
            name=self.name,
            description=self.description,
        )

    def to_dict(self) -> Dict[str, Any]:
        """
        Convert to dictionary for serialization.

        Returns:
            Dictionary representation of the workflow definition
        """
        return {
            "workflow_id": self.workflow_id,
            "name": self.name,
            "description": self.description,
            "trigger_type": self.trigger_type.value,
            "runtime": self.runtime.value,
            "version": self.version,
            "versioning_strategy": self.versioning_strategy.value,
            "idempotency_key": self.idempotency_key,
            "entry_point": self.entry_point,
            "steps": {
                name: {
                    "name": step.name,
                    "description": step.description,
                    "has_wait_for": step.wait_for is not None,
                    "has_retry": step.has_retry,
                    "has_parallel": step.has_parallel,
                    "triggers_promotion": step.triggers_promotion,
                    "accepts_event": step.accepts_event,
                }
                for name, step in self.steps.items()
            },
        }


# =============================================================================
# Step Transition
# =============================================================================


@dataclass
class StepTransition:
    """
    Represents a transition from one step to another.

    Step methods return StepTransition objects to indicate what to do next:
    - Transition to another step: return self.next_step()
    - Complete the workflow: return self.complete()
    - Wait for events: automatic when @wait_for is used
    """

    transition_type: str
    """Type of transition: "step", "complete", "wait", "parallel"."""

    next_step: Optional[str] = None
    """Name of the next step (for "step" transitions)."""

    result: Any = None
    """Result value to pass to the next step."""

    # For parallel transitions
    parallel_items: Optional[List[Any]] = None
    """Items to process in parallel."""

    # For wait transitions
    wait_events: Optional[List[str]] = None
    """Events to wait for."""

    @classmethod
    def to_step(cls, step_name: str, result: Any = None) -> "StepTransition":
        """Create a transition to another step."""
        return cls(
            transition_type="step",
            next_step=step_name,
            result=result,
        )

    @classmethod
    def complete(cls, result: Any = None) -> "StepTransition":
        """Create a completion transition."""
        return cls(
            transition_type="complete",
            result=result,
        )

    @classmethod
    def wait(cls, events: List[str]) -> "StepTransition":
        """Create a wait transition."""
        return cls(
            transition_type="wait",
            wait_events=events,
        )

    @classmethod
    def parallel(cls, items: List[Any], next_step: str) -> "StepTransition":
        """Create a parallel execution transition."""
        return cls(
            transition_type="parallel",
            parallel_items=items,
            next_step=next_step,
        )

    @property
    def is_terminal(self) -> bool:
        """Check if this is a terminal transition (complete or wait)."""
        return self.transition_type in ("complete", "wait")


# =============================================================================
# Workflow Instance Helper (for self.* methods)
# =============================================================================


class WorkflowInstanceHelper:
    """
    Mixin class providing helper methods for workflow instances.

    This class provides the self.next_step(), self.complete(), etc.
    methods that step methods use to indicate transitions.

    Workflow classes automatically get these methods via the @workflow decorator.
    """

    # These will be set by the engine when executing
    _current_step: Optional[str] = None
    _workflow_definition: Optional[WorkflowDefinition] = None

    def complete(self, result: Any = None) -> StepTransition:
        """
        Complete the workflow.

        Args:
            result: Optional result value

        Returns:
            StepTransition indicating completion
        """
        return StepTransition.complete(result)

    def __getattr__(self, name: str) -> Any:
        """
        Handle attribute access for step transitions.

        When a step method calls self.some_step(), we return a callable
        that creates a StepTransition.
        """
        # Check if this is a step method
        if self._workflow_definition is not None:
            if name in self._workflow_definition.steps:
                # Return a function that creates a transition
                def transition_to_step(result: Any = None) -> StepTransition:
                    return StepTransition.to_step(name, result)
                return transition_to_step

        # Normal attribute error
        raise AttributeError(f"'{type(self).__name__}' object has no attribute '{name}'")
