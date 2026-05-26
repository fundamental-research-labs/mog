"""
Step Executor - Execute workflow steps and handle transitions.

The StepExecutor is responsible for:
- Executing a single step method with the workflow context
- Handling step return values (transition to next step)
- Catching and classifying errors (Retryable vs NonRetryable)
- Respecting @retry decorator settings
- Extracting instance state from workflow object
- Supporting @wait_for decorated steps
- Supporting @parallel decorated steps

Design Principles:
- Each step execution is atomic (runs to completion or fails)
- Step returns indicate transition to next step
- Errors are classified to determine retry behavior
- Instance state is extracted after each step for persistence

Usage:
    executor = StepExecutor(workflow_store)

    # Execute a step
    result = await executor.execute_step(
        instance=instance,
        workflow_obj=workflow_instance_object,
        context=ctx,
        event=event,  # For @wait_for steps receiving an event
    )

    # result.success -> step completed
    # result.next_step -> where to transition
    # result.should_retry -> should retry on failure
"""

from __future__ import annotations

import asyncio
import inspect
import logging
import traceback
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, List, Optional, Type, Union

from .types import (
    BackoffStrategy,
    EventPayload,
    NonRetryableError,
    RetryableError,
    RetryConfig,
    StepDefinition,
    StepExecution,
    StepResult,
    StepStatus,
    StepTransitionError,
    WorkflowDefinition,
    WorkflowDefinitionError,
    WorkflowError,
    WorkflowInstance,
    WorkflowStore,
)


logger = logging.getLogger(__name__)


