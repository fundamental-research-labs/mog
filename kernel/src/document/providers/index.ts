/**
 * Provider Protocol — public surface.
 *
 * The orchestrator (RustDocument) and Provider implementations
 * (IndexedDB, Tauri, future websocket/headless) consume this module.
 *
 * @see provider.ts
 */

export type {
  DocumentByteSyncPort,
  Provider,
  ProviderDoc,
  ProviderDocApplyUpdateResult,
  ProviderDocApplyUpdateReturn,
  ProviderAttachMode,
  ProviderAttachReturn,
  ProviderCheckpointMode,
  ProviderCheckpointReturn,
} from './provider';

// IndexedDB backend — Provider + sibling Meta API. Both share one
// schema (indexeddb-schema.ts) but live as distinct modules per §5.1.1
// (Meta API is NOT a Provider).
export {
  IndexedDBProvider,
  hasPersistedSnapshot,
  createIndexedDbProviderFactory,
} from './indexeddb-provider';
export type {
  IndexedDBProviderOptions,
  IndexedDBProviderTestOptions,
  IndexedDbProviderInstance,
} from './indexeddb-provider';
export { readMeta, touchDoc, forgetDoc, clearMeta, emptyMeta } from './indexeddb-meta';
export type { MetaState, RecentDoc } from './indexeddb-meta';

// Memory provider (the storage provider lifecycle — deterministic in-memory, no durability).
export {
  MemoryProvider,
  createMemoryProviderFactory,
  createMemoryRegistryFactory,
  clearMemoryProviderDefaultStorage,
} from './memory-provider';
export type { MemoryProviderOptions, MemoryProviderStorage } from './memory-provider';

// Filesystem provider (the storage provider lifecycle — durable local storage for the SDK Node entry).
export { FilesystemProvider, createFilesystemProviderFactory } from './filesystem-provider';
export type { FilesystemProviderOptions } from './filesystem-provider';

// Test provider (the storage provider lifecycle — failure injection subclass of MemoryProvider).
export {
  TestProvider,
  createTestProviderFactory,
  createTestRegistryFactory,
} from './test-provider';
export type {
  TestProviderOptions,
  TestProviderFailureOperation,
  TestProviderLatencyOperation,
} from './test-provider';

// Host-callback provider (the storage provider lifecycle — delegates persistence to host callbacks).
export {
  HostCallbackProvider,
  createHostCallbackProviderFactory,
  createHostCallbackRegistryFactory,
} from './host-callback-provider';
export type { HostCallbackRegistry } from './host-callback-provider';

// Read-only snapshot provider (the storage provider lifecycle — loads a snapshot once, never writes).
export {
  ReadOnlySnapshotProvider,
  createReadOnlySnapshotProviderFactory,
  createReadOnlySnapshotRegistryFactory,
} from './read-only-snapshot-provider';
export type { SnapshotResolver } from './read-only-snapshot-provider';

// Redacted published snapshot provider (the storage provider lifecycle — published content with redaction).
export {
  RedactedPublishedSnapshotProvider,
  createRedactedPublishedSnapshotProviderFactory,
  createRedactedPublishedSnapshotRegistryFactory,
} from './redacted-published-snapshot-provider';
export type {
  PublishedSnapshotResolver,
  PublishedSnapshotResult,
} from './redacted-published-snapshot-provider';

// Object store provider (the storage provider lifecycle — cloud object-store backend stub).
export {
  ObjectStoreProvider,
  createObjectStoreProviderFactory,
  createObjectStoreRegistryFactory,
  clearObjectStoreProviderDefaultStorage,
} from './object-store-provider';
export type {
  ObjectStoreProviderOptions,
  ObjectStoreProviderStorage,
} from './object-store-provider';

// Database log provider (the storage provider lifecycle — database-backed update log stub).
export {
  DatabaseLogProvider,
  createDatabaseLogProviderFactory,
  createDatabaseLogRegistryFactory,
  clearDatabaseLogProviderDefaultStorage,
} from './database-log-provider';

// Registry + composition validator (the storage provider lifecycle).
export { StorageProviderRegistry, type ProviderPreflightResult } from './registry';
export type { ProviderFactory, ProviderInstance } from './factory';
export { validateComposition, determineReadyMode } from './composition-validator';
export type {
  DatabaseLogProviderOptions,
  DatabaseLogProviderStorage,
} from './database-log-provider';

// Storage state tracking (storage state conformance).
export {
  StorageState,
  type StorageStateSnapshot,
  type StorageError as ProviderStorageError,
} from './storage-state';
