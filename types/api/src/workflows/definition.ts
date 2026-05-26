/**
 * Workflow Definition Contracts
 *
 * Type definitions for workflow and step declarations.
 * These types map to Python decorators (@workflow, @step, @wait_for, @retry, @parallel).
 *
 */

import type { RuntimeType } from './runtime';
import type { TriggerConfig } from './triggers';
import type { MigrationFunction, VersioningStrategy } from './versioning';

// =============================================================================
// Workflow Definition
// =============================================================================

/**
 * Complete workflow definition.
 * Represents a workflow class decorated with @workflow.
 */
export interface WorkflowDefinition {
  /** Unique workflow identifier (derived from class name) */
  id: string;

  /** Human-readable workflow name */
  name: string;

  /** Workflow description (from docstring) */
  description?: string;

  /** Semantic version (e.g., "1.0.0") */
  version: string;

  /** Trigger configuration */
  trigger: TriggerConfig;

  /** Runtime preference */
  runtime: RuntimeType;

  /** Versioning strategy for handling version upgrades */
  versioningStrategy: VersioningStrategy;

  /** Migration function name for 'migrate' strategy */
  migrationFn?: MigrationFunction;

  /** Idempotency key expression (e.g., "event.recordId") */
  idempotencyKey?: string;

  /** Step definitions in this workflow */
  steps: StepDefinition[];

  /** Tags for categorization/filtering */
  tags?: string[];

  /** Workflow metadata */
  metadata?: WorkflowMetadata;
}

/**
 * Workflow metadata for additional information.
 */
export interface WorkflowMetadata {
  /** Author or owner */
  author?: string;

  /** Creation timestamp */
  createdAt?: string;

  /** Last modified timestamp */
  updatedAt?: string;

  /** Source file path */
  sourcePath?: string;

  /** Custom metadata */
  custom?: Record<string, unknown>;
}

// =============================================================================
// Step Definition
// =============================================================================

/**
 * Step definition within a workflow.
 * Represents a method decorated with @step.
 */
export interface StepDefinition {
  /** Step name (method name) */
  name: string;

  /** Step description */
  description?: string;

  /** Whether this is the entry step */
  isEntryStep: boolean;

  /** Wait configuration if decorated with @wait_for */
  waitFor?: WaitForConfig;

  /** Retry configuration if decorated with @retry */
  retry?: RetryConfig;

  /** Parallel execution config if decorated with @parallel */
  parallel?: ParallelConfig;

  /** Timeout for this step (ISO 8601 duration or milliseconds) */
  timeout?: string | number;

  /** Compensation step to run on failure/cancellation */
  compensationStep?: string;
}

// =============================================================================
// Wait For Configuration
// =============================================================================

/**
 * Configuration for @wait_for decorator.
 * Triggers auto-promotion to cloud runtime.
 */
export interface WaitForConfig {
  /** Event types to wait for */
  events: string[];

  /**
   * Timeout duration.
   * Supports formats: "7d", "24h", "30m", "1w", or ISO 8601 duration.
   */
  timeout: string;

  /**
   * Whether to fail on timeout (default: false, returns null event).
   */
  failOnTimeout?: boolean;
}

// =============================================================================
// Retry Configuration
// =============================================================================

/**
 * Backoff strategy for retries.
 */
export type BackoffStrategy = 'fixed' | 'linear' | 'exponential';

/**
 * Configuration for @retry decorator.
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxAttempts: number;

  /** Backoff strategy */
  backoff: BackoffStrategy;

  /**
   * Initial delay between retries.
   * Supports formats: "1s", "100ms", "1m".
   */
  initialDelay: string;

  /**
   * Maximum delay between retries.
   * Supports formats: "1m", "5m", "1h".
   */
  maxDelay: string;

  /**
   * Multiplier for exponential/linear backoff (default: 2).
   */
  multiplier?: number;

  /**
   * Add jitter to delays to prevent thundering herd (default: true).
   */
  jitter?: boolean;

  /**
   * Exception types that should NOT trigger retry.
   */
  nonRetryableExceptions?: string[];
}

// =============================================================================
// Parallel Configuration
// =============================================================================

/**
 * Configuration for @parallel decorator.
 */
export interface ParallelConfig {
  /** Maximum concurrent executions */
  maxConcurrency: number;

  /**
   * Whether to continue on individual failures (default: false).
   * If true, collects all results including errors.
   * If false, fails entire parallel block on first error.
   */
  continueOnFailure?: boolean;

  /**
   * Timeout for entire parallel execution.
   */
  timeout?: string;
}

// =============================================================================
// Error Types
// =============================================================================

/**
 * Retryable error - signals the step should be retried.
 */
export interface RetryableError {
  type: 'RetryableError';
  message: string;
  /** Original error if wrapping another error */
  cause?: unknown;
}

/**
 * Non-retryable error - signals the step should fail immediately.
 */
export interface NonRetryableError {
  type: 'NonRetryableError';
  message: string;
  /** Original error if wrapping another error */
  cause?: unknown;
}

/**
 * Workflow error union type.
 */
export type WorkflowError = RetryableError | NonRetryableError;

// =============================================================================
// Workflow Decorator Options (TypeScript representation)
// =============================================================================

/**
 * Options for @workflow decorator.
 * Maps to Python decorator parameters.
 */
export interface WorkflowDecoratorOptions {
  /** Trigger type */
  trigger: string;

  /** Table name for record triggers */
  table?: string;

  /** Field name for field-specific triggers */
  field?: string;

  /** Field value for value-specific triggers */
  value?: unknown;

  /** Cron expression for schedule triggers */
  cron?: string;

  /** Timezone for schedule triggers */
  timezone?: string;

  /** Webhook path for webhook triggers */
  path?: string;

  /** HTTP method for webhook triggers */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';

  /** Runtime preference */
  runtime?: RuntimeType;

  /** Idempotency key expression */
  idempotencyKey?: string;

  /** Workflow version */
  version?: string;

  /** Versioning strategy */
  versioningStrategy?: VersioningStrategy;

  /** Sheet name for cell triggers */
  sheet?: string;

  /** Range for cell triggers (e.g., "B2:B100") */
  range?: string;

  /** Column name for relation triggers */
  column?: string;
}

/**
 * Options for @step decorator.
 */
export interface StepDecoratorOptions {
  /** Step description */
  description?: string;

  /** Timeout for this step */
  timeout?: string | number;

  /** Compensation step name */
  compensation?: string;
}

/**
 * Options for @wait_for decorator.
 */
export interface WaitForDecoratorOptions {
  /** Event types to wait for */
  events: string | string[];

  /** Timeout duration */
  timeout: string;

  /** Whether to fail on timeout */
  failOnTimeout?: boolean;
}

/**
 * Options for @retry decorator.
 */
export interface RetryDecoratorOptions {
  /** Maximum attempts (default: 3) */
  maxAttempts?: number;

  /** Backoff strategy (default: 'exponential') */
  backoff?: BackoffStrategy;

  /** Initial delay (default: '1s') */
  initialDelay?: string;

  /** Maximum delay (default: '1m') */
  maxDelay?: string;

  /** Backoff multiplier */
  multiplier?: number;

  /** Add jitter to delays */
  jitter?: boolean;
}

/**
 * Options for @parallel decorator.
 */
export interface ParallelDecoratorOptions {
  /** Maximum concurrency (default: 10) */
  maxConcurrency?: number;

  /** Continue on individual failures */
  continueOnFailure?: boolean;

  /** Timeout for parallel execution */
  timeout?: string;
}
