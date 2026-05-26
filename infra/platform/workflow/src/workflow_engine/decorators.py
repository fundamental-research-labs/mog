"""
Workflow decorators.

This module provides all the decorators used to define workflows:
- @workflow - Marks a class as a workflow and configures triggers
- @step - Marks a method as a workflow step
- @wait_for - Configures a step to wait for external events
- @retry - Configures retry behavior for a step
- @parallel - Configures parallel execution for a step

Decorator Order:
    Decorators can be applied in any order. They all work together:

    @step
    @wait_for(["approved", "rejected"], timeout="7d")
    def my_step(self, event, ctx):
        pass

    # OR equivalently:

    @wait_for(["approved", "rejected"], timeout="7d")
    @step
    def my_step(self, event, ctx):
        pass

Example:
    from workflow_engine import workflow, step, wait_for, retry, parallel

    @workflow(
        trigger="record:created",
        table="expenses",
        runtime="auto",
    )
    class ExpenseApproval:
        @step
        def start(self, event, ctx):
            self.expense = ctx.records.get("expenses", event["recordId"])
            if self.expense["amount"] <= 500:
                return self.auto_approve()
            return self.request_approval()

        @step
        @wait_for(["expense:approved", "expense:rejected"], timeout="7d")
        def wait_for_decision(self, event, ctx):
            if event is None:
                return self.escalate()
            return self.handle_decision(event)

        @step
        @retry(max_attempts=3, backoff="exponential")
        def sync_to_external(self, ctx):
            response = ctx.http.post("https://api.example.com/sync", json=self.expense)
            if not response.ok:
                raise RetryableError("Sync failed")
            return self.complete()
"""

import functools
from datetime import timedelta
from typing import Any, Callable, List, Optional, Type, TypeVar, Union, overload

from .types import (
    BackoffStrategy,
    CellTriggerConfig,
    ParallelConfig,
    RecordTriggerConfig,
    RetryConfig,
    RuntimeType,
    ScheduleTriggerConfig,
    StepMetadata,
    TriggerConfig,
    TriggerType,
    VersioningStrategy,
    WaitForConfig,
    WebhookTriggerConfig,
    WorkflowMetadata,
    parse_duration,
)
from .definition import (
    WORKFLOW_META_ATTR,
    STEP_META_ATTR,
    WorkflowDefinition,
    WorkflowInstanceHelper,
)
from .registry import get_global_registry
from .errors import WorkflowDefinitionError, StepDefinitionError


# Type variables for decorators
T = TypeVar("T")
F = TypeVar("F", bound=Callable[..., Any])


# Attribute names for pending configurations (before @step merges them)
_WAIT_FOR_ATTR = "__wait_for_config__"
_RETRY_ATTR = "__retry_config__"
_PARALLEL_ATTR = "__parallel_config__"


# =============================================================================
# @workflow Decorator
# =============================================================================


