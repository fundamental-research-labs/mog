"""
Workflow exceptions and error types.

This module defines all exception classes used by the workflow engine.
These exceptions control retry behavior, cancellation, and error handling.
"""

from typing import Any, Dict, Optional


# =============================================================================
# Base Exception
# =============================================================================


class WorkflowError(Exception):
    """
    Base class for all workflow exceptions.

    All workflow-specific exceptions inherit from this class,
    making it easy to catch all workflow-related errors.
    """

    def __init__(
        self,
        message: str,
        *,
        details: Optional[Dict[str, Any]] = None,
        cause: Optional[Exception] = None,
    ):
        """
        Initialize a workflow error.

        Args:
            message: Human-readable error message
            details: Additional structured information about the error
            cause: Original exception that caused this error
        """
        super().__init__(message)
        self.message = message
        self.details = details or {}
        self.cause = cause

    def __str__(self) -> str:
        result = self.message
        if self.details:
            result += f" (details: {self.details})"
        if self.cause:
            result += f" (caused by: {self.cause})"
        return result

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "type": self.__class__.__name__,
            "message": self.message,
            "details": self.details,
            "cause": str(self.cause) if self.cause else None,
        }


# =============================================================================
# Retry-Related Exceptions
# =============================================================================


class RetryableError(WorkflowError):
    """
    Exception indicating the step should be retried.

    Raise this when a transient error occurs that may succeed on retry,
    such as network timeouts, rate limiting, or temporary service unavailability.

    The workflow engine will automatically retry steps that raise this exception,
    following the @retry configuration if present.

    Example:
        @step
        @retry(max_attempts=3, backoff="exponential")
        def call_external_api(self, ctx):
            response = ctx.http.get("https://api.example.com/data")
            if response.status == 503:
                raise RetryableError("Service temporarily unavailable")
            if response.status == 429:
                raise RetryableError("Rate limited", retry_after=response.headers.get("Retry-After"))
            return response.json()
    """

    def __init__(
        self,
        message: str,
        *,
        retry_after: Optional[float] = None,
        details: Optional[Dict[str, Any]] = None,
        cause: Optional[Exception] = None,
    ):
        """
        Initialize a retryable error.

        Args:
            message: Human-readable error message
            retry_after: Suggested delay in seconds before retry (overrides backoff calculation)
            details: Additional structured information
            cause: Original exception
        """
        super().__init__(message, details=details, cause=cause)
        self.retry_after = retry_after


class NonRetryableError(WorkflowError):
    """
    Exception indicating the step should NOT be retried.

    Raise this when an error is permanent and retrying would not help,
    such as authentication failures, invalid input, or business rule violations.

    When raised, the workflow will fail immediately and be moved to the
    dead letter queue (if configured).

    Example:
        @step
        def validate_input(self, ctx):
            if not self.email or "@" not in self.email:
                raise NonRetryableError("Invalid email format", details={"email": self.email})

        @step
        def call_api(self, ctx):
            response = ctx.http.post("https://api.example.com/create", json=self.data)
            if response.status == 401:
                raise NonRetryableError("Authentication failed - check API credentials")
            if response.status == 400:
                raise NonRetryableError(f"Bad request: {response.json().get('error')}")
    """

    pass


class MaxRetriesExceeded(WorkflowError):
    """
    Exception raised when all retry attempts have been exhausted.

    This is raised internally by the engine when a step has been retried
    the maximum number of times and still fails.
    """

    def __init__(
        self,
        message: str,
        *,
        step_name: str,
        max_attempts: int,
        last_error: Optional[Exception] = None,
        details: Optional[Dict[str, Any]] = None,
    ):
        """
        Initialize max retries exceeded error.

        Args:
            message: Human-readable error message
            step_name: Name of the step that failed
            max_attempts: Number of attempts made
            last_error: The last error that occurred
            details: Additional structured information
        """
        super().__init__(message, details=details, cause=last_error)
        self.step_name = step_name
        self.max_attempts = max_attempts
        self.last_error = last_error


# =============================================================================
# Cancellation Exceptions
# =============================================================================


