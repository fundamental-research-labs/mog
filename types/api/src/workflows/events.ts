/**
 * Workflow Event Contracts
 *
 * Type definitions for workflow lifecycle events.
 * These events are emitted by the workflow engine for monitoring, logging,
 * and triggering other workflows.
 *
 * Event Categories:
 * - Instance lifecycle: started, completed, failed, cancelled
 * - Step lifecycle: started, completed, failed, skipped
 * - Runtime events: promoted, sleeping, waiting
 * - System events: retry, dead_letter, error
 *
 */

import type { StepError } from './instance';
import type { RuntimeType } from './runtime';

// =============================================================================
// Base Event
// =============================================================================

/**
 * Base interface for all workflow events.
 */
export interface WorkflowEventBase {
  /** Event type */
  type: WorkflowEventType;

  /** Unique event ID */
  eventId: string;

  /** Timestamp (ISO 8601) */
  timestamp: string;

  /** Workflow ID */
  workflowId: string;

  /** Workflow instance ID */
  instanceId: string;

  /** Workflow version */
  workflowVersion: string;
}

/**
 * All workflow event types.
 */
export type WorkflowEventType =
  // Instance lifecycle
  | 'workflow:started'
  | 'workflow:completed'
  | 'workflow:failed'
  | 'workflow:cancelled'
  | 'workflow:paused'
  | 'workflow:resumed'
  // Step lifecycle
  | 'step:started'
  | 'step:completed'
  | 'step:failed'
  | 'step:skipped'
  // Runtime events
  | 'workflow:promoted'
  | 'workflow:sleeping'
  | 'workflow:waiting'
  | 'workflow:woken'
  // System events
  | 'step:retry'
  | 'workflow:dead_letter'
  | 'workflow:error';

// =============================================================================
// Instance Lifecycle Events
// =============================================================================

/**
 * Emitted when a workflow instance starts.
 */
export interface WorkflowStartedEvent extends WorkflowEventBase {
  type: 'workflow:started';

  /** Trigger type that started the workflow */
  triggerType: string;

  /** Trigger event data */
  triggerEvent: Record<string, unknown>;

  /** Runtime where workflow started */
  runtime: RuntimeType;

  /** Initial step */
  initialStep: string;

  /** Parent instance ID if spawned */
  parentInstanceId?: string;

  /** User/system that triggered */
  triggeredBy?: string;

  /** Idempotency key if deduplicated */
  idempotencyKey?: string;
}

/**
 * Emitted when a workflow instance completes successfully.
 */
export interface WorkflowCompletedEvent extends WorkflowEventBase {
  type: 'workflow:completed';

  /** Final runtime where workflow completed */
  runtime: RuntimeType;

  /** Final step (should be the completion step) */
  finalStep: string;

  /** Total execution time in milliseconds */
  durationMs: number;

  /** Number of steps executed */
  stepCount: number;

  /** Workflow result/output if any */
  result?: unknown;
}

/**
 * Emitted when a workflow instance fails permanently.
 */
export interface WorkflowFailedEvent extends WorkflowEventBase {
  type: 'workflow:failed';

  /** Runtime where failure occurred */
  runtime: RuntimeType;

  /** Step where failure occurred */
  failedStep: string;

  /** Error details */
  error: StepError;

  /** Total execution time before failure */
  durationMs: number;

  /** Number of steps executed before failure */
  stepCount: number;

  /** Whether instance was moved to dead letter queue */
  movedToDeadLetter: boolean;
}

/**
 * Emitted when a workflow instance is cancelled.
 */
export interface WorkflowCancelledEvent extends WorkflowEventBase {
  type: 'workflow:cancelled';

  /** Runtime where cancellation happened */
  runtime: RuntimeType;

  /** Step at time of cancellation */
  currentStep: string;

  /** Cancellation reason */
  reason: string;

  /** User/system that cancelled */
  cancelledBy?: string;

  /** Whether compensation steps ran */
  compensated: boolean;

  /** Total execution time */
  durationMs: number;
}

/**
 * Emitted when a workflow instance is paused.
 */
export interface WorkflowPausedEvent extends WorkflowEventBase {
  type: 'workflow:paused';

  /** Runtime where pause happened */
  runtime: RuntimeType;

  /** Step at time of pause */
  currentStep: string;

  /** Pause reason */
  reason?: string;

  /** User/system that paused */
  pausedBy?: string;
}

/**
 * Emitted when a workflow instance is resumed.
 */
export interface WorkflowResumedEvent extends WorkflowEventBase {
  type: 'workflow:resumed';

  /** Runtime where resume happened */
  runtime: RuntimeType;

  /** Step being resumed */
  currentStep: string;

