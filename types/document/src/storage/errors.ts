/**
 * Storage error types
 *
 * Structured error types for the document storage lifecycle.
 * Each error category has a stable code prefix, phase context,
 * and retryability indicator.
 *
 * These are PURE TYPE declarations. Runtime error classes live in kernel.
 */

import type { DocumentStoragePhase } from './lifecycle';

// =============================================================================
// Error Category
// =============================================================================

/**
 * Top-level category for storage errors. Maps to stable code prefixes.
 */
export type StorageErrorCategory =
  | 'authorization'
  | 'configuration'
  | 'lock'
  | 'durability'
  | 'replay'
  | 'sync'
  | 'quota'
  | 'policy'
  | 'implementation';

// =============================================================================
// Error Severity
// =============================================================================

export type StorageErrorSeverity = 'fatal' | 'degraded' | 'transient' | 'warning';

// =============================================================================
// Base Error Shape
// =============================================================================

/**
 * Shape shared by all structured storage errors.
 */
export interface StorageErrorBase {
  /** Stable machine-readable error code (e.g. 'STORAGE_AUTH_001'). */
  readonly code: string;
  /** Error category for routing/grouping. */
  readonly category: StorageErrorCategory;
  /** Lifecycle phase when the error occurred. */
  readonly phase: DocumentStoragePhase;
  /** Human-readable description. */
  readonly message: string;
  /** Whether a retry may succeed. */
  readonly retryable: boolean;
  /** Error severity. */
  readonly severity: StorageErrorSeverity;
  /** Provider that caused the error, if applicable. */
  readonly providerRefId?: string;
  /** Timestamp of the error. */
  readonly timestamp: number;
}

// =============================================================================
// Per-Category Error Types
// =============================================================================

export interface StorageAuthorizationError extends StorageErrorBase {
  readonly category: 'authorization';
  /** The operation that was denied. */
  readonly deniedOperation: string;
  /** Reason for the denial. */
  readonly denialReason: string;
}

export interface StorageConfigurationError extends StorageErrorBase {
  readonly category: 'configuration';
  /** The config field that is invalid. */
  readonly invalidField?: string;
  /** Expected value or constraint. */
  readonly expected?: string;
  /** Actual value found. */
  readonly actual?: string;
}

export interface StorageLockError extends StorageErrorBase {
  readonly category: 'lock';
  /** The lock that could not be acquired. */
  readonly lockId?: string;
  /** Current lock holder, if known. */
  readonly currentHolder?: string;
  /** Time until lock may become available. */
  readonly retryAfterMs?: number;
}

export interface StorageDurabilityError extends StorageErrorBase {
  readonly category: 'durability';
  /** The durability level that could not be achieved. */
  readonly requiredDurability: string;
  /** The durability level actually achieved. */
  readonly achievedDurability?: string;
  /** Number of pending updates that are at risk. */
  readonly pendingUpdatesAtRisk: number;
}

export interface StorageReplayError extends StorageErrorBase {
  readonly category: 'replay';
  /** Sequence number where replay failed. */
  readonly failedAtSequence?: number;
  /** Total updates to replay. */
  readonly totalUpdates?: number;
  /** Whether partial replay was applied. */
  readonly partiallyApplied: boolean;
}

export interface StorageSyncError extends StorageErrorBase {
  readonly category: 'sync';
  /** Remote endpoint that failed. */
  readonly remoteEndpoint?: string;
  /** HTTP status code, if applicable. */
  readonly httpStatus?: number;
  /** Number of sync attempts so far. */
  readonly attemptCount: number;
  /** Next retry timestamp, if scheduled. */
  readonly nextRetryAt?: number;
}

export interface StorageQuotaError extends StorageErrorBase {
  readonly category: 'quota';
  /** Quota limit in bytes. */
  readonly limitBytes: number;
  /** Current usage in bytes. */
  readonly usageBytes: number;
  /** Resource that exceeded quota. */
  readonly resource: 'document' | 'assets' | 'total';
}

export interface StoragePolicyError extends StorageErrorBase {
  readonly category: 'policy';
  /** The policy that was violated. */
  readonly policyId: string;
  /** Description of the violation. */
  readonly violation: string;
}

export interface StorageImplementationError extends StorageErrorBase {
  readonly category: 'implementation';
  /** The internal operation that failed. */
  readonly internalOperation: string;
  /** Stack trace or diagnostic info (redacted in production). */
  readonly diagnosticInfo?: string;
}

// =============================================================================
// Discriminated Union
// =============================================================================

/**
 * Union of all structured storage errors.
 * Discriminated on the `category` field.
 */
export type StorageError =
  | StorageAuthorizationError
  | StorageConfigurationError
  | StorageLockError
  | StorageDurabilityError
  | StorageReplayError
  | StorageSyncError
  | StorageQuotaError
  | StoragePolicyError
  | StorageImplementationError;