class WorkflowCancelled(WorkflowError):
    """
    Exception raised when a workflow is cancelled.

    This can be raised:
    1. By user code via ctx.cancel()
    2. By the engine when ctx.workflows.cancel() is called
    3. By a parent workflow cancelling child workflows

    When a workflow is cancelled, it transitions to the CANCELLED status
    and any configured compensation handlers are executed.

    Example:
        @step
        def check_conditions(self, ctx):
            if self.deal["status"] == "lost":
                raise WorkflowCancelled("Deal was lost, cancelling workflow")

        # Or via context:
        @step
        def process(self, ctx):
            if self.should_cancel:
                ctx.cancel(reason="User requested cancellation")
    """

    def __init__(
        self,
        reason: str = "Workflow was cancelled",
        *,
        cancelled_by: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
    ):
        """
        Initialize a cancellation.

        Args:
            reason: Why the workflow was cancelled
            cancelled_by: Who/what cancelled the workflow (user_id, "parent", "system")
            details: Additional structured information
        """
        super().__init__(reason, details=details)
        self.reason = reason
        self.cancelled_by = cancelled_by


class WorkflowTimeout(WorkflowError):
    """
    Exception raised when a workflow or step times out.

    This is raised:
    1. When a @wait_for timeout is reached
    2. When a step exceeds its execution time limit
    3. When the entire workflow exceeds its time limit

    Example:
        @step
        @wait_for(["approved", "rejected"], timeout="7d")
        def wait_for_approval(self, event, ctx):
            if event is None:  # Timeout occurred
                raise WorkflowTimeout("No approval received in 7 days")
    """

    def __init__(
        self,
        message: str = "Workflow timed out",
        *,
        timeout_type: str = "wait",
        step_name: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
    ):
        """
        Initialize a timeout error.

        Args:
            message: Human-readable error message
            timeout_type: Type of timeout ("wait", "step", "workflow")
            step_name: Name of the step that timed out
            details: Additional structured information
        """
        super().__init__(message, details=details)
        self.timeout_type = timeout_type
        self.step_name = step_name


# =============================================================================
# Definition Errors
# =============================================================================


class WorkflowDefinitionError(WorkflowError):
    """
    Exception raised for invalid workflow definitions.

    This is raised at decoration time when a workflow class or step
    is not properly defined.

    Example:
        @workflow(trigger="record:created")  # Missing 'table' parameter
        class BadWorkflow:
            pass
        # Raises: WorkflowDefinitionError("record:created trigger requires 'table' parameter")
    """

    pass


class StepDefinitionError(WorkflowError):
    """
    Exception raised for invalid step definitions.

    This is raised at decoration time when a step method
    is not properly defined.

    Example:
        class MyWorkflow:
            @step
            @step  # Double decoration
            def my_step(self, ctx):
                pass
        # Raises: StepDefinitionError("Step 'my_step' is already decorated")
    """

    pass


# =============================================================================
# Runtime Errors
# =============================================================================