  /** User/system that resumed */
  resumedBy?: string;
}

// =============================================================================
// Step Lifecycle Events
// =============================================================================

/**
 * Emitted when a step starts executing.
 */
export interface StepStartedEvent extends WorkflowEventBase {
  type: 'step:started';

  /** Step name */
  stepName: string;

  /** Runtime where step is running */
  runtime: RuntimeType;

  /** Attempt number (1 for first attempt, >1 for retries) */
  attempt: number;

  /** Input to the step */
  input?: Record<string, unknown>;
}

/**
 * Emitted when a step completes successfully.
 */
export interface StepCompletedEvent extends WorkflowEventBase {
  type: 'step:completed';

  /** Step name */
  stepName: string;

  /** Runtime where step completed */
  runtime: RuntimeType;

  /** Attempt number */
  attempt: number;

  /** Step execution duration in milliseconds */
  durationMs: number;

  /** Next step to transition to */
  nextStep: string | null;

  /** Step output/result */
  output?: unknown;
}

/**
 * Emitted when a step fails.
 */
export interface StepFailedEvent extends WorkflowEventBase {
  type: 'step:failed';

  /** Step name */
  stepName: string;

  /** Runtime where step failed */
  runtime: RuntimeType;

  /** Attempt number */
  attempt: number;

  /** Step execution duration before failure */
  durationMs: number;

  /** Error details */
  error: StepError;

  /** Whether step will be retried */
  willRetry: boolean;

  /** Next retry time if retrying (ISO 8601) */
  nextRetryAt?: string;
}

/**
 * Emitted when a step is skipped.
 */
export interface StepSkippedEvent extends WorkflowEventBase {
  type: 'step:skipped';

  /** Step name */
  stepName: string;

  /** Runtime */
  runtime: RuntimeType;

  /** Reason for skipping */
  reason: string;
}

// =============================================================================
// Runtime Events
// =============================================================================

/**
 * Emitted when a workflow is promoted from local to cloud runtime.
 */
export interface WorkflowPromotedEvent extends WorkflowEventBase {
  type: 'workflow:promoted';

  /** Source runtime (always 'local') */
  fromRuntime: 'local';

  /** Target runtime (always 'cloud') */
  toRuntime: 'cloud';

  /** Step that triggered promotion */
  promotionStep: string;

  /** Reason for promotion */
  promotionReason: PromotionReason;

  /** State size in bytes */
  stateSizeBytes: number;
}

/**
 * Reasons for automatic promotion to cloud.
 */
export type PromotionReason =
  | 'wait_for' // @wait_for decorator
  | 'sleep' // ctx.sleep() called
  | 'schedule' // Schedule trigger
  | 'explicit'; // ctx.promote_to_cloud() called

/**
 * Emitted when a workflow starts sleeping.
 */
export interface WorkflowSleepingEvent extends WorkflowEventBase {
  type: 'workflow:sleeping';

  /** Runtime */
  runtime: RuntimeType;

  /** Step that called sleep */
  sleepStep: string;

  /** Wake time (ISO 8601) */
  wakeAt: string;

  /** Sleep duration in milliseconds */
  durationMs: number;

  /** Timer ID */
  timerId: string;
}

/**
 * Emitted when a workflow starts waiting for events.
 */
export interface WorkflowWaitingEvent extends WorkflowEventBase {
  type: 'workflow:waiting';

  /** Runtime */
  runtime: RuntimeType;

  /** Step that is waiting */
  waitStep: string;

  /** Events being waited for */
  waitingForEvents: string[];

  /** Timeout time (ISO 8601) */
  timeoutAt: string;

  /** Timer ID */
  timerId: string;
}

/**
 * Emitted when a workflow wakes from sleep or receives awaited event.
 */
export interface WorkflowWokenEvent extends WorkflowEventBase {
  type: 'workflow:woken';

  /** Runtime */
  runtime: RuntimeType;

  /** Step being resumed */
  resumeStep: string;

  /** Wake reason */
  wakeReason: WakeReason;

  /** Event that woke the workflow (for 'event' reason) */
  wakeEvent?: WorkflowSignal;

  /** Time spent sleeping/waiting in milliseconds */
  waitDurationMs: number;
}

/**
 * Reasons for waking.
 */
export type WakeReason =
  | 'sleep_completed' // Sleep timer fired
  | 'event_received' // Waited-for event arrived
  | 'timeout' // Wait timeout fired
  | 'manual'; // Manual resume

/**
 * Signal sent to a waiting workflow.
 */
export interface WorkflowSignal {
  /** Event type */
  eventType: string;

  /** Event data */
  data: Record<string, unknown>;

  /** Sender instance ID */
  senderInstanceId?: string;

