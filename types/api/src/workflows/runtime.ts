/**
 * Workflow Runtime Contracts
 *
 * Type definitions for the dual-runtime model:
 * - Local Runtime: Browser-based (Pyodide/WebAssembly)
 * - Cloud Runtime: Server-based (Python)
 *
 * Workflows can run in either runtime, with automatic promotion
 * from local to cloud when needed (e.g., wait_for, sleep, schedules).
 *
 */

import type { WorkflowInstance, WorkflowState } from './instance';
import type { RuntimeType } from './types';

export type { RuntimeType };

// =============================================================================
// Runtime Types
// =============================================================================

/**
 * Runtime preference configuration.
 */
export interface RuntimeConfig {
  /** Default runtime for this workflow */
  default: RuntimeType;

  /**
   * Conditions that trigger auto-promotion to cloud.
   * Only relevant when default is 'local' or 'auto'.
   */
  autoPromotionTriggers: AutoPromotionTrigger[];

  /**
   * Maximum time a workflow can run locally before auto-promotion.
   * Prevents local workflows from blocking browser resources.
   */
  maxLocalDurationMs?: number;

  /**
   * Whether to preload Pyodide on page load.
   * If false, loaded on first workflow trigger.
   * Default: false (lazy load)
   */
  preloadPyodide?: boolean;
}

/**
 * Conditions that trigger automatic promotion from local to cloud.
 */
export type AutoPromotionTrigger =
  | 'wait_for' // @wait_for decorator used
  | 'sleep' // ctx.sleep() called
  | 'schedule' // Schedule-triggered workflow
  | 'timeout' // Local duration exceeded
  | 'explicit'; // ctx.promote_to_cloud() called

// =============================================================================
// Promotion State
// =============================================================================

/**
 * State for workflow promotion from local to cloud.
 */
export interface PromotionState {
  /** Whether promotion is in progress */
  inProgress: boolean;

  /** Promotion status */
  status: PromotionStatus;

  /** Step that triggered promotion */
  triggerStep?: string;

  /** Reason for promotion */
  reason?: AutoPromotionTrigger;

  /** Promotion start time (ISO 8601) */
  startedAt?: string;

  /** Promotion completion time (ISO 8601) */
  completedAt?: string;

  /** Error if promotion failed */
  error?: PromotionError;

  /** Cloud instance ID after successful promotion */
  cloudInstanceId?: string;
}

/**
 * Promotion status values.
 */
export type PromotionStatus =
  | 'idle' // Not promoting
  | 'serializing' // Serializing instance state
  | 'uploading' // Uploading to cloud
  | 'confirming' // Waiting for cloud confirmation
  | 'completed' // Successfully promoted
  | 'failed'; // Promotion failed

/**
 * Promotion error information.
 */
export interface PromotionError {
  /** Error type */
  type: PromotionErrorType;

  /** Error message */
  message: string;

  /** Error details */
  details?: Record<string, unknown>;

  /** Whether promotion can be retried */
  retryable: boolean;
}

/**
 * Types of promotion errors.
 */
export type PromotionErrorType =
  | 'serialization_failed' // State serialization failed
  | 'network_error' // Network request failed
  | 'cloud_rejected' // Cloud refused the promotion
  | 'state_too_large' // State exceeds size limit
  | 'version_mismatch' // Workflow version not deployed on cloud
  | 'timeout'; // Promotion timed out

// =============================================================================
// Serialization
// =============================================================================

/**
 * Serialized workflow instance for cross-runtime transfer.
 * MUST be JSON-serializable (no functions, dates as ISO strings, etc.).
 */
export interface SerializedInstance {
  /** Instance ID */
  id: string;

  /** Workflow ID */
  workflowId: string;

  /** Workflow version */
  workflowVersion: string;

  /** Instance state (user's workflow variables) */
  state: WorkflowState;

  /** Current step name */
  currentStep: string;

  /** Source runtime */
  sourceRuntime: RuntimeType;

  /** Serialization timestamp (ISO 8601) */
  serializedAt: string;

  /** Step history (for replay) */
  history: SerializedStepHistory[];

  /** Pending timers */
  timers: SerializedTimer[];

  /** Trigger event data */
  triggerEvent: Record<string, unknown>;

  /** Metadata */
  metadata: SerializedMetadata;

  /** Checksum for integrity verification */
  checksum: string;
}

/**
 * Serialized step history entry.
 */
export interface SerializedStepHistory {
  stepName: string;
  status: string;
  attempt: number;
  startedAt: string;
  completedAt?: string;
  output?: unknown;
  error?: Record<string, unknown>;
}

