/**
 * Storage provider capabilities
 *
 * Capability flags that describe what a document storage provider
 * can and cannot do. The registry and lifecycle use these to make
 * composition and fallback decisions.
 */

export interface StorageProviderCapabilities {
  // --- Core read/write ---
  /** Provider accepts writes. */
  readonly writable: boolean;
  /** Provider persists data across sessions. */
  readonly durable: boolean;

  // --- Flush semantics ---
  /** flush() can be started synchronously (e.g. IndexedDB putAll). */
  readonly synchronousFlushStart: boolean;

  // --- Checkpoint strategies ---
  /** Supports full-state checkpoint (snapshot save). */
  readonly fullStateCheckpoint: boolean;
  /** Supports incremental update log (append-only journal). */
  readonly incrementalUpdateLog: boolean;
  /** Supports Yrs state-vector diff protocol. */
  readonly yrsStateVectorDiff: boolean;

  // --- Cursor / pagination ---
  /** Provider supports cursor-based reads for large state. */
  readonly storageCursor: boolean;

  // --- Real-time ---
  /** Provider can push change subscriptions. */
  readonly subscriptions: boolean;

  // --- Locking ---
  /** Supports exclusive write lock (prevents concurrent writers). */
  readonly exclusiveWriteLock: boolean;

  // --- Fallback ---
  /** Can fall back to read-only mode when write fails. */
  readonly readOnlyFallback: boolean;

  // --- Offline ---
  /** Can open documents without network connectivity. */
  readonly offlineOpen: boolean;
  /** Can re-establish connection after disconnect. */
  readonly reconnect: boolean;

  // --- Inbound updates ---
  /** Accepts inbound updates from remote sources. */
  readonly inboundUpdates: boolean;
  /** Remote updates are idempotent (safe to replay). */
  readonly idempotentRemoteUpdates: boolean;

  // --- Binary assets ---
  /** Provider can store binary assets (images, files). */
  readonly binaryAssets: boolean;
  /** Assets are content-addressed (dedup by hash). */
  readonly assetContentAddressing: boolean;
  /** Provider can garbage-collect unreferenced assets. */
  readonly assetGarbageCollection: boolean;
  /** Asset writes are atomic with document state. */
  readonly assetAtomicCommit: boolean;

  // --- Batching ---
  /** Supports atomic multi-operation batches. */
  readonly atomicBatch: boolean;
}
