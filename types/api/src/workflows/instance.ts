/**
 * Workflow Instance Contracts
 *
 * Type definitions for workflow instance state, history, and runtime tracking.
 * Instances are the running/paused/completed executions of workflow definitions.
 *
 */

import type { RuntimeType } from './types';

// =============================================================================
// Instance Status
// =============================================================================

/**
 * Workflow instance status.
 */
export type InstanceStatus =
  | 'pending' // Created but not yet started
  | 'running' // Actively executing a step
  | 'waiting' // Waiting for external event (auto-promoted to cloud)
  | 'sleeping' // In a sleep period (auto-promoted to cloud)
  | 'paused' // Manually paused by user
  | 'completed' // Successfully finished
  | 'failed' // Permanently failed (exhausted retries or non-retryable error)
  | 'cancelled' // Cancelled by user or system
  | 'dead_letter'; // Moved to dead letter queue after permanent failure

// =============================================================================
// Workflow Instance
// =============================================================================

/**
 * Workflow instance - a running/completed execution of a workflow definition.
 */
export interface WorkflowInstance {
  /** Unique instance identifier */
  id: string;

  /** Workflow definition ID */
  workflowId: string;

  /** Workflow version at time of creation */
  workflowVersion: string;

  /** Current status */
  status: InstanceStatus;

  /** Current step name (null if completed/failed) */
  currentStep: string | null;

  /** Current runtime environment */
  runtime: RuntimeType;

  /** Instance state (JSON-serializable, user workflow instance variables) */
  state: WorkflowState;

  /** Trigger event that started this instance */
  triggerEvent: TriggerEventData;

  /** Step execution history */
  history: StepHistory[];

  /** Pending timers (for sleeping/waiting) */
  timers: Timer[];

  /** Events this instance is waiting for */
  waitingForEvents?: string[];

  /** Parent instance ID if this is a child workflow */
  parentInstanceId?: string;

  /** Child instance IDs spawned by this workflow */
  childInstanceIds: string[];

  /** Retry state for current step */
  retryState?: RetryState;

  /** Error information if failed */
  error?: InstanceError;

  /** Cancellation reason if cancelled */
  cancellationReason?: string;

  /** Creation timestamp (ISO 8601) */
  createdAt: string;

  /** Last updated timestamp (ISO 8601) */
  updatedAt: string;

  /** Completion timestamp (ISO 8601) */
  completedAt?: string;

  /** User/system that created this instance */
  createdBy?: string;

  /** Idempotency key for deduplication */
  idempotencyKey?: string;

  /** Tags for filtering/categorization */
  tags?: string[];

  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Workflow state - the user's instance variables.
 * MUST be JSON-serializable (no functions, dates as ISO strings, etc.).
 */
export type WorkflowState = Record<string, JsonSerializable>;

/**
 * JSON-serializable value types.
 */
export type JsonSerializable =
  | string
  | number
  | boolean
  | null
  | JsonSerializable[]
  | { [key: string]: JsonSerializable };

// =============================================================================
// Trigger Event Data
// =============================================================================

/**
 * Data about the event that triggered a workflow instance.
 */
export interface TriggerEventData {
  /** Event type (e.g., "record:created", "schedule", "webhook") */
  type: string;

  /** Timestamp of the trigger (ISO 8601) */
  timestamp: string;

  /** Event payload (varies by trigger type) */
  payload: Record<string, unknown>;
}

/**
 * Record trigger event payload.
 */
export interface RecordTriggerPayload {
  /** Table name */
  table: string;

  /** Record ID */
  recordId: string;

  /** Changed field (for update triggers) */
  field?: string;

  /** Old value (for update triggers) */
  oldValue?: unknown;

  /** New value (for update triggers) */
  newValue?: unknown;

  /** Full record data */
  record?: Record<string, unknown>;
}

/**
 * Schedule trigger event payload.
 */
export interface ScheduleTriggerPayload {
  /** Scheduled time (ISO 8601) */
  scheduledTime: string;

  /** Cron expression */
  cron: string;

  /** Timezone */
  timezone: string;
}

/**
 * Webhook trigger event payload.
 */
export interface WebhookTriggerPayload {
  /** Request path */
  path: string;

  /** HTTP method */
  method: string;

  /** Request headers (filtered for safety) */
  headers: Record<string, string>;

  /** Query parameters */
  query: Record<string, string>;

  /** Request body */
  body: unknown;
}

/**
 * Cell trigger event payload.
 */
export interface CellTriggerPayload {
  /** Sheet name */
  sheet: string;

  /** Cell address (e.g., "A1") */
  cell: string;

  /** Old value */
  oldValue?: unknown;

  /** New value */
  newValue?: unknown;
}

/**
 * Manual trigger event payload.
 */
export interface ManualTriggerPayload {
  /** User input data */
  input: Record<string, unknown>;

  /** User who triggered */
  triggeredBy?: string;
}

/**
 * Spawned workflow trigger payload.
 */
export interface SpawnedTriggerPayload {
  /** Parent workflow ID */
  parentWorkflowId: string;

  /** Parent instance ID */
  parentInstanceId: string;

  /** Input data from parent */
  input: Record<string, unknown>;
}

// =============================================================================
// Step History
// =============================================================================

/**
 * Execution history entry for a step.
 */
export interface StepHistory {
  /** Step name */
  stepName: string;

  /** Step status */
  status: StepStatus;

  /** Attempt number (1-indexed) */
  attempt: number;