/**
 * Serialized timer.
 */
export interface SerializedTimer {
  id: string;
  type: string;
  fireAt: string;
  targetStep: string;
  waitingForEvents?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Serialized metadata.
 */
export interface SerializedMetadata {
  /** Parent instance ID if spawned */
  parentInstanceId?: string;

  /** Idempotency key */
  idempotencyKey?: string;

  /** Tags */
  tags?: string[];

  /** Custom metadata */
  custom?: Record<string, unknown>;
}

// =============================================================================
// Runtime Capabilities
// =============================================================================

/**
 * Capabilities available in each runtime.
 */
export interface RuntimeCapabilities {
  /** Runtime type */
  runtime: RuntimeType;

  /** Whether HTTP requests are supported */
  http: boolean;

  /** Whether notifications are supported */
  notifications: boolean;

  /** Whether secrets access is supported */
  secrets: boolean;

  /** Whether spawning child workflows is supported */
  spawnWorkflows: boolean;

  /** Whether sleeping is supported */
  sleep: boolean;

  /** Whether wait_for is supported */
  waitFor: boolean;

  /** Maximum execution time (ms) */
  maxExecutionTime: number | null;

  /** Maximum state size (bytes) */
  maxStateSize: number;

  /** Available Python packages */
  availablePackages: string[];
}

// =============================================================================
// Runtime Interface
// =============================================================================

/**
 * Interface for workflow runtime implementations.
 */
export interface IWorkflowRuntime {
  /** Runtime type */
  readonly type: RuntimeType;

  /** Runtime capabilities */
  readonly capabilities: RuntimeCapabilities;

  /** Whether runtime is ready */
  isReady(): boolean;

  /** Initialize runtime (e.g., load Pyodide) */
  initialize(): Promise<void>;

  /** Execute a workflow step */
  executeStep(
    instance: WorkflowInstance,
    stepName: string,
    input: Record<string, unknown>,
  ): Promise<StepExecutionResult>;

  /** Serialize instance for promotion */
  serializeInstance(instance: WorkflowInstance): SerializedInstance;

  /** Deserialize instance from promotion */
  deserializeInstance(serialized: SerializedInstance): WorkflowInstance;

  /** Validate state is serializable */
  validateState(state: WorkflowState): StateValidationResult;
}

/**
 * Result of step execution.
 */
export interface StepExecutionResult {
  /** Whether step completed successfully */
  success: boolean;

  /** Next step to transition to (null if completed) */
  nextStep: string | null;

  /** Updated instance state */
  state: WorkflowState;

  /** Step output/return value */
  output?: unknown;

  /** Error if step failed */
  error?: {
    type: string;
    message: string;
    retryable: boolean;
  };

  /** Whether promotion was requested */
  promotionRequested: boolean;

  /** Promotion reason if requested */
  promotionReason?: AutoPromotionTrigger;

  /** Timer to create (for sleep/wait_for) */
  timer?: {
    type: 'sleep' | 'wait_for';
    fireAt: string;
    targetStep: string;
    waitingForEvents?: string[];
  };

  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Result of state validation.
 */
export interface StateValidationResult {
  /** Whether state is valid */
  valid: boolean;

  /** Validation errors */
  errors: StateValidationError[];

  /** State size in bytes */
  sizeBytes: number;
}

/**
 * State validation error.
 */
export interface StateValidationError {
  /** Path to invalid field (e.g., "deal.connection") */
  path: string;

  /** Error message */
  message: string;

  /** Invalid value (may be truncated) */
  value?: string;
}

// =============================================================================
// Pyodide-Specific Types (Local Runtime)
// =============================================================================

/**
 * Pyodide loading state.
 */
export interface PyodideState {
  /** Whether Pyodide is loaded */
  loaded: boolean;

  /** Whether Pyodide is loading */
  loading: boolean;

  /** Load error if any */
  error?: string;

  /** Load start time (ISO 8601) */
  loadStartedAt?: string;

  /** Load completion time (ISO 8601) */
  loadCompletedAt?: string;

  /** Load duration in milliseconds */
  loadDurationMs?: number;

  /** Pyodide version */
  version?: string;
}

/**
 * Pyodide configuration.
 */
export interface PyodideConfig {
  /** CDN URL for Pyodide */
  cdnUrl: string;

  /** Index URL for packages */
  indexUrl?: string;

  /** Packages to preload */
  preloadPackages?: string[];

  /** Whether to load micropip */
  loadMicropip?: boolean;

  /** Memory limit in bytes */
  memoryLimit?: number;
}