  /** Timestamp */
  timestamp: string;
}

// =============================================================================
// System Events
// =============================================================================

/**
 * Emitted when a step is being retried.
 */
export interface StepRetryEvent extends WorkflowEventBase {
  type: 'step:retry';

  /** Step name */
  stepName: string;

  /** Runtime */
  runtime: RuntimeType;

  /** Previous attempt number */
  previousAttempt: number;

  /** Next attempt number */
  nextAttempt: number;

  /** Max attempts allowed */
  maxAttempts: number;

  /** Error from previous attempt */
  previousError: StepError;

  /** Delay before retry in milliseconds */
  delayMs: number;

  /** Next retry time (ISO 8601) */
  retryAt: string;
}

/**
 * Emitted when a workflow is moved to dead letter queue.
 */
export interface WorkflowDeadLetterEvent extends WorkflowEventBase {
  type: 'workflow:dead_letter';

  /** Runtime where failure occurred */
  runtime: RuntimeType;

  /** Step where final failure occurred */
  failedStep: string;

  /** Final error */
  error: StepError;

  /** Total retry attempts across all steps */
  totalRetries: number;

  /** Reason for dead letter */
  reason: DeadLetterReason;

  /** Time spent before dead letter in milliseconds */
  totalDurationMs: number;
}

/**
 * Reasons for moving to dead letter queue.
 */
export type DeadLetterReason =
  | 'retries_exhausted' // Max retries reached
  | 'non_retryable_error' // NonRetryableError raised
  | 'step_timeout' // Step timed out
  | 'workflow_timeout' // Overall workflow timed out
  | 'system_error'; // Internal system error

/**
 * Emitted for general workflow errors (not step failures).
 */
export interface WorkflowErrorEvent extends WorkflowEventBase {
  type: 'workflow:error';

  /** Runtime */
  runtime: RuntimeType;

  /** Error category */
  errorCategory: ErrorCategory;

  /** Error message */
  message: string;

  /** Error details */
  details?: Record<string, unknown>;

  /** Whether workflow can continue */
  recoverable: boolean;
}

/**
 * Error categories for workflow errors.
 */
export type ErrorCategory =
  | 'serialization' // State serialization/deserialization error
  | 'promotion' // Failed to promote to cloud
  | 'persistence' // Failed to persist state
  | 'trigger' // Trigger evaluation error
  | 'timer' // Timer scheduling error
  | 'internal'; // Internal system error

// =============================================================================
// Event Union Type
// =============================================================================

/**
 * Union of all workflow events.
 */
export type WorkflowEvent =
  // Instance lifecycle
  | WorkflowStartedEvent
  | WorkflowCompletedEvent
  | WorkflowFailedEvent
  | WorkflowCancelledEvent
  | WorkflowPausedEvent
  | WorkflowResumedEvent
  // Step lifecycle
  | StepStartedEvent
  | StepCompletedEvent
  | StepFailedEvent
  | StepSkippedEvent
  // Runtime events
  | WorkflowPromotedEvent
  | WorkflowSleepingEvent
  | WorkflowWaitingEvent
  | WorkflowWokenEvent
  // System events
  | StepRetryEvent
  | WorkflowDeadLetterEvent
  | WorkflowErrorEvent;

// =============================================================================
// Event Handler Types
// =============================================================================

/**
 * Handler for workflow events.
 */
export type WorkflowEventHandler<T extends WorkflowEvent = WorkflowEvent> = (event: T) => void;

/**
 * Subscription to workflow events.
 */
export interface WorkflowEventSubscription {
  /** Unsubscribe from events */
  unsubscribe(): void;
}

/**
 * Event filter for subscriptions.
 */
export interface WorkflowEventFilter {
  /** Filter by event type(s) */
  eventTypes?: WorkflowEventType[];

  /** Filter by workflow ID */
  workflowId?: string;

  /** Filter by instance ID */
  instanceId?: string;

  /** Filter by runtime */
  runtime?: RuntimeType;
}

// =============================================================================
// Event Bus Interface
// =============================================================================

/**
 * Interface for workflow event bus.
 */
export interface IWorkflowEventBus {
  /**
   * Emit a workflow event.
   */
  emit(event: WorkflowEvent): void;

  /**
   * Subscribe to workflow events.
   */
  subscribe(handler: WorkflowEventHandler, filter?: WorkflowEventFilter): WorkflowEventSubscription;

  /**
   * Subscribe to a specific event type.
   */
  on<T extends WorkflowEventType>(
    eventType: T,
    handler: WorkflowEventHandler<Extract<WorkflowEvent, { type: T }>>,
  ): WorkflowEventSubscription;
}
