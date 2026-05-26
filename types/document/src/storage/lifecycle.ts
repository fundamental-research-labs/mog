/**
 * Document storage lifecycle types
 *
 * Phase, state, and ready-mode types for the document storage lifecycle.
 */

import type { DocumentDurabilityMode } from './document-provider';

// =============================================================================
// Storage Phase
// =============================================================================

/**
 * All phases a document's storage lifecycle can be in.
 * Transitions are strictly ordered in the lifecycle state machine.
 */
export type DocumentStoragePhase =
  | 'idle'
  | 'validatingStorageHandoff'
  | 'selectingProviders'
  | 'preflightingProviders'
  | 'creatingEngine'
  | 'wiringContext'
  | 'startingBridge'
  | 'installingWriteGate'
  | 'hydratingImport'
  | 'attachingProviders'
  | 'replayingProviderState'
  | 'establishingDurability'
  | 'readyReadWrite'
  | 'readyReadOnly'
  | 'readyEphemeral'
  | 'checkpointing'
  | 'syncing'
  | 'closing'
  | 'destroying'
  | 'closed'
  | 'destroyed'
  | 'error';

// =============================================================================
// Degraded Provider Info
// =============================================================================

/**
 * Information about a provider that has degraded from its configured role.
 */
export interface DegradedProviderInfo {
  readonly providerRefId: string;
  readonly originalRole: string;
  readonly currentRole: string;
  readonly reason: string;
  readonly degradedAt: number;
}

// =============================================================================
// Storage Lifecycle Error
// =============================================================================

/**
 * Structured error from the storage lifecycle.
 */
export interface StorageLifecycleError {
  readonly code: string;
  readonly phase: DocumentStoragePhase;
  readonly providerRefId?: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly timestamp: number;
}

// =============================================================================
// Document Storage State
// =============================================================================

/**
 * Observable state of a document's storage subsystem.
 * Exposed to the UI for status indicators, save state, etc.
 */
export interface DocumentStorageState {
  readonly mode: DocumentDurabilityMode;
  readonly phase: DocumentStoragePhase;
  readonly readOnly: boolean;
  readonly durability: DocumentDurabilityMode;
  readonly pendingUpdatesCount: number;
  readonly lastCheckpointAt: number | null;
  readonly lastSyncAt: number | null;
  readonly degradedProviders: readonly DegradedProviderInfo[];
  readonly errors: readonly StorageLifecycleError[];
}

// =============================================================================
// Lifecycle Transition
// =============================================================================

/**
 * Describes a lifecycle phase transition for diagnostics/logging.
 */
export interface StorageLifecycleTransition {
  readonly from: DocumentStoragePhase;
  readonly to: DocumentStoragePhase;
  readonly trigger: string;
  readonly timestamp: number;
  readonly providerRefId?: string;
  readonly metadata?: Record<string, unknown>;
}

// =============================================================================
// Storage High Water Mark
// =============================================================================

export interface StorageHighWaterMark {
  readonly mark: string;
  readonly capturedAt: number;
  readonly pendingMutationCount: number;
}

// =============================================================================
// Import Durability Result (Track 9)
// =============================================================================

export interface ImportDurabilityResult {
  readonly status: 'durable' | 'skipped' | 'failed';
  readonly checkpointedProviderRefIds: string[];
  readonly highWaterMark?: StorageHighWaterMark;
  readonly failureReason?: string;
}

// =============================================================================
// Checkpoint Result (Track 10)
// =============================================================================

export interface ProviderCheckpointStatus {
  readonly providerRefId: string;
  readonly status: 'committed' | 'skipped' | 'failed';
  readonly failureReason?: string;
}

export interface CheckpointResult {
  readonly status: 'committed' | 'partial' | 'failed';
  readonly highWaterMark: StorageHighWaterMark;
  readonly providerResults: readonly ProviderCheckpointStatus[];
  readonly timestamp: number;
}

// =============================================================================
// Close Result (Track 10)
// =============================================================================

export interface CloseResult {
  readonly status: 'closed' | 'closedWithWarnings' | 'closeFailed';
  readonly finalCheckpoint?: CheckpointResult;
  readonly detachedProviders: readonly string[];
  readonly errors: readonly StorageLifecycleError[];
  readonly timestamp: number;
}