def workflow(
    trigger: str,
    *,
    # Record triggers
    table: Optional[str] = None,
    field: Optional[str] = None,
    value: Any = None,
    # Schedule triggers
    cron: Optional[str] = None,
    timezone: str = "UTC",
    # Webhook triggers
    path: Optional[str] = None,
    method: str = "POST",
    # Cell triggers
    sheet: Optional[str] = None,
    range: Optional[str] = None,
    # Runtime
    runtime: str = "auto",
    # Idempotency
    idempotency_key: Optional[str] = None,
    # Versioning
    version: str = "1.0.0",
    versioning_strategy: str = "replace",
    # Metadata
    name: Optional[str] = None,
    description: Optional[str] = None,
    # Registration
    register: bool = True,
) -> Callable[[Type[T]], Type[T]]:
    """
    Decorator that marks a class as a workflow.

    This decorator:
    1. Stores trigger and runtime configuration as class metadata
    2. Adds helper methods (complete(), etc.) to the class
    3. Registers the workflow in the global registry (optional)
    4. Validates the configuration

    Args:
        trigger: Trigger type. One of:
            - "record:created" - When a record is created
            - "record:updated" - When a record is updated
            - "record:deleted" - When a record is deleted
            - "cell:changed" - When a cell value changes (spreadsheet)
            - "schedule" - On a schedule (cron)
            - "webhook" - When webhook is called
            - "manual" - Manually triggered
            - "workflow:spawned" - When spawned by another workflow

        table: Table name for record triggers
        field: Field name to watch for update triggers (optional)
        value: Value to match for update triggers (optional)

        cron: Cron expression for schedule triggers (e.g., "0 9 * * 1")
        timezone: Timezone for schedule triggers (default: "UTC")

        path: Webhook path (e.g., "/stripe-payment")
        method: HTTP method for webhook (default: "POST")

        sheet: Sheet name for cell triggers
        range: Cell range to watch (e.g., "A1:B10")

        runtime: Where to execute. One of:
            - "local" - Browser only (Pyodide)
            - "cloud" - Server only
            - "auto" - Start local, promote to cloud on wait/sleep

        idempotency_key: Expression to compute idempotency key from event
            (e.g., "event.recordId")

        version: Semantic version (e.g., "1.0.0")
        versioning_strategy: One of "replace", "parallel", "migrate"

        name: Human-readable name (defaults to class name)
        description: Human-readable description (defaults to docstring)

        register: If True, register in global registry (default: True)

    Returns:
        Decorated class

    Raises:
        WorkflowDefinitionError: If configuration is invalid

    Example:
        @workflow(
            trigger="record:updated",
            table="deals",
            field="stage",
            value="Won",
            runtime="auto",
            version="1.0.0",
        )
        class DealClosedWorkflow:
            @step
            def start(self, event, ctx):
                self.deal = ctx.apps.crm.get_deal(event["recordId"])
                return self.create_invoice()
    """

    def decorator(cls: Type[T]) -> Type[T]:
        # Parse trigger type
        trigger_type = _parse_trigger_type(trigger)

        # Build trigger config
        trigger_config = _build_trigger_config(
            trigger_type=trigger_type,
            table=table,
            field=field,
            value=value,
            cron=cron,
            timezone=timezone,
            path=path,
            method=method,
            sheet=sheet,
            range=range,
        )

        # Parse runtime
        runtime_type = _parse_runtime(runtime)

        # Parse versioning strategy
        versioning = _parse_versioning_strategy(versioning_strategy)

        # Create metadata
        meta = WorkflowMetadata(
            trigger_type=trigger_type,
            trigger_config=trigger_config,
            runtime=runtime_type,
            idempotency_key=idempotency_key,
            version=version,
            versioning_strategy=versioning,
            name=name,
            description=description or cls.__doc__,
        )

        # Store metadata on class
        setattr(cls, WORKFLOW_META_ATTR, meta)

        # Add helper methods by making the class inherit from WorkflowInstanceHelper
        # We use a mixin approach to avoid replacing the existing class
        if not issubclass(cls, WorkflowInstanceHelper):
            # Create a new class that inherits from both
            original_init = cls.__init__ if hasattr(cls, '__init__') else None

            # Copy all attributes to preserve the class structure
            new_cls = type(
                cls.__name__,
                (cls, WorkflowInstanceHelper),
                dict(cls.__dict__),
            )
            new_cls.__module__ = cls.__module__
            new_cls.__qualname__ = cls.__qualname__
            if cls.__doc__:
                new_cls.__doc__ = cls.__doc__

            # Keep the original __init__ if it existed
            if original_init is not None:
                new_cls.__init__ = original_init

            cls = new_cls

        # Register if requested
        if register:
            get_global_registry().register(cls, replace=True)

        return cls

    return decorator


def _parse_trigger_type(trigger: str) -> TriggerType:
    """Parse trigger string to TriggerType enum."""
    mapping = {
        "record:created": TriggerType.RECORD_CREATED,
        "record:updated": TriggerType.RECORD_UPDATED,
        "record:deleted": TriggerType.RECORD_DELETED,
        "cell:changed": TriggerType.CELL_CHANGED,
        "relation:linked": TriggerType.RELATION_LINKED,
        "relation:unlinked": TriggerType.RELATION_UNLINKED,
        "schedule": TriggerType.SCHEDULE,
        "webhook": TriggerType.WEBHOOK,
        "manual": TriggerType.MANUAL,
        "workflow:spawned": TriggerType.WORKFLOW_SPAWNED,
    }
    trigger_type = mapping.get(trigger)
    if trigger_type is None:
        valid_triggers = ", ".join(f"'{t}'" for t in mapping.keys())
        raise WorkflowDefinitionError(
            f"Invalid trigger '{trigger}'. Must be one of: {valid_triggers}"
        )
    return trigger_type