  /** Start timestamp (ISO 8601) */
  startedAt: string;

  /** End timestamp (ISO 8601) */
  completedAt?: string;

  /** Duration in milliseconds */
  durationMs?: number;

  /** Runtime where step executed */
  runtime: RuntimeType;

  /** Input data to the step */
  input?: Record<string, unknown>;

  /** Output/result from the step */
  output?: unknown;

  /** Error if step failed */
  error?: StepError;

  /** Next step transitioned to */
  nextStep?: string;

  /** Whether this was a retry attempt */
  isRetry: boolean;
}

/**
 * Step execution status.
 */
export type StepStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped' // Skipped due to workflow control flow
  | 'compensated'; // Compensation ran for this step

/**
 * Step error information.
 */
export interface StepError {
  /** Error type/class */
  type: string;

  /** Error message */
  message: string;

  /** Stack trace (sanitized) */
  stack?: string;

  /** Whether this error is retryable */
  retryable: boolean;

  /** Additional error context */
  context?: Record<string, unknown>;
}

// =============================================================================
// Timer
// =============================================================================

/**
 * Pending timer for a workflow instance.
 */
export interface Timer {
  /** Timer ID */
  id: string;

  /** Timer type */
  type: TimerType;

  /** When the timer fires (ISO 8601) */
  fireAt: string;

  /** Step to resume when timer fires */
  targetStep: string;

  /** Events being waited for (for 'wait_for' timers) */
  waitingForEvents?: string[];

  /** Whether timer has fired */
  fired: boolean;

  /** Timer metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Timer type.
 */
export type TimerType =
  | 'sleep' // ctx.sleep()
  | 'wait_for' // @wait_for timeout
  | 'schedule' // Scheduled execution
  | 'step_timeout'; // Step timeout

// =============================================================================
// Retry State
// =============================================================================

/**
 * Retry state for current step.
 */
export interface RetryState {
  /** Current attempt number (1-indexed) */
  currentAttempt: number;

  /** Maximum attempts allowed */
  maxAttempts: number;

  /** Next retry time (ISO 8601) if waiting to retry */
  nextRetryAt?: string;

  /** History of retry attempts */
  attemptHistory: RetryAttempt[];
}

/**
 * Individual retry attempt record.
 */
export interface RetryAttempt {
  /** Attempt number */
  attempt: number;

  /** When attempt was made (ISO 8601) */
  attemptedAt: string;

  /** Error that caused retry */
  error: StepError;

  /** Delay before next retry (ms) */
  delayMs: number;
}

// =============================================================================
// Instance Error
// =============================================================================

/**
 * Instance-level error information.
 */
export interface InstanceError {
  /** Error type */
  type: InstanceErrorType;

  /** Error message */
  message: string;

  /** Step where error occurred */
  stepName?: string;

  /** Original error details */
  originalError?: StepError;

  /** Timestamp (ISO 8601) */
  occurredAt: string;
}

/**
 * Instance error types.
 */
export type InstanceErrorType =
  | 'step_failed' // Step failed after retries
  | 'step_timeout' // Step timed out
  | 'wait_timeout' // Wait for event timed out (failOnTimeout: true)
  | 'invalid_transition' // Invalid state transition
  | 'serialization_error' // State serialization failed
  | 'promotion_failed' // Failed to promote to cloud
  | 'system_error'; // Internal system error

// =============================================================================
// Instance Query Types
// =============================================================================

/**
 * Options for querying workflow instances.
 */
export interface InstanceQueryOptions {
  /** Filter by workflow ID */
  workflowId?: string;

  /** Filter by workflow class name */
  workflowClass?: string;

  /** Filter by status(es) */
  status?: InstanceStatus | InstanceStatus[];

  /** Filter by runtime */
  runtime?: RuntimeType;

  /** Filter by parent instance */
  parentInstanceId?: string;

  /** Filter by tag */
  tags?: string[];

  /** Custom filter conditions */
  filter?: Record<string, unknown>;

  /** Created after (ISO 8601) */
  createdAfter?: string;

  /** Created before (ISO 8601) */
  createdBefore?: string;

  /** Sort order */
  sort?: InstanceSortOption;

  /** Pagination limit */
  limit?: number;

  /** Pagination offset */
  offset?: number;
}

/**
 * Sort options for instance queries.
 */
export interface InstanceSortOption {
  /** Field to sort by */
  field: 'createdAt' | 'updatedAt' | 'status';

  /** Sort direction */
  direction: 'asc' | 'desc';
}

/**
 * Result of instance query.
 */
export interface InstanceQueryResult {
  /** Matching instances */
  instances: WorkflowInstance[];

  /** Total count (for pagination) */
  total: number;

  /** Whether more results exist */
  hasMore: boolean;
}

// =============================================================================
// Instance Summary (for lists/monitoring)
// =============================================================================

/**
 * Lightweight instance summary for lists and monitoring.
 */
export interface InstanceSummary {
  /** Instance ID */
  id: string;

  /** Workflow ID */
  workflowId: string;

  /** Workflow name */
  workflowName: string;

  /** Current status */
  status: InstanceStatus;

  /** Current step */
  currentStep: string | null;

  /** Runtime */
  runtime: RuntimeType;

  /** Progress (completed steps / total steps) */
  progress?: {
    completed: number;
    total: number;
  };

  /** Created at */
  createdAt: string;

  /** Updated at */
  updatedAt: string;

  /** Has error */
  hasError: boolean;

  /** Brief error message if failed */
  errorMessage?: string;
}
