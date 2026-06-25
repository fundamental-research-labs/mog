/**
 * Provider Protocol, normalized for the storage provider lifecycle
 *
 * The Provider interface is the single contract every yrs-update transport
 * implements (IndexedDB, Tauri-file, future websocket-collab, future
 * headless-server). The orchestrator (`RustDocument`) holds an N-element
 * `Provider[]` and fans every `update_v1` it sees out to every Provider via
 * `appendUpdate`. Providers persist / forward those bytes; on reattach they
 * replay them into a `ProviderDoc`.
 *
 * Designing the protocol up front — instead of treating IndexedDB as a special
 * case — means future transports plug in by "implement Provider, pass
 * conformance, attach via `documentManager`." Zero `RustDocument` changes.
 *
 * the storage provider lifecycle additions: optional `getCapabilities()`, `getIdentity()`, and
 * `storageCursor()` methods. These are optional on the interface so that
 * existing providers continue to conform without changes.
 *
 */

import type { StorageProviderCapabilities } from '@mog-sdk/types-document/storage/provider-capabilities';
import type { StorageProviderIdentity } from '@mog-sdk/types-document/storage/provider-identity';
import type {
  ProviderInboundUpdateEnvelopeV2,
  SyncUpdateProvenance,
  SyncUpdateValidationDiagnostic,
} from '@mog-sdk/types-document/storage';
import type {
  MutationResult,
  SyncApplyMutationMetadataWire,
} from '../../bridges/compute/compute-types.gen';

/**
 * The transport-side interface: persistence, replication, or both.
 *
 * Lifecycle:
 *   1. Construct (transport-specific, e.g. `new IndexedDBProvider(docId)`).
 *   2. `attach(doc)` — replay any persisted bytes into `doc.applyUpdate`,
 *      then resolve. After this the Provider is live and the orchestrator
 *      will start calling `appendUpdate` for every yrs `update_v1`.
 *   3. `appendUpdate(update)` — sync, fire-and-forget. The Provider must
 *      enqueue and return; never throw, never block.
 *   4. `flush()` — async checkpoint barrier. Orchestrator awaits before
 *      compaction or before treating "saved" as a user-visible state.
 *   5. `flushSync()` — sync-start variant for unload handlers
 *      (`visibilitychange → hidden`, `pagehide`). Implementation must start
 *      a durable write tx before returning, so the browser can drain it
 *      during page death.
 *   6. `detach()` — final-flush + cleanup. Idempotent.
 *
 * Ordering / reentrancy / backpressure guarantees from the orchestrator
 * (§3.3) — providers may rely on these:
 *   - `appendUpdate` is called in FIFO order matching yrs emission.
 *   - No batch interleaving: an `appendUpdate` triggered while the
 *     orchestrator is already fanning out lands in the *next* microtask
 *     batch, never the current one.
 *   - The orchestrator absorbs slow downstreams; `appendUpdate` always
 *     returns synchronously even when a `flush()` is in flight.
 */
export interface Provider {
  /** Stable name for diagnostics + telemetry. */
  readonly name: string;

  /**
   * Attach to a doc. Implementation must:
   *   1. Read any persisted bytes for `doc.docId`.
   *   2. `await doc.applyUpdate(bytes)` for each (or one merged) update.
   *   3. Resolve.
   *
   * After this, the orchestrator begins calling `appendUpdate`.
   */
  attach(doc: ProviderDoc, mode?: ProviderAttachMode): Promise<ProviderAttachReturn>;

  /**
   * Enqueue a yrs `update_v1` for durable write / forward.
   *
   * Sync, fire-and-forget. Must return synchronously even when a previous
   * `flush()` is still in flight. Must not throw.
   */
  appendUpdate(update: Uint8Array): void;

  /**
   * Await all pending writes (durable commit). Called at checkpoint
   * boundaries (compaction, explicit save, before `detach`).
   */
  flush(): Promise<void>;

  /**
   * Persist the current full authoritative doc state as a checkpoint.
   *
   * Providers must first account for their local pending append queue, then
   * write a state that can hydrate the document by itself. Log-based
   * Providers may fold represented updates into the checkpoint, but must not
   * delete updates that are not represented by the encoded full state.
   */
  checkpointFullState(
    doc: ProviderDoc,
    mode?: ProviderCheckpointMode,
  ): Promise<ProviderCheckpointReturn>;