class WorkflowNotFound(WorkflowError):
    """
    Exception raised when a workflow class cannot be found.

    This is raised when:
    1. A trigger references a non-existent workflow
    2. ctx.spawn() references an unregistered workflow
    3. Loading a workflow by name fails

    Example:
        ctx.spawn(NonExistentWorkflow, {"data": "value"})
        # Raises: WorkflowNotFound("Workflow 'NonExistentWorkflow' not found")
    """

    def __init__(
        self,
        workflow_name: str,
        *,
        details: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(f"Workflow '{workflow_name}' not found", details=details)
        self.workflow_name = workflow_name


class InstanceNotFound(WorkflowError):
    """
    Exception raised when a workflow instance cannot be found.

    This is raised when:
    1. Signaling a non-existent instance
    2. Loading an instance by ID fails
    3. Cancelling a non-existent instance

    Example:
        ctx.workflows.signal("non_existent_id", "event", {})
        # Raises: InstanceNotFound("Instance 'non_existent_id' not found")
    """

    def __init__(
        self,
        instance_id: str,
        *,
        details: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(f"Instance '{instance_id}' not found", details=details)
        self.instance_id = instance_id


class StepNotFound(WorkflowError):
    """
    Exception raised when a step method cannot be found.

    This is raised when a step transition references a non-existent step.

    Example:
        @step
        def my_step(self, ctx):
            return self.nonexistent_step()  # Step doesn't exist
        # Raises: StepNotFound("Step 'nonexistent_step' not found in workflow 'MyWorkflow'")
    """

    def __init__(
        self,
        step_name: str,
        workflow_name: str,
        *,
        details: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(
            f"Step '{step_name}' not found in workflow '{workflow_name}'",
            details=details,
        )
        self.step_name = step_name
        self.workflow_name = workflow_name


class InvalidTransition(WorkflowError):
    """
    Exception raised when a step transition is invalid.

    This is raised when:
    1. A step returns something that isn't a step transition
    2. A completed workflow tries to transition
    3. A cancelled workflow tries to transition

    Example:
        @step
        def my_step(self, ctx):
            return "invalid"  # Should return self.next_step() or self.complete()
        # Raises: InvalidTransition("Step 'my_step' returned invalid transition")
    """

    def __init__(
        self,
        message: str,
        *,
        from_step: Optional[str] = None,
        to_step: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(message, details=details)
        self.from_step = from_step
        self.to_step = to_step


# =============================================================================
# State Errors
# =============================================================================


class SerializationError(WorkflowError):
    """
    Exception raised when instance state cannot be serialized.

    This is raised when:
    1. Instance data contains non-JSON-serializable values
    2. Promotion to cloud fails due to serialization issues

    Example:
        @step
        def bad_step(self, ctx):
            self.callback = lambda x: x * 2  # Can't serialize lambdas!
            return self.next_step()
        # Raises: SerializationError("Cannot serialize instance data")
    """

    def __init__(
        self,
        message: str = "Cannot serialize instance data",
        *,
        field: Optional[str] = None,
        value_type: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
        cause: Optional[Exception] = None,
    ):
        super().__init__(message, details=details, cause=cause)
        self.field = field
        self.value_type = value_type


class DeserializationError(WorkflowError):
    """
    Exception raised when instance state cannot be deserialized.

    This is raised when:
    1. Loading persisted state fails
    2. Receiving promoted instance from another runtime fails
    """

    def __init__(
        self,
        message: str = "Cannot deserialize instance data",
        *,
        details: Optional[Dict[str, Any]] = None,
        cause: Optional[Exception] = None,
    ):
        super().__init__(message, details=details, cause=cause)


# =============================================================================
# Promotion Errors
# =============================================================================


class PromotionError(WorkflowError):
    """
    Exception raised when promoting workflow from local to cloud fails.

    This is raised when:
    1. Cloud runtime is unavailable
    2. State serialization fails
    3. Cloud rejects the promotion

    Example:
        @step
        @wait_for(["approved"], timeout="7d")
        def wait_approval(self, event, ctx):
            pass
        # If cloud is down: PromotionError("Failed to promote to cloud: connection refused")
    """

    def __init__(
        self,
        message: str = "Failed to promote workflow to cloud",
        *,
        details: Optional[Dict[str, Any]] = None,
        cause: Optional[Exception] = None,
    ):
        super().__init__(message, details=details, cause=cause)


# =============================================================================
# Event Errors
# =============================================================================


class EventDeliveryError(WorkflowError):
    """
    Exception raised when event delivery fails.

    This is raised when:
    1. Event cannot be routed to any workflow
    2. Event matching fails
    """

    def __init__(
        self,
        message: str = "Failed to deliver event",
        *,
        event_type: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
        cause: Optional[Exception] = None,
    ):
        super().__init__(message, details=details, cause=cause)
        self.event_type = event_type


class DuplicateEventError(WorkflowError):
    """
    Exception raised when a duplicate event is detected.

    This is raised when idempotency checks detect a duplicate trigger.
    This is usually not an error - it's expected behavior for exactly-once delivery.
    """

    def __init__(
        self,
        message: str = "Duplicate event detected",
        *,
        idempotency_key: Optional[str] = None,
        existing_instance_id: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(message, details=details)
        self.idempotency_key = idempotency_key
        self.existing_instance_id = existing_instance_id


# =============================================================================
# Version Errors
# =============================================================================


class VersionMismatchError(WorkflowError):
    """
    Exception raised when workflow versions conflict.

    This is raised when:
    1. Running instance has incompatible version with new code
    2. Migration function is missing for 'migrate' strategy
    """

    def __init__(
        self,
        message: str = "Workflow version mismatch",
        *,
        current_version: Optional[str] = None,
        expected_version: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(message, details=details)
        self.current_version = current_version
        self.expected_version = expected_version


class MigrationError(WorkflowError):
    """
    Exception raised when workflow state migration fails.

    This is raised when:
    1. migrate_from_vX method raises an error
    2. Migration produces invalid state
    """

    def __init__(
        self,
        message: str = "Failed to migrate workflow state",
        *,
        from_version: Optional[str] = None,
        to_version: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
        cause: Optional[Exception] = None,
    ):
        super().__init__(message, details=details, cause=cause)
        self.from_version = from_version
        self.to_version = to_version