class StepExecutor:
    """
    Executes workflow steps and manages transitions.

    The StepExecutor handles the mechanics of running step methods:
    - Loading workflow class and instantiating with current state
    - Calling the step method with appropriate arguments
    - Handling special return values (transition markers)
    - Catching and classifying errors
    - Computing retry delays

    Attributes:
        workflow_store: Storage for workflow definitions
        workflow_classes: Registry of workflow class -> definition
    """

    # Sentinel value for step completion (workflow.complete())
    COMPLETED = object()

    def __init__(
        self,
        workflow_store: WorkflowStore,
        workflow_registry: Optional[Dict[str, Type[Any]]] = None,
    ):
        """
        Initialize the StepExecutor.

        Args:
            workflow_store: Storage for workflow definitions
            workflow_registry: Optional dict mapping workflow_id -> workflow class
                             If not provided, classes must be loaded dynamically
        """
        self.workflow_store = workflow_store
        self.workflow_registry: Dict[str, Type[Any]] = workflow_registry or {}

    def register_workflow(
        self,
        workflow_id: str,
        workflow_class: Type[Any],
    ) -> None:
        """
        Register a workflow class for execution.

        Args:
            workflow_id: The workflow definition ID
            workflow_class: The Python class implementing the workflow
        """
        self.workflow_registry[workflow_id] = workflow_class
        logger.debug(f"Registered workflow class for {workflow_id}")

    # =========================================================================
    # Step Execution
    # =========================================================================

    async def execute_step(
        self,
        instance: WorkflowInstance,
        context: Any,  # WorkflowContext
        event: Optional[EventPayload] = None,
        parallel_item: Optional[Any] = None,
    ) -> StepResult:
        """
        Execute the current step of a workflow instance.

        This is the core execution method. It:
        1. Loads the workflow definition
        2. Instantiates the workflow class with current state
        3. Calls the step method
        4. Handles return value (transition or completion)
        5. Extracts updated state from workflow object
        6. Handles and classifies any errors

        Args:
            instance: The workflow instance to execute
            context: The WorkflowContext providing APIs to the step
            event: Optional event payload for @wait_for steps
            parallel_item: Optional item for @parallel step iteration

        Returns:
            StepResult indicating success/failure and next action
        """
        step_name = instance.current_step

        # Load workflow definition
        definition = await self.workflow_store.get(
            instance.workflow_id,
            instance.workflow_version,
        )
        if definition is None:
            return StepResult(
                success=False,
                error=f"Workflow definition not found: {instance.workflow_id}",
                error_type="WorkflowDefinitionError",
                should_retry=False,
            )

        # Get step definition
        step_def = definition.steps.get(step_name)
        if step_def is None:
            return StepResult(
                success=False,
                error=f"Step not found in definition: {step_name}",
                error_type="StepTransitionError",
                should_retry=False,
            )

        # Get workflow class
        workflow_class = self.workflow_registry.get(instance.workflow_id)
        if workflow_class is None:
            return StepResult(
                success=False,
                error=f"Workflow class not registered: {instance.workflow_id}",
                error_type="WorkflowDefinitionError",
                should_retry=False,
            )

        try:
            # Create workflow instance with restored state
            workflow_obj = self._create_workflow_object(
                workflow_class,
                instance.instance_state,
            )

            # Get the step method
            step_method = getattr(workflow_obj, step_name, None)
            if step_method is None:
                return StepResult(
                    success=False,
                    error=f"Step method not found: {step_name}",
                    error_type="WorkflowDefinitionError",
                    should_retry=False,
                )

            # Execute the step
            result = await self._call_step_method(
                workflow_obj=workflow_obj,
                step_method=step_method,
                step_def=step_def,
                context=context,
                event=event,
                parallel_item=parallel_item,
                trigger_event=instance.trigger_event,
            )

            # Extract updated state from workflow object
            new_state = self._extract_instance_state(workflow_obj)

            # Update instance state (will be persisted by caller)
            instance.instance_state.update(new_state)

            # Handle step return value
            return self._process_step_result(
                result=result,
                step_def=step_def,
                definition=definition,
            )

        except RetryableError as e:
            logger.warning(
                f"Retryable error in step {step_name}: {e.message}",
                extra={"instance_id": instance.instance_id},
            )
            return self._handle_retryable_error(e, step_def)

        except NonRetryableError as e:
            logger.error(
                f"Non-retryable error in step {step_name}: {e.message}",
                extra={"instance_id": instance.instance_id},
            )
            return StepResult(
                success=False,
                error=e.message,
                error_type="NonRetryableError",
                should_retry=False,
            )

        except Exception as e:
            # Unexpected error - treat as retryable by default
            logger.exception(
                f"Unexpected error in step {step_name}",
                extra={"instance_id": instance.instance_id},
            )
            return self._handle_unexpected_error(e, step_def)

    async def execute_parallel_step(
        self,
        instance: WorkflowInstance,
        context: Any,
        items: List[Any],
        max_concurrency: int = 10,
    ) -> StepResult:
        """
        Execute a @parallel decorated step for multiple items.

        Runs the step for each item with controlled concurrency.
        Collects all results and returns them.

        Args:
            instance: The workflow instance
            context: The WorkflowContext
            items: List of items to process in parallel
            max_concurrency: Maximum concurrent executions

        Returns:
            StepResult with output containing list of per-item results
        """
        step_name = instance.current_step

        # Load definition to get step config
        definition = await self.workflow_store.get(
            instance.workflow_id,
            instance.workflow_version,
        )
        if definition is None:
            return StepResult(
                success=False,
                error=f"Workflow definition not found: {instance.workflow_id}",
                error_type="WorkflowDefinitionError",
                should_retry=False,
            )

        step_def = definition.steps.get(step_name)
        if step_def is None or not step_def.is_parallel:
            return StepResult(
                success=False,
                error=f"Step {step_name} is not a parallel step",
                error_type="WorkflowDefinitionError",
                should_retry=False,
            )

        # Use semaphore to limit concurrency
        semaphore = asyncio.Semaphore(max_concurrency)
        results: List[Any] = []
        errors: List[str] = []

        async def process_item(item: Any, index: int) -> tuple[int, Any, Optional[str]]:
            async with semaphore:
                result = await self.execute_step(
                    instance=instance,
                    context=context,
                    parallel_item=item,
                )
                if result.success:
                    return (index, result.output, None)
                else:
                    return (index, None, result.error)

        # Execute all items
        tasks = [
            process_item(item, i)
            for i, item in enumerate(items)
        ]

        completed = await asyncio.gather(*tasks, return_exceptions=True)

        # Collect results in order
        ordered_results: List[Any] = [None] * len(items)
        any_errors = False

        for result in completed:
            if isinstance(result, Exception):
                any_errors = True
                errors.append(str(result))
            else:
                index, output, error = result
                if error:
                    any_errors = True
                    errors.append(error)
                ordered_results[index] = output

        if any_errors:
            # At least one item failed
            return StepResult(
                success=False,
                error=f"Parallel execution failed: {'; '.join(errors[:5])}",
                error_type="ParallelExecutionError",
                should_retry=True,  # Could retry failed items
                output=ordered_results,
            )

        return StepResult(
            success=True,
            output=ordered_results,
            # Next step determined by process_step_result on the collecting step
        )

    # =========================================================================
    # Step Method Invocation
    # =========================================================================

    async def _call_step_method(
        self,
        workflow_obj: Any,
        step_method: Callable[..., Any],
        step_def: StepDefinition,
        context: Any,
        event: Optional[EventPayload],
        parallel_item: Optional[Any],
        trigger_event: Dict[str, Any],
    ) -> Any:
        """
        Call the step method with appropriate arguments.

        Steps can have different signatures:
        - start(self, event, ctx) - Initial step receives trigger event
        - step(self, ctx) - Normal step
        - wait_step(self, event, ctx) - @wait_for step receives resumed event
        - parallel_step(self, ctx, item) - @parallel iteration step

        Args:
            workflow_obj: The instantiated workflow object
            step_method: The method to call
            step_def: Step definition with metadata
            context: The workflow context
            event: Event that resumed this step (for @wait_for)
            parallel_item: Item to process (for @parallel)
            trigger_event: Original trigger event

        Returns:
            Whatever the step method returns
        """
        # Inspect the method signature
        sig = inspect.signature(step_method)
        params = list(sig.parameters.keys())

        # Build argument dict based on signature
        kwargs: Dict[str, Any] = {}

        # Remove 'self' from consideration
        if params and params[0] == "self":
            params = params[1:]

        # Determine which arguments to pass
        for param in params:
            if param == "ctx" or param == "context":
                kwargs[param] = context
            elif param == "event":
                # For start step, pass trigger event
                # For @wait_for step, pass the resume event
                if event is not None:
                    kwargs[param] = event
                elif step_def.name == "start":
                    kwargs[param] = EventPayload.from_dict(trigger_event)
                else:
                    kwargs[param] = None
            elif param == "item":
                kwargs[param] = parallel_item

        # Call the method
        result = step_method(**kwargs)

        # Handle async methods
        if asyncio.iscoroutine(result):
            result = await result

        return result

    # =========================================================================
    # State Management
    # =========================================================================

    def _create_workflow_object(
        self,
        workflow_class: Type[Any],
        instance_state: Dict[str, Any],
    ) -> Any:
        """
        Create workflow object and restore its state.

        Args:
            workflow_class: The workflow class
            instance_state: Dict of instance variable values

        Returns:
            Instantiated workflow object with state restored
        """
        # Create instance
        obj = workflow_class()

        # Restore state
        for key, value in instance_state.items():
            setattr(obj, key, value)

        return obj

    def _extract_instance_state(self, workflow_obj: Any) -> Dict[str, Any]:
        """
        Extract JSON-serializable state from workflow object.

        This captures the user's `self.x` variables for persistence.
        Only captures instance variables that are JSON-serializable.

        Args:
            workflow_obj: The workflow object after step execution

        Returns:
            Dict of instance variable name -> value
        """
        state: Dict[str, Any] = {}

        # Get instance __dict__ (user-defined instance variables)
        for key, value in workflow_obj.__dict__.items():
            # Skip private/internal attributes
            if key.startswith("_"):
                continue

            # Check if value is JSON-serializable
            if self._is_json_serializable(value):
                state[key] = value
            else:
                logger.warning(
                    f"Skipping non-serializable instance variable: {key}={type(value)}"
                )

        return state

    def _is_json_serializable(self, value: Any) -> bool:
        """Check if a value is JSON-serializable."""
        if value is None:
            return True
        if isinstance(value, (str, int, float, bool)):
            return True
        if isinstance(value, (list, tuple)):
            return all(self._is_json_serializable(item) for item in value)
        if isinstance(value, dict):
            return all(
                isinstance(k, str) and self._is_json_serializable(v)
                for k, v in value.items()
            )
        return False

    # =========================================================================
    # Result Processing
    # =========================================================================

    def _process_step_result(
        self,
        result: Any,
        step_def: StepDefinition,
        definition: WorkflowDefinition,
    ) -> StepResult:
        """
        Process the return value of a step method.

        Step methods return:
        - self.next_step() -> Transition to named step
        - self.complete() -> Workflow completed
        - None -> Stay on current step (for @wait_for)
        - List of self.sub_step(item) -> Parallel results to collect

        Args:
            result: Return value from step method
            step_def: Step definition
            definition: Workflow definition

        Returns:
            StepResult indicating next action
        """
        # Handle completion
        if result is self.COMPLETED or result is None and step_def.wait_for_events:
            # For @wait_for steps, None means "waiting"
            if step_def.wait_for_events:
                return StepResult(
                    success=True,
                    wait_for_events=step_def.wait_for_events,
                    wait_timeout=step_def.wait_timeout,
                )
            else:
                return StepResult(
                    success=True,
                    next_step=None,  # Completed
                )

        # Handle step transition
        if isinstance(result, StepTransition):
            next_step = result.target_step

            # Validate step exists
            if next_step not in definition.steps:
                return StepResult(
                    success=False,
                    error=f"Invalid step transition: {next_step} not found",
                    error_type="StepTransitionError",
                    should_retry=False,
                )

            return StepResult(
                success=True,
                next_step=next_step,
            )

        # Handle method reference (self.next_step is a method)
        if callable(result) and hasattr(result, "__name__"):
            next_step = result.__name__

            if next_step not in definition.steps:
                return StepResult(
                    success=False,
                    error=f"Invalid step transition: {next_step} not found",
                    error_type="StepTransitionError",
                    should_retry=False,
                )

            return StepResult(
                success=True,
                next_step=next_step,
            )

        # Handle parallel results (list of outputs)
        if isinstance(result, list) and step_def.is_parallel:
            return StepResult(
                success=True,
                output=result,
            )

        # Handle None return (implicit continuation or completion)
        if result is None:
            # If not a @wait_for step, treat as completion
            return StepResult(
                success=True,
                next_step=None,  # Completed
            )

        # Unknown return type - try to use it as step name string
        if isinstance(result, str):
            if result in definition.steps:
                return StepResult(
                    success=True,
                    next_step=result,
                )
            else:
                return StepResult(
                    success=False,
                    error=f"Invalid step name returned: {result}",
                    error_type="StepTransitionError",
                    should_retry=False,
                )

        # Unexpected return type
        return StepResult(
            success=False,
            error=f"Unexpected step return type: {type(result)}",
            error_type="StepTransitionError",
            should_retry=False,
        )

    # =========================================================================
    # Error Handling
    # =========================================================================

    def _handle_retryable_error(
        self,
        error: RetryableError,
        step_def: StepDefinition,
    ) -> StepResult:
        """
        Handle a retryable error from step execution.

        Args:
            error: The RetryableError raised
            step_def: Step definition with retry config

        Returns:
            StepResult with retry info
        """
        retry_config = step_def.retry_config

        if retry_config is None:
            # No retry configured - fail
            return StepResult(
                success=False,
                error=error.message,
                error_type="RetryableError",
                should_retry=False,
            )

        return StepResult(
            success=False,
            error=error.message,
            error_type="RetryableError",
            should_retry=True,
            retry_delay=retry_config.initial_delay,  # Actual delay computed by retry_handler
        )

    def _handle_unexpected_error(
        self,
        error: Exception,
        step_def: StepDefinition,
    ) -> StepResult:
        """
        Handle an unexpected (non-workflow) error.

        By default, unexpected errors are treated as retryable
        since they might be transient (network, resource limits, etc.).

        Args:
            error: The exception raised
            step_def: Step definition with retry config

        Returns:
            StepResult with retry info
        """
        error_message = f"{type(error).__name__}: {str(error)}"
        error_traceback = traceback.format_exc()

        logger.error(f"Unexpected error: {error_message}\n{error_traceback}")

        retry_config = step_def.retry_config

        # Determine if we should retry
        should_retry = retry_config is not None

        return StepResult(
            success=False,
            error=error_message,
            error_type=type(error).__name__,
            should_retry=should_retry,
            retry_delay=retry_config.initial_delay if retry_config else None,
        )

    # =========================================================================
    # Step Execution Records
    # =========================================================================

    def create_step_execution(
        self,
        step_name: str,
        attempt: int = 1,
    ) -> StepExecution:
        """
        Create a new StepExecution record for tracking.

        Args:
            step_name: Name of the step
            attempt: Attempt number (1-indexed)

        Returns:
            New StepExecution in RUNNING status
        """
        return StepExecution(
            step_name=step_name,
            status=StepStatus.RUNNING,
            attempt=attempt,
            started_at=datetime.utcnow(),
        )

    def complete_step_execution(
        self,
        execution: StepExecution,
        result: StepResult,
    ) -> StepExecution:
        """
        Update step execution with result.

        Args:
            execution: The execution record
            result: Result from execute_step

        Returns:
            Updated StepExecution
        """
        execution.completed_at = datetime.utcnow()

        if result.success:
            execution.status = StepStatus.COMPLETED
            execution.result = result.next_step or "completed"
        elif result.should_retry:
            execution.status = StepStatus.RETRYING
            execution.error = result.error
            execution.error_type = result.error_type
        else:
            execution.status = StepStatus.FAILED
            execution.error = result.error
            execution.error_type = result.error_type

        return execution