  /**
   * Synchronous-start flush for unload handlers. Returns once the writes are
   * queued in a tx the browser will continue to drain during unload, not
   * when the tx commits.
   *
   * MUST NOT throw; if the underlying tx open fails (db locked, quota
   * exceeded, schema mid-migration), set `flushFailed` and return.
   *
   * Idempotent: a second call with an empty `pendingUpdates` queue is a
   * no-op (orchestrator may invoke from both `visibilitychange → hidden`
   * and `pagehide` in the same lifecycle).
   */
  flushSync(): void;

  /**
   * Final-flush + cleanup. Idempotent — a second `detach` is a no-op.
   */
  detach(): Promise<void>;

  /**
   * Provider's view of persisted state. Used for diff requests in
   * future websocket and headless transports.
   *
   * @deprecated the storage provider lifecycle renames this to `storageCursor()` for providers
   * that report a storage diagnostic (not a real Yrs state vector).
   * Providers that implement actual Yrs diff sync should advertise
   * `yrsStateVectorDiff: true` in their capabilities.
   */
  stateVector(): Promise<Uint8Array>;

  /**
   * Storage-diagnostic cursor. Reports a provider-specific opaque token
   * that changes whenever persisted state changes. Unlike `stateVector()`,
   * this name does not imply Yrs diff-sync capability.
   *
   * Optional — providers that implement this should also report
   * `storageCursor: true` in their capabilities. Falls back to
   * `stateVector()` for providers that haven't adopted the storage provider lifecycle yet.
   */
  storageCursor?(): Promise<Uint8Array>;

  /**
   * Report this provider's capability flags (the storage provider lifecycle).
   * Optional — providers that haven't adopted the storage provider lifecycle yet omit this.
   */
  getCapabilities?(): StorageProviderCapabilities;

  /**
   * Report this provider's identity (the storage provider lifecycle).
   * Optional — providers that haven't adopted the storage provider lifecycle yet omit this.
   */
  getIdentity?(): StorageProviderIdentity;

  /**
   * `true` iff the most recent `flushSync()` could not start a durable
   * write tx. Read by the shell `beforeunload` handler when deciding
   * whether to prompt "leave site? you have unsaved work."
   *
   * (Lives on the Provider, not on the doc, because failure is per-
   * transport: an IndexedDB quota error and a websocket disconnect are
   * unrelated states.)
   */
  readonly flushFailed: boolean;

  /**
   * `true` when this Provider is in read-only mode — e.g. because another
   * tab already holds the Web Lock for this docId (§7 Q1). In read-only
   * mode `appendUpdate` and `flushSync` are no-ops; the doc content is
   * replayed from IDB as normal (read side works, write side is blocked).
   *
   * Optional: Providers that do not implement Web Locks simply omit this
   * property (treated as `false` by consumers).
   */
  readonly readOnly?: boolean;
}

export type ProviderAttachMode =
  | { kind: 'normal' }
  | { kind: 'createFresh'; replaceExisting: boolean }
  | { kind: 'importInitialize'; replaceExisting: boolean };

export type ProviderCheckpointMode = { kind: 'normal' } | { kind: 'importInitialize' };

export type ProviderAttachResult =
  | {
      readonly status: 'ready';
      readonly mode: ProviderAttachMode['kind'];
      readonly readOnly?: boolean;
    }
  | {
      readonly status: 'blocked';
      readonly mode: ProviderAttachMode['kind'];
      readonly reason: 'readOnly' | 'detached' | 'alreadyAttached' | 'unavailable';
      readonly message?: string;
    };

export type ProviderCheckpointResult =
  | {
      readonly status: 'committed';
      readonly mode: ProviderCheckpointMode['kind'];
    }
  | {
      readonly status: 'blocked';
      readonly mode: ProviderCheckpointMode['kind'];
      readonly reason: 'readOnly' | 'detached' | 'notAttached' | 'unavailable';
      readonly message?: string;
    };

export type ProviderAttachReturn = ProviderAttachResult | void;
export type ProviderCheckpointReturn = ProviderCheckpointResult | void;

export type SyncUpdateAdmissionSource =
  | 'provider-inbound'
  | 'provider-replay'
  | 'document-sync-port';