def _build_trigger_config(
    trigger_type: TriggerType,
    table: Optional[str],
    field: Optional[str],
    value: Any,
    cron: Optional[str],
    timezone: str,
    path: Optional[str],
    method: str,
    sheet: Optional[str],
    range: Optional[str],
) -> TriggerConfig:
    """Build trigger configuration based on trigger type."""
    if trigger_type in (
        TriggerType.RECORD_CREATED,
        TriggerType.RECORD_UPDATED,
        TriggerType.RECORD_DELETED,
        TriggerType.RELATION_LINKED,
        TriggerType.RELATION_UNLINKED,
    ):
        if not table:
            raise WorkflowDefinitionError(
                f"Trigger '{trigger_type.value}' requires 'table' parameter"
            )
        return RecordTriggerConfig(table=table, field=field, value=value)

    elif trigger_type == TriggerType.CELL_CHANGED:
        if not sheet:
            raise WorkflowDefinitionError(
                f"Trigger '{trigger_type.value}' requires 'sheet' parameter"
            )
        return CellTriggerConfig(sheet=sheet, range=range)

    elif trigger_type == TriggerType.SCHEDULE:
        if not cron:
            raise WorkflowDefinitionError(
                f"Trigger '{trigger_type.value}' requires 'cron' parameter"
            )
        return ScheduleTriggerConfig(cron=cron, timezone=timezone)

    elif trigger_type == TriggerType.WEBHOOK:
        if not path:
            raise WorkflowDefinitionError(
                f"Trigger '{trigger_type.value}' requires 'path' parameter"
            )
        return WebhookTriggerConfig(path=path, method=method)

    else:
        # Manual and workflow:spawned don't need config
        return None


def _parse_runtime(runtime: str) -> RuntimeType:
    """Parse runtime string to RuntimeType enum."""
    mapping = {
        "local": RuntimeType.LOCAL,
        "cloud": RuntimeType.CLOUD,
        "auto": RuntimeType.AUTO,
    }
    runtime_type = mapping.get(runtime)
    if runtime_type is None:
        raise WorkflowDefinitionError(
            f"Invalid runtime '{runtime}'. Must be 'local', 'cloud', or 'auto'"
        )
    return runtime_type


def _parse_versioning_strategy(strategy: str) -> VersioningStrategy:
    """Parse versioning strategy string to enum."""
    mapping = {
        "replace": VersioningStrategy.REPLACE,
        "parallel": VersioningStrategy.PARALLEL,
        "migrate": VersioningStrategy.MIGRATE,
    }
    versioning = mapping.get(strategy)
    if versioning is None:
        raise WorkflowDefinitionError(
            f"Invalid versioning_strategy '{strategy}'. "
            f"Must be 'replace', 'parallel', or 'migrate'"
        )
    return versioning


# =============================================================================
# @step Decorator
# =============================================================================


@overload
def step(func: F) -> F:
    """Direct decoration without arguments."""
    ...


@overload
def step(
    *,
    name: Optional[str] = None,
    entry_point: bool = False,
    description: Optional[str] = None,
) -> Callable[[F], F]:
    """Decoration with arguments."""
    ...


def step(
    func: Optional[F] = None,
    *,
    name: Optional[str] = None,
    entry_point: bool = False,
    description: Optional[str] = None,
) -> Union[F, Callable[[F], F]]:
    """
    Decorator that marks a method as a workflow step.

    Steps are the building blocks of workflows. Each step:
    - Is persisted after completion (survives restarts)
    - Can transition to another step via return value
    - Can access workflow state via self.*
    - Can access the context via ctx parameter

    Can be combined with @wait_for, @retry, @parallel in any order.

    Args:
        name: Step name (defaults to method name)
        entry_point: If True, this step is the workflow entry point
        description: Human-readable description

    Returns:
        Decorated method

    Example:
        @step
        def my_step(self, ctx):
            # Do work
            return self.next_step()

        @step(entry_point=True)
        def start(self, event, ctx):
            # First step receives the trigger event
            self.data = event["data"]
            return self.process()

        @step(name="process_data", description="Process the incoming data")
        def process(self, ctx):
            # Named step with description
            return self.complete()
    """

    def decorator(fn: F) -> F:
        # Get any pending configs from other decorators
        wait_for_config: Optional[WaitForConfig] = getattr(fn, _WAIT_FOR_ATTR, None)
        retry_config: Optional[RetryConfig] = getattr(fn, _RETRY_ATTR, None)
        parallel_config: Optional[ParallelConfig] = getattr(fn, _PARALLEL_ATTR, None)

        # Check if already has step metadata (from prior @step decoration)
        existing_meta: Optional[StepMetadata] = getattr(fn, STEP_META_ATTR, None)
        if existing_meta is not None:
            # Already decorated with @step, just merge any new configs
            if wait_for_config and existing_meta.wait_for is None:
                existing_meta.wait_for = wait_for_config
            if retry_config and existing_meta.retry is None:
                existing_meta.retry = retry_config
            if parallel_config and existing_meta.parallel is None:
                existing_meta.parallel = parallel_config
            return fn

        # Create step metadata, incorporating any pending configs
        meta = StepMetadata(
            name=name or fn.__name__,
            is_entry_point=entry_point,
            description=description or fn.__doc__,
            wait_for=wait_for_config,
            retry=retry_config,
            parallel=parallel_config,
        )

        # Store on function
        setattr(fn, STEP_META_ATTR, meta)

        # Clean up pending config attrs
        for attr in [_WAIT_FOR_ATTR, _RETRY_ATTR, _PARALLEL_ATTR]:
            if hasattr(fn, attr):
                delattr(fn, attr)

        # Preserve function metadata with a wrapper
        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            return fn(*args, **kwargs)

        # Copy the metadata to wrapper
        setattr(wrapper, STEP_META_ATTR, meta)

        return wrapper  # type: ignore

    # Handle both @step and @step() syntax
    if func is not None:
        return decorator(func)
    return decorator