class StepTransition:
    """
    Marker class for step transitions.

    Returned by workflow methods like self.next_step() to indicate
    which step to transition to.
    """

    def __init__(self, target_step: str):
        self.target_step = target_step

    def __repr__(self) -> str:
        return f"StepTransition({self.target_step})"


class WorkflowBase:
    """
    Base class for user workflows.

    Provides helper methods for step transitions and completion.
    Users extend this class to define their workflows:

        class MyWorkflow(WorkflowBase):
            @step
            def start(self, event, ctx):
                self.data = event.data
                return self.process()

            @step
            def process(self, ctx):
                # Do work
                return self.complete()
    """

    def complete(self) -> object:
        """
        Mark workflow as completed.

        Returns:
            Sentinel value indicating completion
        """
        return StepExecutor.COMPLETED

    def __getattribute__(self, name: str) -> Any:
        """
        Enable returning method references as transitions.

        When a step method returns `self.next_step` (without calling it),
        we intercept and create a StepTransition.
        """
        attr = super().__getattribute__(name)

        # If it's a method decorated as @step, wrap it to support
        # being returned without calling
        if callable(attr) and hasattr(attr, "_is_step"):
            # Return a callable that creates StepTransition when called with no args
            # but returns itself when introspected
            return _TransitionableMethod(attr, name)

        return attr


class _TransitionableMethod:
    """
    Wrapper that allows step methods to be returned without calling.

    Supports two usage patterns:
    - return self.next_step()  -> Calls method, returns its result
    - return self.next_step    -> Returns StepTransition marker
    """

    def __init__(self, method: Callable[..., Any], name: str):
        self._method = method
        self.__name__ = name

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        """Call the actual method."""
        if not args and not kwargs:
            # Called with no arguments - return transition marker
            return StepTransition(self.__name__)
        return self._method(*args, **kwargs)

    def __repr__(self) -> str:
        return f"TransitionableMethod({self.__name__})"
