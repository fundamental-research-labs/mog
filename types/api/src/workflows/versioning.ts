/**
 * Workflow Versioning Contracts
 *
 * Type definitions for workflow versioning and migration.
 * Versioning is critical for durable workflows because instances
 * may run for days/weeks while the workflow code is updated.
 *
 * Strategies:
 * - replace: New instances use new code, running instances use old code
 * - parallel: Both versions run independently
 * - migrate: Running instances are migrated to new version
 *
 */

import type { WorkflowState } from './instance';

// =============================================================================
// Versioning Strategy
// =============================================================================

/**
 * Strategy for handling workflow version upgrades.
 */
export type VersioningStrategy = 'replace' | 'parallel' | 'migrate';

/**
 * Detailed versioning strategy configuration.
 */
export interface VersioningConfig {
  /** Strategy type */
  strategy: VersioningStrategy;

  /**
   * For 'replace' strategy: how long to keep old version active
   * for running instances (default: until all instances complete)
   */
  gracePeriod?: string;

  /**
   * For 'parallel' strategy: which version is default for new triggers
   */
  defaultVersion?: 'latest' | 'previous' | string;

  /**
   * For 'migrate' strategy: migration function reference
   */
  migration?: MigrationConfig;
}

// =============================================================================
// Migration
// =============================================================================

/**
 * Reference to a migration function.
 */
export type MigrationFunction = string;

/**
 * Migration configuration for 'migrate' strategy.
 */
export interface MigrationConfig {
  /** Migration function name (class method) */
  functionName: string;

  /**
   * Whether to migrate immediately or lazily.
   * - 'immediate': Migrate all running instances when new version deploys
   * - 'lazy': Migrate each instance when it next needs to execute
   * Default: 'lazy'
   */
  timing: 'immediate' | 'lazy';

  /**
   * Whether migration is reversible.
   * If true, must also provide rollback function.
   */
  reversible: boolean;

  /** Rollback function name (required if reversible: true) */
  rollbackFunctionName?: string;

  /**
   * Maximum instances to migrate in parallel.
   * Only relevant for 'immediate' timing.
   * Default: 10
   */
  batchSize?: number;

  /**
   * Timeout for individual migration (ISO 8601 duration).
   * Default: '5m'
   */
  timeout?: string;
}

/**
 * Migration operation (runtime).
 */
export interface MigrationOperation {
  /** Migration ID */
  id: string;

  /** Source version */
  fromVersion: string;

  /** Target version */
  toVersion: string;

  /** Migration status */
  status: MigrationStatus;

  /** Instances to migrate */
  totalInstances: number;

  /** Instances migrated successfully */
  migratedInstances: number;

  /** Instances that failed migration */
  failedInstances: number;

  /** Start time (ISO 8601) */
  startedAt: string;

  /** Completion time (ISO 8601) */
  completedAt?: string;

  /** Failed instance details */
  failures?: MigrationFailure[];
}

/**
 * Migration status.
 */
export type MigrationStatus =
  | 'pending' // Not started
  | 'in_progress' // Currently migrating
  | 'completed' // All instances migrated
  | 'failed' // Migration failed (some instances not migrated)
  | 'rolled_back'; // Migration was rolled back

/**
 * Migration failure details.
 */
export interface MigrationFailure {
  /** Instance ID */
  instanceId: string;

  /** Error message */
  error: string;

  /** Old state (before migration attempt) */
  oldState?: WorkflowState;

  /** Whether rollback was applied */
  rolledBack: boolean;

  /** Timestamp */
  timestamp: string;
}

// =============================================================================
// Version Info
// =============================================================================

/**
 * Workflow version information.
 */
export interface WorkflowVersion {
  /** Version string (semantic versioning) */
  version: string;

  /** Workflow ID */
  workflowId: string;

  /** Whether this version is active (accepting new triggers) */
  active: boolean;

  /** Whether this version is deprecated */
  deprecated: boolean;

  /** Deprecation message if deprecated */
  deprecationMessage?: string;

  /** Number of running instances on this version */
  runningInstances: number;

  /** Deployment timestamp (ISO 8601) */
  deployedAt: string;

  /** Deployment user/system */
  deployedBy?: string;

  /** Version metadata */
  metadata?: VersionMetadata;
}

/**
 * Version metadata.
 */
export interface VersionMetadata {
  /** Git commit hash */
  commitHash?: string;

  /** Git branch */
  branch?: string;

  /** Change description */
  description?: string;

  /** Breaking changes from previous version */
  breakingChanges?: string[];

  /** Migration notes */
  migrationNotes?: string;
}

// =============================================================================
// Version Comparison
// =============================================================================

/**
 * Semantic version components.
 */
export interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  build?: string;
}

// =============================================================================
// Version Registry
// =============================================================================

/**
 * Interface for workflow version registry.
 */
export interface IVersionRegistry {
  /**
   * Register a new workflow version.
   */
  register(workflowId: string, version: string, metadata?: VersionMetadata): Promise<void>;

  /**
   * Get all versions for a workflow.
   */
  getVersions(workflowId: string): Promise<WorkflowVersion[]>;

  /**
   * Get the latest active version.
   */
  getLatestVersion(workflowId: string): Promise<WorkflowVersion | null>;

  /**
   * Get a specific version.
   */
  getVersion(workflowId: string, version: string): Promise<WorkflowVersion | null>;

  /**
   * Activate a version (make it accept new triggers).
   */
  activateVersion(workflowId: string, version: string): Promise<void>;

  /**
   * Deactivate a version (stop accepting new triggers).
   */
  deactivateVersion(workflowId: string, version: string): Promise<void>;

  /**
   * Deprecate a version with a message.
   */
  deprecateVersion(workflowId: string, version: string, message: string): Promise<void>;

  /**
   * Get running instances count for a version.
   */
  getRunningInstanceCount(workflowId: string, version: string): Promise<number>;
}

// =============================================================================
// State Migration Types
// =============================================================================

/**
 * State migration result.
 */
export interface StateMigrationResult {
  /** Whether migration succeeded */
  success: boolean;

  /** New state after migration */
  newState?: WorkflowState;

  /** Error if migration failed */
  error?: string;

  /** Warnings during migration */
  warnings?: string[];

  /** Fields that were added */
  addedFields?: string[];

  /** Fields that were removed */
  removedFields?: string[];

  /** Fields that were transformed */
  transformedFields?: string[];
}

/**
 * State migration context provided to migration functions.
 */
export interface MigrationContext {
  /** Source version */
  fromVersion: string;

  /** Target version */
  toVersion: string;

  /** Old state (read-only) */
  oldState: Readonly<WorkflowState>;

  /** Instance ID */
  instanceId: string;

  /** Current step at time of migration */
  currentStep: string;

  /** Helper: Deep clone a value */
  clone<T>(value: T): T;

  /** Helper: Log a warning */
  warn(message: string): void;

  /** Helper: Get current time */
  now(): Date;
}
