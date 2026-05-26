/**
 * Per-provider configuration interfaces
 *
 * Typed config for each StorageProviderKind. These use materialization
 * handles (non-secret refs) rather than raw secrets/paths/URLs.
 */

import type { StorageProviderKind, StorageProviderRole } from './provider-kinds';
import type { StorageProviderIdentity } from './provider-identity';

// =============================================================================
// Base
// =============================================================================

export interface StorageProviderConfigBase extends StorageProviderIdentity {
  readonly kind: StorageProviderKind;
  readonly role: StorageProviderRole;
  readonly required: boolean;
}

// =============================================================================
// Memory
// =============================================================================

export interface MemoryProviderConfig extends StorageProviderConfigBase {
  readonly kind: 'memory';
  /** Optional initial state for seeding (e.g. test fixtures). */
  readonly initialStateRef?: string;
  /** Maximum memory budget in bytes before eviction. */
  readonly maxBytes?: number;
}

// =============================================================================
// IndexedDB
// =============================================================================

export interface IndexedDbProviderConfig extends StorageProviderConfigBase {
  readonly kind: 'indexeddb';
  /** Database name within IndexedDB. */
  readonly databaseName: string;
  /** Object store name for document state. */
  readonly storeName: string;
  /** Schema version for IndexedDB upgrade handling. */
  readonly schemaVersion: number;
}

// =============================================================================
// Filesystem
// =============================================================================

export interface FilesystemProviderConfig extends StorageProviderConfigBase {
  readonly kind: 'filesystem';
  /**
   * Materialization handle for the filesystem path.
   * Resolved by the host adapter, never a raw path.
   */
  readonly pathHandle: string;
  /** File format on disk (e.g. 'mog-binary', 'mog-json', 'xlsx'). */
  readonly format: string;
  /** Whether to use atomic write (temp + rename). */
  readonly atomicWrite: boolean;
}

// =============================================================================
// Tauri Sidecar
// =============================================================================

export interface TauriSidecarProviderConfig extends StorageProviderConfigBase {
  readonly kind: 'tauriSidecar';
  /** IPC channel name for communication with the sidecar process. */
  readonly ipcChannel: string;
  /**
   * Materialization handle for the sidecar storage root.
   * Resolved by the Tauri host adapter.
   */
  readonly storageRootHandle: string;
}

// =============================================================================
// Remote API
// =============================================================================

export interface RemoteApiProviderConfig extends StorageProviderConfigBase {
  readonly kind: 'remoteApi';
  /**
   * Materialization handle for the API endpoint.
   * Actual URL is resolved by the host adapter.
   */
  readonly endpointHandle: string;
  /** Authentication credential ref (resolved by host credential store). */
  readonly credentialRef: string;
  /** Protocol variant for the remote API. */
  readonly protocol: 'rest-v1' | 'websocket-v1' | 'grpc-v1';
  /** Reconnect policy on connection loss. */
  readonly reconnectPolicy: 'immediate' | 'exponential-backoff' | 'none';
  /** Maximum reconnect attempts (0 = unlimited). */
  readonly maxReconnectAttempts: number;
}

// =============================================================================
// Object Store
// =============================================================================

export interface ObjectStoreProviderConfig extends StorageProviderConfigBase {
  readonly kind: 'objectStore';
  /**
   * Materialization handle for the object store bucket/container.
   * Actual bucket name + credentials resolved by the host adapter.
   */
  readonly bucketHandle: string;
  /** Key prefix within the bucket. */
  readonly keyPrefix: string;
  /** Object store backend. */
  readonly backend: 's3' | 'gcs' | 'azure-blob' | 'r2';
}

// =============================================================================
// Database Log
// =============================================================================

export interface DatabaseLogProviderConfig extends StorageProviderConfigBase {
  readonly kind: 'databaseLog';
  /**
   * Materialization handle for the database connection.
   * Actual connection string resolved by the host adapter.
   */
  readonly connectionHandle: string;
  /** Table/collection name for the update log. */
  readonly logTable: string;
  /** Database backend. */
  readonly backend: 'postgres' | 'sqlite' | 'dynamodb';
}

// =============================================================================
// Host Callback
// =============================================================================

export interface HostCallbackProviderConfig extends StorageProviderConfigBase {
  readonly kind: 'hostCallback';
  /**
   * Identifier for the host callback registration.
   * The host adapter resolves this to actual save/load callbacks.
   */
  readonly callbackRegistrationId: string;
  /** Whether the host callback supports async operations. */
  readonly asyncCapable: boolean;
}

// =============================================================================
// Read-Only Snapshot
// =============================================================================

export interface ReadOnlySnapshotProviderConfig extends StorageProviderConfigBase {
  readonly kind: 'readOnlySnapshot';
  /**
   * Materialization handle for the snapshot source.
   * Could be a URL ref, file ref, or inline data ref.
   */
  readonly snapshotSourceHandle: string;
  /** Format of the snapshot data. */
  readonly snapshotFormat: 'yrs-update' | 'mog-binary' | 'xlsx' | 'json';
}

// =============================================================================
// Redacted Published Snapshot
// =============================================================================

export interface RedactedPublishedSnapshotProviderConfig extends StorageProviderConfigBase {
  readonly kind: 'redactedPublishedSnapshot';
  /**
   * Materialization handle for the published snapshot source.
   */
  readonly publishedSnapshotHandle: string;
  /** The redaction policy applied to this snapshot. */
  readonly redactionPolicyId: string;
  /** Format of the published snapshot. */
  readonly snapshotFormat: 'yrs-update' | 'mog-binary' | 'json';
}

// =============================================================================
// Test
// =============================================================================

export interface TestProviderConfig extends StorageProviderConfigBase {
  readonly kind: 'test';
  /** Test fixture identifier. */
  readonly fixtureId: string;
  /** Whether to simulate failures for testing. */
  readonly simulateFailures: boolean;
  /** Simulated latency in milliseconds. */
  readonly simulatedLatencyMs: number;
}

// =============================================================================
// Discriminated Union
// =============================================================================

/**
 * Full discriminated union of all per-provider configuration types.
 * Discriminated on the `kind` field.
 */
export type StorageProviderConfig =
  | MemoryProviderConfig
  | IndexedDbProviderConfig
  | FilesystemProviderConfig
  | TauriSidecarProviderConfig
  | RemoteApiProviderConfig
  | ObjectStoreProviderConfig
  | DatabaseLogProviderConfig
  | HostCallbackProviderConfig
  | ReadOnlySnapshotProviderConfig
  | RedactedPublishedSnapshotProviderConfig
  | TestProviderConfig;