export type SyncUpdateAdmissionEnvelopeVersion =
  | 'provider-inbound-update-v1'
  | 'provider-inbound-update-v2'
  | 'provider-replay'
  | 'provenance-only'
  | 'classified-raw';

export interface SyncUpdateAdmissionMetadata {
  readonly source: SyncUpdateAdmissionSource;
  readonly docId: string;
  readonly envelopeVersion: SyncUpdateAdmissionEnvelopeVersion;
  readonly providerRefId?: string;
  readonly providerEpoch?: string;
  readonly updateId?: string;
  readonly payloadHash: string;
  readonly provenance: SyncUpdateProvenance;
  readonly validationDiagnostics: readonly SyncUpdateValidationDiagnostic[];
}

export interface ProviderInboundApplyUpdateMetadata extends SyncUpdateAdmissionMetadata {
  readonly source: 'provider-inbound';
  readonly envelopeVersion: 'provider-inbound-update-v1' | 'provider-inbound-update-v2';
  readonly providerRefId: string;
  readonly providerEpoch: string;
  readonly updateId: string;
}

export interface ProviderReplayApplyUpdateMetadata extends SyncUpdateAdmissionMetadata {
  readonly source: 'provider-replay';
  readonly envelopeVersion: 'provider-replay';
}

export type ProviderDocApplyUpdateMetadata =
  | ProviderInboundApplyUpdateMetadata
  | ProviderReplayApplyUpdateMetadata;

export interface ProviderDocApplyUpdateResult {
  readonly mutationResult: MutationResult;
  readonly metadata: SyncApplyMutationMetadataWire;
}

export type ProviderDocApplyUpdateReturn = ProviderDocApplyUpdateResult | void;

export type ClassifiedRawSyncUpdateProvenance = Exclude<
  SyncUpdateProvenance,
  Extract<
    SyncUpdateProvenance,
    { readonly sourceKind: 'providerLiveInbound' | 'collaborationLiveRemote' }
  >
> & {
  readonly capturePolicy: 'excluded' | 'derivedOnly';
};

export interface DocumentByteSyncPortApplyUpdateMetadata extends SyncUpdateAdmissionMetadata {
  readonly source: 'document-sync-port';
  readonly envelopeVersion: 'provider-inbound-update-v2' | 'provenance-only' | 'classified-raw';
}

/**
 * The doc-side interface: a thin handle over the engine's yrs Doc.
 *
 * Providers call these methods to read/write the live doc. The actual
 * yrs operations happen in the compute engine (Rust); the bridge
 * transports the bytes. The production bridge wires the real methods; this
 * package ships the interface and a TS-side mock for tests.
 */
export interface ProviderDoc {
  /** Document identifier — used for keyed persistence. */
  readonly docId: string;

  /**
   * Apply a yrs `update_v1` byte stream into the doc. Idempotent
   * (re-applying the same update is a no-op per yrs CRDT semantics).
   * Implementations may resolve with sync-apply metadata; Providers can
   * ignore the result.
   */
  applyUpdate(
    update: Uint8Array,
    metadata?: ProviderDocApplyUpdateMetadata,
  ): Promise<ProviderDocApplyUpdateReturn>;

  /**
   * Encode all updates the local doc has that the remote (described by
   * `remoteSv`) does not. Used by future websocket sync.
   */
  encodeDiff(remoteSv: Uint8Array): Promise<Uint8Array>;

  /**
   * Encode the doc's current state vector. Round-trip with `encodeDiff`
   * + `applyUpdate` gives convergence between two replicas.
   */
  currentStateVector(): Promise<Uint8Array>;
}

/**
 * Canonical document byte-sync capability.
 *
 * Providers receive this capability as `ProviderDoc`; trusted document
 * adapters expose the richer document byte-sync port under document
 * vocabulary. `applyUpdate(update)` remains the legacy raw compatibility
 * method. New sync callers should use one of the provenance-aware admission
 * methods so classification happens before Rust mutates Yrs.
 */
export interface DocumentByteSyncPort extends ProviderDoc {
  applyUpdateWithProvenance(update: Uint8Array, provenance: SyncUpdateProvenance): Promise<void>;
  applyProviderEnvelope(envelope: ProviderInboundUpdateEnvelopeV2): Promise<void>;
  applyClassifiedRawUpdate(
    update: Uint8Array,
    provenance: ClassifiedRawSyncUpdateProvenance,
  ): Promise<void>;
}