# =============================================================================
# @wait_for Decorator
# =============================================================================


def wait_for(
    events: List[str],
    timeout: Optional[str] = None,
    timeout_event: Optional[str] = None,
) -> Callable[[F], F]:
    """
    Decorator that configures a step to wait for external events.

    When a step decorated with @wait_for completes, the workflow:
    1. Persists its state
    2. Waits for one of the specified events
    3. When an event arrives (or timeout), the step is called again with the event

    **Important**: @wait_for triggers auto-promotion to cloud runtime if timeout is set.

    Can be combined with @step in any order.

    Args:
        events: List of event types to wait for
        timeout: Maximum wait time (e.g., "7d", "1h", "30m"). None = wait forever.
        timeout_event: Event type to emit on timeout (optional)

    Returns:
        Decorated step

    Example:
        @step
        @wait_for(["approved", "rejected"], timeout="7d")
        def wait_for_decision(self, event, ctx):
            if event is None:
                # Timeout occurred
                return self.escalate()
            elif event["type"] == "approved":
                return self.handle_approval()
            else:
                return self.handle_rejection()

        @wait_for(["payment:received"])  # Works in any order with @step
        @step
        def wait_for_payment(self, event, ctx):
            self.payment = event["data"]
            return self.process_payment()
    """

    def decorator(fn: F) -> F:
        # Parse timeout
        timeout_delta: Optional[timedelta] = None
        if timeout:
            try:
                timeout_delta = parse_duration(timeout)
            except ValueError as e:
                raise StepDefinitionError(
                    f"Invalid timeout '{timeout}' for step '{fn.__name__}': {e}"
                )

        # Create wait config
        wait_config = WaitForConfig(
            events=events,
            timeout=timeout_delta,
            timeout_event=timeout_event,
        )

        # Check if @step was already applied
        meta: Optional[StepMetadata] = getattr(fn, STEP_META_ATTR, None)
        if meta is not None:
            # @step already applied, update its metadata
            meta.wait_for = wait_config
        else:
            # @step not yet applied, store config for later
            setattr(fn, _WAIT_FOR_ATTR, wait_config)

        return fn

    return decorator


# =============================================================================
# @retry Decorator
# =============================================================================


def retry(
    max_attempts: int = 3,
    backoff: str = "exponential",
    initial_delay: str = "1s",
    max_delay: str = "1m",
    retryable_exceptions: Optional[List[type]] = None,
) -> Callable[[F], F]:
    """
    Decorator that configures retry behavior for a step.

    When a step raises a RetryableError (or other configured exception),
    the engine will automatically retry with the configured backoff.

    Can be combined with @step in any order.

    Args:
        max_attempts: Maximum number of attempts (including initial)
        backoff: Backoff strategy: "fixed", "linear", or "exponential"
        initial_delay: Initial delay before first retry (e.g., "1s", "500ms")
        max_delay: Maximum delay between retries (e.g., "1m", "5m")
        retryable_exceptions: Exception types to retry (default: RetryableError only)

    Returns:
        Decorated step

    Backoff strategies:
        - fixed: Same delay each time (initial_delay)
        - linear: Delay increases linearly (initial_delay * attempt)
        - exponential: Delay doubles each time (initial_delay * 2^attempt)

    Example:
        @step
        @retry(max_attempts=3, backoff="exponential", initial_delay="1s")
        def call_api(self, ctx):
            response = ctx.http.post("https://api.example.com/data")
            if response.status == 503:
                raise RetryableError("Service unavailable")
            return self.process_response(response)

        @retry(max_attempts=5, backoff="fixed", initial_delay="30s")  # Any order with @step
        @step
        def poll_for_result(self, ctx):
            result = ctx.http.get(f"https://api.example.com/jobs/{self.job_id}")
            if result["status"] == "pending":
                raise RetryableError("Job still pending")
            return self.handle_result(result)
    """

    def decorator(fn: F) -> F:
        # Parse backoff strategy
        backoff_strategy = _parse_backoff_strategy(backoff, fn.__name__)

        # Parse durations
        try:
            initial = parse_duration(initial_delay)
        except ValueError as e:
            raise StepDefinitionError(
                f"Invalid initial_delay '{initial_delay}' for step '{fn.__name__}': {e}"
            )

        try:
            max_d = parse_duration(max_delay)
        except ValueError as e:
            raise StepDefinitionError(
                f"Invalid max_delay '{max_delay}' for step '{fn.__name__}': {e}"
            )

        # Create retry config
        retry_config = RetryConfig(
            max_attempts=max_attempts,
            backoff=backoff_strategy,
            initial_delay=initial,
            max_delay=max_d,
            retryable_exceptions=retryable_exceptions,
        )

        # Check if @step was already applied
        meta: Optional[StepMetadata] = getattr(fn, STEP_META_ATTR, None)
        if meta is not None:
            # @step already applied, update its metadata
            meta.retry = retry_config
        else:
            # @step not yet applied, store config for later
            setattr(fn, _RETRY_ATTR, retry_config)

        return fn

    return decorator


def _parse_backoff_strategy(backoff: str, step_name: str) -> BackoffStrategy:
    """Parse backoff strategy string to enum."""
    mapping = {
        "fixed": BackoffStrategy.FIXED,
        "linear": BackoffStrategy.LINEAR,
        "exponential": BackoffStrategy.EXPONENTIAL,
    }
    strategy = mapping.get(backoff)
    if strategy is None:
        raise StepDefinitionError(
            f"Invalid backoff '{backoff}' for step '{step_name}'. "
            f"Must be 'fixed', 'linear', or 'exponential'"
        )
    return strategy


# =============================================================================
# @parallel Decorator
# =============================================================================


def parallel(
    max_concurrency: int = 10,
    fail_fast: bool = False,
    collect_results: bool = True,
) -> Callable[[F], F]:
    """
    Decorator that configures parallel execution for a step.

    When a step decorated with @parallel returns a list, each item
    is processed concurrently up to max_concurrency.

    Can be combined with @step in any order.

    Args:
        max_concurrency: Maximum number of concurrent executions
        fail_fast: If True, cancel remaining items on first failure
        collect_results: If True, collect results from all executions

    Returns:
        Decorated step

    Example:
        @step
        @parallel(max_concurrency=10)
        def process_all(self, ctx):
            # Each item is processed in parallel
            return [self.process_one(item) for item in self.items]

        @parallel(max_concurrency=5, fail_fast=True)  # Any order with @step
        @step
        def critical_operations(self, ctx):
            # Stop on first failure
            return [self.critical_op(x) for x in self.critical_items]
    """

    def decorator(fn: F) -> F:
        # Create parallel config
        parallel_config = ParallelConfig(
            max_concurrency=max_concurrency,
            fail_fast=fail_fast,
            collect_results=collect_results,
        )

        # Check if @step was already applied
        meta: Optional[StepMetadata] = getattr(fn, STEP_META_ATTR, None)
        if meta is not None:
            # @step already applied, update its metadata
            meta.parallel = parallel_config
        else:
            # @step not yet applied, store config for later
            setattr(fn, _PARALLEL_ATTR, parallel_config)

        return fn

    return decorator


# =============================================================================
# Utility Functions
# =============================================================================


def is_workflow(cls: type) -> bool:
    """Check if a class is decorated with @workflow."""
    return hasattr(cls, WORKFLOW_META_ATTR)


def is_step(method: Callable[..., Any]) -> bool:
    """Check if a method is decorated with @step."""
    return hasattr(method, STEP_META_ATTR)


def get_workflow_metadata(cls: type) -> Optional[WorkflowMetadata]:
    """Get workflow metadata from a class."""
    return getattr(cls, WORKFLOW_META_ATTR, None)


def get_step_metadata(method: Callable[..., Any]) -> Optional[StepMetadata]:
    """Get step metadata from a method."""
    return getattr(method, STEP_META_ATTR, None)
