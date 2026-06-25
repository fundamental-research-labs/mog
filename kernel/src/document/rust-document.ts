/**
 * RustDocument — Provider Protocol orchestrator.
 *
 * Provider lifecycle refactor: this class no longer
 * owns persistence directly. It is the **orchestrator** between the compute
 * engine's `update_v1` stream (one source) and N Providers (N sinks).
 *
 * Responsibilities:
 *   - Hold an ordered `Provider[]`. Each Provider owns its own coalescing,
 *     persistence, and flush-failure semantics. The orchestrator's only
 *     job is fan-out + ordering guarantees.
 *   - Subscribe **once** to `bridge.subscribeUpdateV1`. The single
 *     subscription emits to every attached Provider via the orchestrator's
 *     internal microtask FIFO queue.
 *   - Expose `attachProvider`, `detachProvider`, `checkpoint`, `flushSync`,
 *     `destroy`, plus diagnostic hatches `hasFlushFailed` and
 *     `pendingUpdatesCount` for the dt-flag's `__dt.persistenceState`
 *     readout.
 *   - Call `touchDoc(docId)` on the **first** successful user-visible
 *     Provider attach so the Meta API tracks the active doc. Internal and
 *     fallback docs opt out via `RustDocumentOptions.internal = true`.
 *
 * Headless mode has no special branch. `skipPersistenceLoad` keeps the
 * loadability flag for engine init (no IndexedDB hydration), and the
 * "no Providers attached" path retains local updates until a Provider
 * attaches or the document is destroyed. This preserves Yrs causality for
 * session-local bootstrap structs that later user edits depend on.
 *
 * Provider queue contract (asserted by `__tests__/rust-document-orchestrator.test.ts`):
 *   - **FIFO**: every Provider sees updates in the exact order yrs emitted.
 *   - **No reentrancy**: appends emitted *during* a fan-out cycle land in
 *     the next microtask batch, never the current one.
 *   - **Backpressure**: `appendUpdate` returns synchronously even with a
 *     Provider's `flush()` in flight; updates accumulate.
 *
 */

import type {
  CheckpointResult,
  CloseResult,
  ProviderCheckpointStatus,
  StorageLifecycleError,
} from '@mog-sdk/types-document/storage/lifecycle';
import {
  classifyLegacyProviderInboundUpdate,
  isProviderInboundUpdateEnvelopeV2,
  validateProviderInboundUpdateEnvelope,
  type ProviderInboundUpdateEnvelope,
  type ProviderInboundUpdateEnvelopeAny,
  type ProviderInboundUpdateEnvelopeV2,
  type SyncUpdateProvenance,
  type SyncUpdateValidationDiagnostic,
} from '@mog-sdk/types-document/storage';
import type { ComputeBridge } from '../bridges/compute/compute-bridge';
import { createAdmittedSyncApplyContext } from '../bridges/compute/sync-apply-admission';
import type {
  Provider,
  ProviderAttachMode,
  ProviderAttachResult,
  ProviderCheckpointMode,
  ProviderCheckpointResult,
  ProviderDocApplyUpdateResult,
  ProviderInboundApplyUpdateMetadata,
} from './providers/provider';
import {
  completeAppliedSyncUpdateIdentity,
  completeAppliedSyncUpdateIdentityFailedAfterMutation,
  openAppliedSyncUpdateIdentityStoreFromProvider,
  prepareAppliedSyncUpdateIdentityBeforeApply,
  type AppliedSyncUpdateIdentityAppliedTerminalMetadata,
  type AppliedSyncUpdateIdentityStore,
  type AppliedSyncUpdateIdentityPreApplyRejectionReason,
} from './applied-sync-update-identity-wiring';
import {
  completeSyncBatchStatus,
  completeSyncBatchStatusFailedAfterMutation,
  openSyncBatchStatusStoreFromProvider,
  prepareSyncBatchStatusBeforeApply,
  type SyncBatchStatusPreApplyRejectionReason,
  type SyncBatchStatusStore,
} from './sync-batch-status-wiring';
import {
  capturePendingRemoteSegmentForAdmittedContext,
  type PendingRemoteSyncCaptureServices,
} from './pending-remote-sync-capture';
import type { ResolvedWorkbookVersioningConfig } from './version-store/lifecycle';
import type { VersionPendingRemoteCapture } from './version-store/pending-remote-capture-service';
import {
  createVersionProviderWriteActivityTracker,
  type VersionProviderWriteActivityTracker,
} from './version-store/provider-write-activity';
import type { PendingRemotePromotionResult } from './version-store/pending-remote-promotion-service';
import {
  promoteCapturedPendingRemoteSegment,
  resolvePendingRemotePromotionService,
  type PendingRemotePromotionServiceLike,
} from './pending-remote-auto-promotion';
import type { VersionStoreProvider } from './version-store/provider';
import type { SnapshotRootByteSyncPort } from './version-store/snapshot-root-capture';
import type { WriteGate } from './write-gate';
import { touchDoc } from './providers/indexeddb-meta';
import { slog } from '../lib/slog';

export type {
  ProviderInboundUpdateEnvelope,
  ProviderInboundUpdateEnvelopeAny,
  ProviderInboundUpdateEnvelopeV2,
};

export type UpdateOrigin = 'local' | `provider:${string}`;

export interface ProviderInboundUpdateResult {
  readonly status: 'applied' | 'duplicate' | 'rejected';
  readonly updateId: string;
  readonly reason?: ProviderInboundUpdateReason;
  readonly diagnostics?: readonly SyncUpdateValidationDiagnostic[];
  readonly provenance?: SyncUpdateProvenance;
  readonly applyResult?: ProviderDocApplyUpdateResult;
  readonly pendingRemotePromotionResult?: PendingRemotePromotionResult;
}

export type ProviderInboundUpdateReason =
  | 'document-destroyed'
  | 'provenance-validation-failed'
  | AppliedSyncUpdateIdentityPreApplyRejectionReason
  | SyncBatchStatusPreApplyRejectionReason
  | `unknown-provider: ${string}`
  | `unsupported-payload-kind: ${ProviderInboundUpdateEnvelopeAny['payloadKind']}`
  | `stale-epoch: ${string} < ${string}`;

// =============================================================================
// Types
// =============================================================================

/**
 * Document status representing the engine-init lifecycle.
 *
 * - 'connecting': Initializing — engine being created
 * - 'syncing':    Engine created, hydrating from initial state if any
 * - 'ready':      Engine loaded, safe to attach Providers
 * - 'error':      Init failed — read `error`
 *
 * Persistence is no longer in this lifecycle —
 * `ready` simply means the engine is initialized; Providers attach
 * afterwards through `attachProvider`.
 */
export type DocumentStatus = 'connecting' | 'syncing' | 'ready' | 'error';

/**
 * Options for creating a RustDocument.
 */
export interface RustDocumentOptions {
  /** Unique document identifier (also used as the compute-engine doc key). */
  docId: string;
  /** ComputeBridge instance for engine communication + update_v1 subscription. */
  computeBridge: ComputeBridge;
  /**
   * Skip loading any prior state during engine init.
   *
   * Persistence hydration is now the Provider's job —
   * `Provider.attach()` replays bytes into the doc. This flag therefore
   * only governs the engine-init path:
   *   - false (default): engine is created normally (empty or from
   *     `initialSnapshot`/`yrsState` if provided).
   *   - true: same — there's no kernel-side persistence layer left to
   *     skip. Kept for API compatibility with headless mode and existing
   *     callers; functionally a no-op once Providers own persistence.
   */
  skipPersistenceLoad?: boolean;
  /**
   * Skip creating the default "Sheet1" on document creation.
   * Default: false (creates default sheet via Rust engine).
   *
   * Use when importing from external sources (e.g., XLSX) that will
   * create their own sheets.
   */
  skipDefaultSheet?: boolean;
  /**
   * Pre-built WorkbookSnapshot for engine initialization (for collaboration).
   * When provided, the engine is created from this snapshot instead of an empty one.
   */
  initialSnapshot?: Record<string, unknown>;
  /**
   * Raw Yrs document state bytes for engine initialization (for collaboration).
   * When provided, the engine is created from these bytes via `createEngineFromYrsState`
   * instead of `createEngine`. This ensures the engine shares the same CellIds and
   * history as the authoritative source.
   * Takes precedence over `initialSnapshot` if both are provided.
   */
  yrsState?: Uint8Array;
  /**
   * Mark this doc as internal/non-user-visible. When true, `attachProvider` does NOT
   * call `touchDoc(docId)`, so the doc never appears in `recentDocs` or
   * becomes `lastActiveDocId`. Default: false.
   *
   * The shell sets this on the fallback document so the boot precedence can
   * rely on `lastActiveDocId` always being a user-visible doc.
   */
  internal?: boolean;
  /** Optional document-scoped identity store for verified live sync updates. */
  appliedSyncUpdateIdentityStore?: AppliedSyncUpdateIdentityStore;
  /** Optional document-scoped in-process version provider write activity tracker. */
  providerWriteActivityTracker?: VersionProviderWriteActivityTracker;
}

/**
 * Status change callback signature.
 */
export type StatusChangeCallback = (status: DocumentStatus, error?: Error) => void;

export interface RustDocumentAttachProviderOptions {
  mode?: ProviderAttachMode;
  suppressInitialBaseline?: boolean;
  suppressQueuedUpdates?: boolean;
  suppressTouch?: boolean;
}

export interface RustDocumentFullStateCheckpointOptions {
  mode?: ProviderCheckpointMode;
  publishAfterCommit?: boolean;
  /**
   * Import-initialize promotion only. The lifecycle system intentionally
   * allows first-contact interactions before the deferred import snapshot is
   * durably committed. Those updates are already represented in the full-state
   * snapshot; absorb their queued update_v1 payloads under the write gate so
   * promotion can commit one coherent snapshot.
   */
  absorbStagedLiveUpdates?: boolean;
}

// =============================================================================
// RustDocument
// =============================================================================

export class RustDocument {
  /** Document identifier. */
  readonly docId: string;

  /**
   * Promise that resolves when the engine is initialized (status === 'ready').
   * Rejects if init fails.
   */
  readonly ready: Promise<void>;

  /** The ComputeBridge instance for engine communication. */
  readonly computeBridge: ComputeBridge;

  /** Whether this is an internal/fallback doc (skip touchDoc on attach). */
  private readonly internal: boolean;

  /** Engine-init options that the constructor caches for `initialize`. */
  private readonly initialSnapshot?: Record<string, unknown>;
  private readonly yrsState?: Uint8Array;
  private versionSyncServicesProvider?: unknown;
  private versionStoreProvider?: VersionStoreProvider;
  private versioningSnapshotRootByteSyncPort?: SnapshotRootByteSyncPort;
  private capturePendingRemoteSegment?: VersionPendingRemoteCapture;
  private pendingRemotePromotionService?: PendingRemotePromotionServiceLike;
  private pendingRemotePromotionServiceProvider?: VersionStoreProvider;
  private pendingRemotePromotionServiceTracker?: VersionProviderWriteActivityTracker;
  private providerWriteActivityTracker: VersionProviderWriteActivityTracker;
  private appliedSyncUpdateIdentityStore?: AppliedSyncUpdateIdentityStore;
  private syncBatchStatusStore?: SyncBatchStatusStore;
  /**
   * Full-state diff captured after the bridge reaches STARTED but before
   * Provider attach/replay for document-local structs written before the
   * update_v1 observer existed (notably the root `schemaVersion` stamp).
   * Later local edits from the same Yrs client depend on those structs by
   * clock, so every Provider attached to this session must persist this
   * baseline before it persists live user edits.
   *
   * `createEngineFromYrsState` starts from a complete remote state, so it
   * does not need this session bootstrap baseline.
   */
  private initialProviderBaselineUpdate: Uint8Array | null = null;
  private initialProviderBaselineCaptured = false;

  /** Current document status. */
  private _status: DocumentStatus = 'connecting';
  /** Error if status is 'error'. */
  private _error: Error | undefined;
  /** Status change listeners. */
  private statusListeners: Set<StatusChangeCallback> = new Set();

  /** Whether `destroy()` has run; further calls short-circuit. */
  private destroyed = false;

  // ---------------------------------------------------------------------------
  // Provider Protocol — orchestrator state
  // ---------------------------------------------------------------------------

  /**
   * Attached Providers, in registration order. Order matters — `appendUpdate`,
   * `flushSync`, and `checkpoint`/`destroy` all preserve this for predictability.
   */
  private providers: Provider[] = [];
  /**
   * Providers attached in import-initialize mode. They have skipped replay and
   * are waiting for a snapshot-only import checkpoint before entering live
   * update fan-out.
   */
  private importStagedProviders: Provider[] = [];

  /** Whether any providers are staged for import-initialize promotion. */
  get hasImportStagedProviders(): boolean {
    return this.importStagedProviders.length > 0;
  }

  /**
   * Single subscription handle from `bridge.subscribeUpdateV1`. Set on
   * construction (after engine init) and cleared in `destroy()`. Held as a
   * reference so the bridge-side subscriber set stays bounded — one entry
   * per RustDocument, not one entry per attached Provider.
   */
  private subscriptionHandle: { unsubscribe: () => void } | null = null;

  /**
   * FIFO queue of `update_v1` payloads pending fan-out to Providers. The
   * microtask drain (see `enqueueUpdate`) freezes a snapshot of this queue
   * and replaces `updateQueue` with a fresh empty array — appends emitted
   * during the fan-out land in the new array, observed in the *next*
   * batch. This implements the no-reentrancy guarantee.
   */
  private updateQueue: Array<{ update: Uint8Array; origin: UpdateOrigin }> = [];

  /**
   * Whether a microtask drain is pending. Coalesces multiple `enqueueUpdate`
   * calls in the same tick into a single fan-out cycle.
   */
  private flushScheduled = false;

  /**
   * Non-zero while a Provider is replaying its persisted bytes into the
   * engine during attach. Replay is inbound hydration, not a new local
   * mutation, so update_v1 payloads emitted by `syncApply` in that window
   * must not be fanned back out to Providers or re-appended to durable logs.
   */
  private providerReplayDepth = 0;

  // --- Inbound update tracking ---
  private _currentUpdateOrigin: UpdateOrigin = 'local';
  private _inboundUpdateLog: Set<string> = new Set();
  private _inboundUpdateOrder: string[] = [];
  private static readonly INBOUND_LOG_CAPACITY = 1000;
  private _providerEpochs: Map<string, string> = new Map();

  /**
   * Non-zero while import-initialize is applying the deferred XLSX/CSV Yrs
   * hydration that will be persisted by the immediately following full-state
   * checkpoint. Those bytes are snapshot input, not user edits, so they must
   * not enter the live Provider append queue before the staged Provider is
   * promoted.
   */
  private importInitializeHydrationDepth = 0;

  /**
   * Non-zero while an import-initialize full-state checkpoint is absorbing
   * queued first-contact updates into the snapshot that is about to be
   * committed. This is distinct from hydration suppression: the updates are
   * user-visible engine state, but they must not be appended incrementally to a
   * Provider that has not been promoted yet.
   */
  private importInitializePromotionDepth = 0;

  /**
   * Set to `true` the first time `enqueueUpdate` fans an `update_v1` payload
   * out to attached Providers (i.e. the orchestrator has actually delivered
   * a live mutation, not just been wired). Used by the
   * `__dt.persistenceEnabled` getter; the flag flips only after we've proven
   * the per-mutation incremental write path is live for this doc.
   *
   * Once `true`, never resets — a doc that has fanned out at least one
   * update has demonstrated the path works for its lifetime.
   */
  private _appendActive = false;

  constructor(options: RustDocumentOptions) {
    this.docId = options.docId;
    this.computeBridge = options.computeBridge;
    this.internal = options.internal ?? false;
    this.initialSnapshot = options.initialSnapshot;
    this.yrsState = options.yrsState;
    this.appliedSyncUpdateIdentityStore = options.appliedSyncUpdateIdentityStore;
    this.providerWriteActivityTracker =
      options.providerWriteActivityTracker ?? createVersionProviderWriteActivityTracker();

    // Engine init runs immediately — `ready` resolves when status reaches
    // 'ready'. `subscribeUpdateV1` is wired *after* engine init so the
    // subscription doesn't miss the first batch of updates from
    // hydration (apply_sync_update during attach replay would otherwise
    // race the subscriber registration).
    this.ready = this.initialize();
  }

  // ---------------------------------------------------------------------------
  // Public properties
  // ---------------------------------------------------------------------------

  get status(): DocumentStatus {
    return this._status;
  }

  get error(): Error | undefined {
    return this._error;
  }

  /**
   * `true` iff at least one attached Provider's most recent `flushSync()`
   * could not start a durable write (`flushFailed` flag set on that
   * Provider). Read by the shell's `beforeunload` handler to decide whether
   * to prompt "leave site? you have unsaved work."
   *
   * Failure is per-transport: a websocket disconnect and an IndexedDB quota
   * error are unrelated states. The orchestrator surfaces the *or* across
   * attached Providers; the shell decides what to do.
   */
  get hasFlushFailed(): boolean {
    return this.providers.some((p) => p.flushFailed);
  }

  /**
   * Number of `update_v1` payloads sitting in the orchestrator's FIFO
   * queue, awaiting their next microtask fan-out. Exposed for the
   * `__dt.persistenceState` readout.
   *
   * Note: this counts the orchestrator-level queue, not the per-Provider
   * pending-write queues — those live inside each Provider and surface
   * via `Provider.flushFailed` / each transport's own diagnostics.
   */
  get pendingUpdatesCount(): number {
    return this.updateQueue.length;
  }

  get versionProviderWriteActivityTracker(): VersionProviderWriteActivityTracker {
    return this.providerWriteActivityTracker;
  }

  /**
   * `true` once at least one `update_v1` payload has been fanned out to the
   * attached Providers via the microtask drain. Read by the
   * `__dt.persistenceEnabled` getter; the harness flag flips only when the
   * orchestrator has demonstrated the per-mutation write path is live.
   *
   * Latches on first append; never resets. A doc that has shipped one
   * update has proven the wiring works for its lifetime.
   */
  get hasAppendActive(): boolean {
    return this._appendActive;
  }

  /**
   * `true` when every attached Provider with a `readOnly` property is in
   * read-only mode because another tab holds the Web Lock. Used by the shell to render a
   * read-only banner and by `__dt.providerState.readOnly`.
   *
   * Returns `false` when no Providers are attached or none implement
   * `readOnly`.
   */
  get isReadOnly(): boolean {
    const writeable = this.providers.filter((p) => p.readOnly !== undefined);
    if (writeable.length === 0) return false;
    return writeable.every((p) => p.readOnly === true);
  }

  /**
   * **`__dt`-only enumeration surface — never read by production code.**
   *
   * Snapshot of the orchestrator's currently-attached `Provider[]`, in
   * registration order. Read by the `__dt.persistenceProviders` getter
   * (see `bridge-devtools-wrapper.ts`) so a Playwright spec can reach a
   * specific Provider's dev-only inspection fields (e.g.
   * `IndexedDBProvider._devtoolsDb`) without growing the public Provider
   * surface or leaking handles to production callers.
   *
   * Returns a defensive copy so callers can't mutate the orchestrator's
   * internal `providers` array.
   *
   * Naming convention: dev-only inspection fields are prefixed with
   * `_devtools*` so a future code search makes the intent obvious.
   */
  _devtoolsProviders(): readonly Provider[] {
    return this.providers.slice();
  }

  // ---------------------------------------------------------------------------
  // Status management
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to status changes. Callback is invoked immediately with the
   * current status, then on every change. Returns an unsubscribe function.
   */
  onStatusChange(callback: StatusChangeCallback): () => void {
    this.statusListeners.add(callback);
    // Immediately call with current status so subscribers don't miss the
    // initial state.
    callback(this._status, this._error);
    return () => {
      this.statusListeners.delete(callback);
    };
  }

  // ---------------------------------------------------------------------------
  // Provider Protocol — public methods
  // ---------------------------------------------------------------------------

  /**
   * Capture the session-local bootstrap update that existed before
   * Providers attach. This runs only after the ComputeBridge is STARTED:
   * generated read methods such as `encodeDiff` deliberately require a
   * fully wired DocumentContext.
   *
   * The lifecycle system calls this immediately before Provider attach;
   * `attachProvider` also calls it defensively so direct test/headless
   * callers preserve the same causality contract.
   */
  async captureInitialProviderBaseline(): Promise<void> {
    if (this.destroyed) {
      throw new Error('RustDocument.captureInitialProviderBaseline: document is destroyed');
    }
    if (this.yrsState || this.initialProviderBaselineCaptured) return;
    if (this._status !== 'ready') {
      await this.ready;
    }

    const phase = (this.computeBridge as unknown as { phase?: string }).phase;
    if (phase !== undefined && phase !== 'STARTED') {
      throw new Error(
        `RustDocument.captureInitialProviderBaseline requires a STARTED ComputeBridge (current phase: ${phase})`,
      );
    }

    const baseline = await this.computeBridge.encodeDiff(new Uint8Array([0]));
    this.initialProviderBaselineUpdate = baseline.length > 0 ? new Uint8Array(baseline) : null;
    this.initialProviderBaselineCaptured = true;
  }

  /**
   * Attach a Provider to this document.
   *
   * Order:
   *   1. Build a `ProviderDoc` over this RustDocument's bridge (callers can
   *      override by passing a pre-built doc; orchestrator's default uses
   *      `bridge-provider-doc.ts`).
   *   2. Await `provider.attach(doc)` — Provider replays persisted bytes
   *      into the doc via `applyUpdate`. This must complete before the
   *      orchestrator starts forwarding live `update_v1` payloads, so that
   *      replay and live updates don't interleave.
   *   3. Push to `providers`.
   *   4. If this is a user-visible doc (`internal === false`), call
   *      `touchDoc(docId)` so the Meta API's `lastActiveDocId` /
   *      `recentDocs` track the most recently opened user doc.
   *
   * Errors from `provider.attach()` propagate — caller (typically the
   * factory) decides whether to retry, log, or fail the open.
   */
  async attachProvider(
    provider: Provider,
    options: RustDocumentAttachProviderOptions = {},
  ): Promise<void> {
    if (this.destroyed) {
      throw new Error('RustDocument.attachProvider: document is destroyed');
    }
    if (this._status !== 'ready') {
      // Engine must be initialized before a Provider can replay bytes.
      // Wait for `ready` to resolve so callers don't have to.
      await this.ready;
    }
    if (!options.suppressInitialBaseline) {
      await this.captureInitialProviderBaseline();
    }

    // Lazy-import the bridge-backed ProviderDoc factory. We don't import
    // it eagerly at the top of the file because bridge-provider-doc.ts
    // imports `ComputeBridge` types and we want this file (rust-document)
    // to stay lean; circular import risk is also lower with a lazy import.
    const { createBridgeBackedProviderDoc, getBridgeBackedProviderReplayAdmission } =
      await import('./providers/bridge-provider-doc');
    const doc = createBridgeBackedProviderDoc(this.computeBridge, this.docId, {
      providerReplayAdmission: getBridgeBackedProviderReplayAdmission(provider),
    });

    // Provider replay applies persisted bytes into the engine via syncApply.
    // This is a system operation, not a user mutation, so it must bypass the
    // write gate. The gate's bypass scope nests cleanly with the existing
    // providerReplayDepth tracking.
    const replayWork = async (): Promise<ProviderAttachResult | void> => {
      this.providerReplayDepth++;
      try {
        const result = await provider.attach(doc, options.mode);
        if (result?.status === 'blocked') {
          await provider.detach().catch((err) => {
            slog('rustDocument.blockedProviderDetachFailed', { error: err });
          });
          throw new Error(
            result.message ??
              `Provider ${provider.name} could not attach to document ${this.docId}: ${result.reason}`,
          );
        }
        if (options.mode?.kind !== 'importInitialize') {
          await this.drainBridgePendingUpdatesNow();
        }
        return result;
      } finally {
        this.providerReplayDepth--;
      }
    };

    const writeGate = this.computeBridge.writeGate as WriteGate | undefined;
    const attachResult = writeGate ? await writeGate.withBypass(replayWork) : await replayWork();

    if (options.mode?.kind === 'importInitialize') {
      await this.drainBridgePendingUpdatesNow();
    }

    if (options.suppressQueuedUpdates) {
      this.updateQueue = [];
      this.flushScheduled = false;
    }

    if (options.mode?.kind === 'importInitialize') {
      if (!isReadyAttach(attachResult)) {
        await provider.detach().catch((err) => {
          slog('rustDocument.unreadyStagedProviderDetachFailed', { error: err });
        });
        throw new Error(
          `Provider ${provider.name} cannot initialize imported document ${this.docId}: attach did not return ready`,
        );
      }
      if (isReadOnlyAttach(attachResult) || provider.readOnly) {
        await provider.detach().catch((err) => {
          slog('rustDocument.readOnlyStagedProviderDetachFailed', { error: err });
        });
        throw new Error(
          `Provider ${provider.name} cannot initialize imported document ${this.docId}: provider is read-only`,
        );
      }
      this.importStagedProviders.push(provider);
      return;
    }

    this.providers.push(provider);
    if (!options.suppressInitialBaseline) {
      this.appendInitialProviderBaseline(provider);
    }
    this.drainQueuedUpdatesNow();

    // `hasAppendActive`: the per-mutation incremental write path is live for
    // this doc once a Provider is attached and
    // ready to receive `appendUpdate` calls. Originally this latched only
    // on the FIRST `enqueueUpdate` fan-out, but that semantics misses the
    // post-reload+hydrate case: hydration replays bytes via
    // `applyUpdate` (read-only path, no `update_v1`), so a doc that
    // re-opened from IDB without any new mutation would report
    // `hasAppendActive=false` and the harness `__dt.persistenceEnabled`
    // would stay false despite the per-mutation path being fully wired.
    //
    // The right semantics — "writes WILL persist for this doc" — is
    // proven by a successful Provider attach: every subsequent mutation
    // fans through this Provider's `appendUpdate`. Latch here so the
    // post-reload+hydrate state correctly reports true.
    this._appendActive = true;

    // Only user-visible docs land in `recentDocs` / `lastActiveDocId`.
    // Fallback and internal-app cases opt out via the `internal` flag.
    if (!options.suppressTouch) {
      await this.touchUserVisibleDoc();
    }
  }

  async installAppliedSyncUpdateIdentityStoreFromProvider(provider: unknown): Promise<void> {
    await this.installVersionSyncServicesFromProvider(provider);
  }

  async installVersionSyncServicesFromProvider(provider: unknown): Promise<void> {
    if (provider === null || provider === undefined) return;
    await this.installVersionSyncServices({ provider: provider as VersionStoreProvider });
  }

  async installVersionSyncServices(
    versioning:
      | Pick<
          ResolvedWorkbookVersioningConfig,
          | 'provider'
          | 'providerWriteActivityTracker'
          | 'pendingRemotePromotionService'
          | 'semanticMutationCapture'
          | 'snapshotRootByteSyncPort'
        >
      | null
      | undefined,
  ): Promise<void> {
    if (versioning === null || versioning === undefined) return;
    const provider = versioning?.provider;
    if (provider === null || provider === undefined) {
      this.clearVersionSyncServices();
      return;
    }

    const capturePendingRemoteSegment =
      versioning?.semanticMutationCapture?.capturePendingRemoteSegment;
    const explicitPendingRemotePromotionService = versioning?.pendingRemotePromotionService;
    const providerWriteActivityTracker = versioning?.providerWriteActivityTracker;
    const snapshotRootByteSyncPort = versioning?.snapshotRootByteSyncPort;
    if (providerWriteActivityTracker) {
      this.providerWriteActivityTracker = providerWriteActivityTracker;
    }
    const resolvedPendingRemotePromotionService = resolvePendingRemotePromotionService({
      explicit: explicitPendingRemotePromotionService,
      provider,
      providerWriteActivityTracker: this.providerWriteActivityTracker,
      existing: this.pendingRemotePromotionService,
      existingProvider: this.pendingRemotePromotionServiceProvider,
      existingProviderWriteActivityTracker: this.pendingRemotePromotionServiceTracker,
    });
    const pendingRemotePromotionService = resolvedPendingRemotePromotionService.service;
    if (
      this.versionSyncServicesProvider === provider &&
      this.capturePendingRemoteSegment === capturePendingRemoteSegment &&
      this.pendingRemotePromotionService === pendingRemotePromotionService &&
      this.versioningSnapshotRootByteSyncPort === snapshotRootByteSyncPort &&
      (this.appliedSyncUpdateIdentityStore || this.syncBatchStatusStore)
    ) {
      return;
    }

    this.versionSyncServicesProvider = provider;
    const [appliedSyncUpdateIdentityStore, syncBatchStatusStore] = await Promise.all([
      openAppliedSyncUpdateIdentityStoreFromProvider(provider),
      openSyncBatchStatusStoreFromProvider(provider),
    ]);
    this.versionStoreProvider = provider;
    if (capturePendingRemoteSegment) {
      this.capturePendingRemoteSegment = capturePendingRemoteSegment;
    } else {
      delete this.capturePendingRemoteSegment;
    }
    if (pendingRemotePromotionService) {
      this.pendingRemotePromotionService = pendingRemotePromotionService;
      this.pendingRemotePromotionServiceProvider = resolvedPendingRemotePromotionService.provider;
      this.pendingRemotePromotionServiceTracker =
        resolvedPendingRemotePromotionService.providerWriteActivityTracker;
    } else {
      delete this.pendingRemotePromotionService;
      delete this.pendingRemotePromotionServiceProvider;
      delete this.pendingRemotePromotionServiceTracker;
    }
    if (snapshotRootByteSyncPort) {
      this.versioningSnapshotRootByteSyncPort = snapshotRootByteSyncPort;
    } else {
      delete this.versioningSnapshotRootByteSyncPort;
    }
    if (appliedSyncUpdateIdentityStore) {
      this.appliedSyncUpdateIdentityStore = appliedSyncUpdateIdentityStore;
    } else {
      delete this.appliedSyncUpdateIdentityStore;
    }
    if (syncBatchStatusStore) {
      this.syncBatchStatusStore = syncBatchStatusStore;
    } else {
      delete this.syncBatchStatusStore;
    }
  }

  private clearVersionSyncServices(): void {
    delete this.versionSyncServicesProvider;
    delete this.versionStoreProvider;
    delete this.versioningSnapshotRootByteSyncPort;
    delete this.capturePendingRemoteSegment;
    delete this.pendingRemotePromotionService;
    delete this.pendingRemotePromotionServiceProvider;
    delete this.pendingRemotePromotionServiceTracker;
    delete this.appliedSyncUpdateIdentityStore;
    delete this.syncBatchStatusStore;
  }

  /**
   * Detach a Provider from this document. Idempotent if the Provider was
   * never attached. Awaits the Provider's `detach()` so its final flush
   * commits before the function resolves.
   */
  async detachProvider(provider: Provider): Promise<void> {
    const idx = this.providers.indexOf(provider);
    if (idx === -1) return;
    this.providers.splice(idx, 1);
    await provider.detach();
  }

  // ---------------------------------------------------------------------------
  // Provider Protocol — inbound update orchestration
  // ---------------------------------------------------------------------------

  async applyProviderUpdate(
    envelope: ProviderInboundUpdateEnvelopeAny,
  ): Promise<ProviderInboundUpdateResult> {
    if (this.destroyed) {
      return { status: 'rejected', updateId: envelope.updateId, reason: 'document-destroyed' };
    }

    const matchingProvider = this.providers.find((p) => p.name === envelope.providerRefId);
    if (!matchingProvider) {
      return {
        status: 'rejected',
        updateId: envelope.updateId,
        reason: `unknown-provider: ${envelope.providerRefId}`,
      };
    }

    if (envelope.payloadKind !== 'yrs-update-v1') {
      return {
        status: 'rejected',
        updateId: envelope.updateId,
        reason: `unsupported-payload-kind: ${envelope.payloadKind}`,
      };
    }

    const lastEpoch = this._providerEpochs.get(envelope.providerRefId);
    if (lastEpoch !== undefined && envelope.providerEpoch < lastEpoch) {
      return {
        status: 'rejected',
        updateId: envelope.updateId,
        reason: `stale-epoch: ${envelope.providerEpoch} < ${lastEpoch}`,
      };
    }

    if (
      !this.appliedSyncUpdateIdentityStore &&
      !this.syncBatchStatusStore &&
      this._inboundUpdateLog.has(envelope.updateId)
    ) {
      return { status: 'rejected', updateId: envelope.updateId, reason: 'duplicate-update-id' };
    }

    const actualPayloadHash = await sha256Hex(envelope.payload);
    const envelopeVersion = providerEnvelopeVersion(envelope);
    const isV2Envelope = isProviderInboundUpdateEnvelopeV2(envelope);
    const validation = validateProviderInboundUpdateEnvelope(envelope, {
      expectedPayloadHash: isV2Envelope ? actualPayloadHash : undefined,
    });
    const providerIdentity = matchingProvider.getIdentity?.();
    const provenance = isV2Envelope
      ? envelope.provenance
      : classifyLegacyProviderInboundUpdate(envelope, {
          providerId: providerIdentity?.providerId,
          stableOriginId: providerIdentity?.providerId,
        });

    if (isV2Envelope && !validation.ok) {
      return {
        status: 'rejected',
        updateId: envelope.updateId,
        reason: 'provenance-validation-failed',
        diagnostics: validation.diagnostics,
        provenance,
      } as const satisfies ProviderInboundUpdateResult;
    }

    const metadata: ProviderInboundApplyUpdateMetadata = {
      source: 'provider-inbound',
      docId: this.docId,
      envelopeVersion,
      providerRefId: envelope.providerRefId,
      providerEpoch: envelope.providerEpoch,
      updateId: envelope.updateId,
      payloadHash: actualPayloadHash,
      provenance,
      validationDiagnostics: validation.diagnostics,
    };

    const admittedContext = createAdmittedSyncApplyContext(metadata);
    return this.providerWriteActivityTracker.trackRemoteSyncApply(async () => {
      const batchDecision = await prepareSyncBatchStatusBeforeApply({
        store: this.syncBatchStatusStore,
        admittedContext,
      });
      if (batchDecision.status === 'duplicate') {
        return { status: 'duplicate', updateId: envelope.updateId, provenance };
      }
      if (batchDecision.status === 'rejected') {
        return {
          status: 'rejected',
          updateId: envelope.updateId,
          reason: batchDecision.reason,
          provenance,
        };
      }
      const batchReservation = batchDecision.reservation;

      const identityDecision = await prepareAppliedSyncUpdateIdentityBeforeApply({
        store: this.appliedSyncUpdateIdentityStore,
        admittedContext,
        inboundUpdateAlreadySeen: this._inboundUpdateLog.has(envelope.updateId),
      });
      if (identityDecision.status === 'duplicate') {
        return { status: 'duplicate', updateId: envelope.updateId, provenance };
      }
      if (identityDecision.status === 'rejected') {
        return {
          status: 'rejected',
          updateId: envelope.updateId,
          reason: identityDecision.reason,
          provenance,
        };
      }
      const identityReservation = identityDecision.reservation;

      this._currentUpdateOrigin = `provider:${envelope.providerRefId}`;
      let applyResult: ProviderDocApplyUpdateResult | void;
      let appliedTerminalMetadata: AppliedSyncUpdateIdentityAppliedTerminalMetadata | undefined;
      try {
        const { createBridgeBackedProviderDoc } = await import('./providers/bridge-provider-doc');
        const doc = createBridgeBackedProviderDoc(this.computeBridge, this.docId);
        applyResult = isV2Envelope
          ? await doc.applyProviderInboundUpdateEnvelopeV2(envelope, metadata)
          : await doc.applyLegacyProviderInboundUpdate(envelope, metadata);
        appliedTerminalMetadata = await capturePendingRemoteSegmentForAdmittedContext({
          docId: this.docId,
          admittedContext,
          services: this.pendingRemoteSyncCaptureServices(),
        });
      } catch (error) {
        if (batchReservation) {
          try {
            await completeSyncBatchStatusFailedAfterMutation(batchReservation);
          } catch (terminalError) {
            slog('rustDocument.applyProviderUpdateSyncBatchFailedAfterMutationTerminalFailed', {
              updateId: envelope.updateId,
              error: terminalError,
            });
          }
        }
        if (identityReservation) {
          try {
            await completeAppliedSyncUpdateIdentityFailedAfterMutation(identityReservation);
          } catch (terminalError) {
            slog('rustDocument.applyProviderUpdateFailedAfterMutationTerminalFailed', {
              updateId: envelope.updateId,
              error: terminalError,
            });
          }
        }
        throw error;
      } finally {
        this._currentUpdateOrigin = 'local';
      }

      let terminalError: unknown;
      if (batchReservation) {
        try {
          await completeSyncBatchStatus(batchReservation);
        } catch (error) {
          terminalError = error;
        }
      }
      if (identityReservation) {
        try {
          await completeAppliedSyncUpdateIdentity(identityReservation, appliedTerminalMetadata);
        } catch (error) {
          terminalError ??= error;
        }
      }
      if (terminalError) {
        throw terminalError;
      }

      const pendingRemotePromotionResult = await promoteCapturedPendingRemoteSegment({
        updateId: envelope.updateId,
        captured: appliedTerminalMetadata !== undefined,
        service: this.pendingRemotePromotionService,
      });

      this._inboundUpdateLog.add(envelope.updateId);
      this._inboundUpdateOrder.push(envelope.updateId);
      while (this._inboundUpdateOrder.length > RustDocument.INBOUND_LOG_CAPACITY) {
        const oldest = this._inboundUpdateOrder.shift()!;
        this._inboundUpdateLog.delete(oldest);
      }

      this._providerEpochs.set(envelope.providerRefId, envelope.providerEpoch);

      return {
        status: 'applied',
        updateId: envelope.updateId,
        provenance,
        ...(applyResult === undefined ? {} : { applyResult }),
        ...(pendingRemotePromotionResult === undefined ? {} : { pendingRemotePromotionResult }),
      };
    });
  }

  private pendingRemoteSyncCaptureServices(): PendingRemoteSyncCaptureServices {
    return {
      ...(this.versionStoreProvider ? { provider: this.versionStoreProvider } : {}),
      ...(this.capturePendingRemoteSegment
        ? { capturePendingRemoteSegment: this.capturePendingRemoteSegment }
        : {}),
      ...(this.versioningSnapshotRootByteSyncPort
        ? { snapshotRootByteSyncPort: this.versioningSnapshotRootByteSyncPort }
        : {}),
    };
  }

  /**
   * Awaitable checkpoint — ensure the engine's pending undo capture has
   * been flushed to the journal, then `flush()` every attached Provider in
   * parallel so every Provider sees a clean transaction boundary. Awaits all
   * flushes; resolves when every Provider has
   * acknowledged its durable commit.
   *
   * Use this from explicit "save" UI paths or before compaction. The
   * checkpointing calls `flushUndoCapture` first so the journal frame
   * is committed *before* Providers are asked to flush — otherwise a
   * Provider might persist bytes that don't yet have a journal entry.
   */
  async checkpoint(): Promise<void> {
    if (this.destroyed) return;
    await this.drainBridgePendingUpdatesNow();
    this.drainQueuedUpdatesNow();
    // `flushUndoCapture` is always async across transports. We await it
    // before fanning out to Providers so the
    // journal frame is committed; otherwise a Provider could persist
    // bytes that don't yet correspond to a complete undo entry.
    await this.computeBridge.flushUndoCapture();
    await Promise.all(this.providers.map((p) => p.flush()));
  }

  async checkpointStructured(): Promise<CheckpointResult> {
    const now = Date.now();
    if (this.destroyed) {
      return {
        status: 'failed',
        highWaterMark: { mark: 'hwm-destroyed', capturedAt: now, pendingMutationCount: 0 },
        providerResults: [],
        timestamp: now,
      };
    }

    await this.drainBridgePendingUpdatesNow();
    this.drainQueuedUpdatesNow();

    const writeGate = this.computeBridge.writeGate as WriteGate | undefined;
    const highWaterMark: import('@mog-sdk/types-document/storage/lifecycle').StorageHighWaterMark =
      writeGate
        ? (() => {
            const snap = writeGate.captureHighWaterMark();
            return {
              mark: `hwm-${snap.mutationWatermark}`,
              capturedAt: now,
              pendingMutationCount: snap.pendingAssetCount,
            };
          })()
        : { mark: 'hwm-no-gate', capturedAt: now, pendingMutationCount: 0 };

    await this.computeBridge.flushUndoCapture();

    const providerResults: ProviderCheckpointStatus[] = [];
    const flushResults = await Promise.allSettled(this.providers.map((p) => p.flush()));

    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];
      const result = flushResults[i];
      const identity = provider.getIdentity?.();
      const refId = identity?.providerRefId ?? provider.name;

      if (result.status === 'fulfilled') {
        providerResults.push({ providerRefId: refId, status: 'committed' });
      } else {
        providerResults.push({
          providerRefId: refId,
          status: 'failed',
          failureReason:
            result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }

    const hasFailure = providerResults.some((r) => r.status === 'failed');
    const allFailed =
      providerResults.length > 0 && providerResults.every((r) => r.status === 'failed');

    return {
      status: allFailed ? 'failed' : hasFailure ? 'partial' : 'committed',
      highWaterMark,
      providerResults,
      timestamp: Date.now(),
    };
  }

  async close(): Promise<CloseResult> {
    const now = Date.now();
    const errors: StorageLifecycleError[] = [];
    const detachedProviders: string[] = [];

    if (this.destroyed) {
      return {
        status: 'closed',
        detachedProviders: [],
        errors: [],
        timestamp: now,
      };
    }

    const writeGate = this.computeBridge.writeGate as WriteGate | undefined;
    if (writeGate) {
      writeGate.enterClosing();
    }

    let finalCheckpoint: CheckpointResult | undefined;
    if (this.providers.length > 0) {
      try {
        finalCheckpoint = await this.checkpointStructured();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({
          code: 'STORAGE_CLOSE_CHECKPOINT_FAILED',
          phase: 'closing',
          message: msg,
          retryable: false,
          timestamp: Date.now(),
        });
      }
    }

    const reverseProviders = [...this.providers].reverse();
    for (const provider of reverseProviders) {
      const identity = provider.getIdentity?.();
      const refId = identity?.providerRefId ?? provider.name;
      try {
        await provider.detach();
        detachedProviders.push(refId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        detachedProviders.push(refId);
        errors.push({
          code: 'STORAGE_CLOSE_DETACH_FAILED',
          phase: 'closing',
          providerRefId: refId,
          message: msg,
          retryable: false,
          timestamp: Date.now(),
        });
      }
    }
    this.providers = [];

    for (const provider of this.importStagedProviders) {
      const identity = provider.getIdentity?.();
      const refId = identity?.providerRefId ?? provider.name;
      try {
        await provider.detach();
        detachedProviders.push(refId);
      } catch {
        detachedProviders.push(refId);
      }
    }
    this.importStagedProviders = [];

    if (this.subscriptionHandle) {
      this.subscriptionHandle.unsubscribe();
      this.subscriptionHandle = null;
    }
    this.updateQueue = [];
    this.flushScheduled = false;
    this.destroyed = true;

    if (writeGate) {
      writeGate.enterClosed();
    }

    const hasErrors = errors.length > 0;
    const checkpointFailed = finalCheckpoint?.status === 'failed';

    return {
      status: checkpointFailed ? 'closeFailed' : hasErrors ? 'closedWithWarnings' : 'closed',
      finalCheckpoint,
      detachedProviders,
      errors,
      timestamp: Date.now(),
    };
  }

  async fullStateCheckpoint(options: RustDocumentFullStateCheckpointOptions = {}): Promise<void> {
    if (this.destroyed) return;
    const importInitialize = options.mode?.kind === 'importInitialize';
    const absorbStagedLiveUpdates = importInitialize && options.absorbStagedLiveUpdates === true;
    const writeGate = this.computeBridge.writeGate as WriteGate | undefined;
    let enteredCheckpointing = false;

    try {
      if (absorbStagedLiveUpdates && !writeGate) {
        throw new Error(
          `Imported document ${this.docId} cannot absorb staged live updates without a write gate`,
        );
      }
      if (absorbStagedLiveUpdates && writeGate) {
        writeGate.enterCheckpointing();
        enteredCheckpointing = true;
      }

      if (importInitialize) {
        if (absorbStagedLiveUpdates) {
          await this.absorbImportInitializeLiveUpdates();
        }
      } else {
        await this.drainBridgePendingUpdatesNow();
        this.drainQueuedUpdatesNow();
        await this.computeBridge.flushUndoCapture();
      }

      const { createBridgeBackedProviderDoc } = await import('./providers/bridge-provider-doc');
      const doc = createBridgeBackedProviderDoc(this.computeBridge, this.docId);
      const checkpointProviders = importInitialize ? this.importStagedProviders : this.providers;
      if (importInitialize && (this.updateQueue.length > 0 || this.flushScheduled)) {
        await this.detachImportStagedProviders('live update queue is not empty');
        throw new Error(
          `Imported document ${this.docId} cannot promote provider: live update queue is not empty`,
        );
      }
      const checkpointResults = await Promise.all(
        checkpointProviders.map((p) => p.checkpointFullState(doc, options.mode)),
      );
      if (importInitialize && checkpointProviders.length > 0) {
        const blocked = checkpointResults.find((result) => result?.status === 'blocked');
        if (blocked?.status === 'blocked') {
          await this.detachImportStagedProviders(blocked.reason);
          throw new Error(
            blocked.message ??
              `Imported document ${this.docId} cannot promote provider: ${blocked.reason}`,
          );
        }
        const uncommittedProvider = checkpointResults.findIndex(
          (result) => !isCommittedCheckpoint(result),
        );
        if (uncommittedProvider !== -1) {
          await this.detachImportStagedProviders('checkpoint did not commit');
          throw new Error(
            `Imported document ${this.docId} cannot promote provider: checkpoint did not commit`,
          );
        }
        if (this.initialProviderBaselineUpdate) {
          await this.detachImportStagedProviders('initial baseline update was captured');
          throw new Error(
            `Imported document ${this.docId} cannot promote provider: initial baseline update was captured`,
          );
        }
        this.providers.push(...checkpointProviders);
        this.importStagedProviders = [];
        this._appendActive = true;
      }
      if (options.publishAfterCommit) {
        await this.touchUserVisibleDoc();
      }
    } finally {
      if (enteredCheckpointing) {
        writeGate?.leaveCheckpointing();
      }
    }
  }

  async fullStateCheckpointFromBridge(
    sourceBridge: ComputeBridge,
    options: Pick<RustDocumentFullStateCheckpointOptions, 'publishAfterCommit'> = {},
  ): Promise<void> {
    if (this.destroyed) return;

    await this.drainBridgePendingUpdatesNow();
    this.drainQueuedUpdatesNow();
    await this.computeBridge.flushUndoCapture();

    const { createBridgeBackedProviderDoc } = await import('./providers/bridge-provider-doc');
    const doc = createBridgeBackedProviderDoc(sourceBridge, this.docId);
    await Promise.all(this.providers.map((p) => p.checkpointFullState(doc, { kind: 'normal' })));
    if (options.publishAfterCommit) {
      await this.touchUserVisibleDoc();
    }
  }

  async runImportInitializeHydration<T>(work: () => Promise<T>): Promise<T> {
    if (this.destroyed) {
      throw new Error('RustDocument.runImportInitializeHydration: document is destroyed');
    }
    if (this.importStagedProviders.length === 0) {
      throw new Error(
        `RustDocument.runImportInitializeHydration requires a staged import Provider for ${this.docId}`,
      );
    }

    const hydrationWork = async (): Promise<T> => {
      this.importInitializeHydrationDepth++;
      try {
        const result = await work();
        await this.drainBridgePendingUpdatesNow();
        return result;
      } finally {
        this.importInitializeHydrationDepth--;
      }
    };

    // Import hydration is a system operation — bypass the write gate.
    const writeGate = this.computeBridge.writeGate as WriteGate | undefined;
    if (writeGate) {
      return writeGate.withBypass(hydrationWork);
    }
    return hydrationWork();
  }

  /**
   * Synchronous-start flush for unload handlers (`visibilitychange →
   * hidden`, `pagehide`). Calls each Provider's `flushSync()` in
   * registration order. **No `await`** — the call is synchronous so the
   * browser can drain any IDB tx the Provider opens before tab death.
   *
   * Individual Providers must be idempotent: a second call with an empty queue
   * is a no-op. The orchestrator may invoke this from both
   * `visibilitychange → hidden` and `pagehide` in the same lifecycle.
   *
   * Failures land on `Provider.flushFailed`; read via `hasFlushFailed`.
   * No throw escapes this method: Providers must catch internally because
   * synchronous failure during unload can't be `await`-recovered.
   */
  flushSync(): void {
    if (this.destroyed) return;
    this.drainQueuedUpdatesNow();
    // Fan out in registration order. Each Provider's `flushSync` is
    // contractually synchronous — see provider.ts line documentation.
    for (const p of this.providers) {
      try {
        p.flushSync();
      } catch (err) {
        // The Provider contract says flushSync MUST NOT throw. If a Provider
        // violates this, log and continue —
        // we still need to invoke remaining Providers' flushSync.
        slog('rustDocument.providerFlushSyncThrew', { error: err });
      }
    }
  }

  /**
   * Destroy the document. Unsubscribes the `update_v1` listener, awaits
   * `detach()` on every attached Provider in parallel, clears the queue.
   * Idempotent — second call short-circuits.
   *
   * Each Provider's `detach()` final-flushes its pending writes, so a
   * `destroy()` round-trip is sufficient for "save and close." For unload,
   * `flushSync()` is the right entry point.
   */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    await this.drainBridgePendingUpdatesNow();
    this.drainQueuedUpdatesNow();
    this.destroyed = true;

    if (this.subscriptionHandle) {
      this.subscriptionHandle.unsubscribe();
      this.subscriptionHandle = null;
    }

    // Detach all Providers in parallel — each one final-flushes per its
    // own contract. We don't drain `updateQueue` first because any updates
    // sitting there were *already* fanned out to Providers in a prior
    // microtask cycle (the queue here is the orchestrator-side staging,
    // not a per-Provider pending list).
    const detachPromises = this.providers.map((p) =>
      p.detach().catch((err) => {
        slog('rustDocument.providerDetachFailedDuringDestroy', { error: err });
      }),
    );
    detachPromises.push(
      ...this.importStagedProviders.map((p) =>
        p.detach().catch((err) => {
          slog('rustDocument.stagedProviderDetachFailedDuringDestroy', { error: err });
        }),
      ),
    );
    this.providers = [];
    this.importStagedProviders = [];
    await Promise.all(detachPromises);

    this.updateQueue = [];
    this.flushScheduled = false;

    this.statusListeners.clear();
  }

  // ---------------------------------------------------------------------------
  // Internal — engine init + update_v1 subscription
  // ---------------------------------------------------------------------------

  private setStatus(status: DocumentStatus, error?: Error): void {
    if (this._status === status && this._error === error) return;
    this._status = status;
    this._error = error;
    for (const listener of this.statusListeners) {
      try {
        listener(status, error);
      } catch (err) {
        slog('rustDocument.statusListenerFailed', { error: err });
      }
    }
  }

  /**
   * Initialize the engine + wire the orchestrator's single
   * `subscribeUpdateV1` subscription. Persistence hydration is no longer
   * here — that's `Provider.attach()`'s job. The orchestrator only owns:
   *   1. Engine creation (CRDT runtime).
   *   2. Subscribing to `update_v1` so live updates fan out to Providers.
   */
  private async initialize(): Promise<void> {
    try {
      this.setStatus('connecting');

      // Create the Rust compute engine (CRDT runtime). The bridge layer
      // owns the choice between WASM and NAPI; we just call createEngine /
      // createEngineFromYrsState and the bridge dispatches.
      if (this.yrsState) {
        await this.computeBridge.createEngineFromYrsState(this.yrsState);
      } else {
        await this.computeBridge.createEngine(this.initialSnapshot);
      }

      this.setStatus('syncing');

      // Wire the single `subscribeUpdateV1` subscription. From this point
      // on, every yrs `update_v1` payload the engine emits lands in
      // `enqueueUpdate` and fans out to all attached Providers. We
      // subscribe here, before the engine sees any user mutations, so the
      // first update is observed.
      this.subscriptionHandle = this.computeBridge.subscribeUpdateV1((update) => {
        this.enqueueUpdate(update);
      });

      this.setStatus('ready');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.setStatus('error', err);
      throw err;
    }
  }

  /**
   * Enqueue a `update_v1` payload for fan-out to all attached Providers.
   *
   * Provider queue contract:
   *   - **FIFO**: pushed onto the queue in arrival order; the drain
   *     iterates in the same order.
   *   - **No reentrancy**: a Provider's `appendUpdate` that synchronously
   *     emits another mutation lands in the *next* drain's frozen
   *     snapshot. We achieve this by replacing `this.updateQueue` with a
   *     fresh empty array *before* iterating — any append-during-drain
   *     mutates the new array, not the snapshot.
   *   - **Backpressure**: synchronous return; if a Provider's `flush()`
   *     is in flight, the per-Provider queue absorbs the load.
   */
  private enqueueUpdate(update: Uint8Array): void {
    if (this.destroyed) return;
    if (this.providerReplayDepth > 0) return;
    if (this.importInitializeHydrationDepth > 0) return;
    if (this.importInitializePromotionDepth > 0) return;
    // Defensive copy — the bridge's subscriber callback may reuse the
    // input buffer between dispatches (see the dispatcher's drain in
    // compute-bridge.ts).
    this.updateQueue.push({ update: new Uint8Array(update), origin: this._currentUpdateOrigin });
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      // Microtask scheduling: same-tick callers (e.g., a bulk transaction
      // that emits N updates) coalesce into one fan-out cycle. Promise
      // microtasks run before any setTimeout, so the bridge dispatcher's
      // setTimeout-driven loop hands updates to us slightly earlier than
      // any I/O reentry would interrupt.
      queueMicrotask(() => {
        this.drainUpdateQueue();
      });
    }
  }

  /**
   * Drain the FIFO queue against a frozen snapshot, fan each entry out to
   * every attached Provider in registration order. Called from the
   * `enqueueUpdate` microtask.
   */
  private drainUpdateQueue(): void {
    // Reset state *before* iterating so any reentrant `enqueueUpdate` calls
    // emitted by Provider.appendUpdate handlers land in a fresh queue.
    // (Providers shouldn't re-emit, but the contract guarantees no
    // interleaving regardless.)
    const batch = this.updateQueue;
    this.updateQueue = [];
    this.flushScheduled = false;

    if (batch.length === 0) return;

    // Snapshot Providers too — `attachProvider`/`detachProvider` during a
    // drain is an unusual pattern, but the contract is "no batch interleaving,"
    // which means the Providers receiving this batch are
    // exactly the ones present at drain start.
    const sinks = this.providers.slice();
    if (sinks.length === 0) {
      // Do not drop causally-significant Yrs updates before the first
      // Provider attaches. A later user edit can depend on an earlier local
      // bootstrap struct by client clock; persisting only the later edit
      // leaves Provider replay with a permanently pending update.
      this.updateQueue = batch.concat(this.updateQueue);
      return;
    }

    const writeGate = this.computeBridge.writeGate as WriteGate | undefined;
    let anyOfferedToProvider = false;
    for (const entry of batch) {
      let offeredToProvider = false;
      for (const p of sinks) {
        if (entry.origin !== 'local' && entry.origin === `provider:${p.name}`) {
          continue;
        }
        offeredToProvider = true;
        try {
          p.appendUpdate(entry.update);
        } catch (err) {
          // Provider contract: `appendUpdate` MUST NOT throw. If a
          // Provider violates this, log and continue — we owe the
          // remaining Providers their fan-out.
          slog('rustDocument.providerAppendUpdateThrew', { error: err });
        }
      }
      if (offeredToProvider) {
        anyOfferedToProvider = true;
        writeGate?.recordMutation();
      }
    }

    // Once we've actually fanned an update out to at least one Provider, the
    // per-mutation incremental write path is live.
    // The flag latches `true` for the lifetime of the orchestrator —
    // `__dt.persistenceEnabled` reads `hasAppendActive` to know the
    // orchestrator has crossed this threshold for at least one doc.
    if (anyOfferedToProvider) {
      this._appendActive = true;
    }
  }

  private drainQueuedUpdatesNow(): void {
    if (this.updateQueue.length === 0 && !this.flushScheduled) return;
    this.drainUpdateQueue();
  }

  private async drainBridgePendingUpdatesNow(): Promise<void> {
    const bridge = this.computeBridge as unknown as {
      flushPendingUpdateV1?: () => Promise<void>;
    };
    await bridge.flushPendingUpdateV1?.();
  }

  private async absorbImportInitializeLiveUpdates(): Promise<void> {
    this.importInitializePromotionDepth++;
    try {
      await this.drainBridgePendingUpdatesNow();
    } finally {
      this.importInitializePromotionDepth--;
    }
    this.updateQueue = [];
    this.flushScheduled = false;
  }

  private appendInitialProviderBaseline(provider: Provider): void {
    if (!this.initialProviderBaselineUpdate) return;
    try {
      provider.appendUpdate(new Uint8Array(this.initialProviderBaselineUpdate));
    } catch (err) {
      slog('rustDocument.providerAppendInitialBaselineThrew', { error: err });
    }
  }

  private async detachImportStagedProviders(reason: string): Promise<void> {
    const staged = this.importStagedProviders;
    this.importStagedProviders = [];
    await Promise.all(
      staged.map((p) =>
        p.detach().catch((err) => {
          slog('rustDocument.stagedProviderDetachFailedAfter', { error: err, reason });
        }),
      ),
    );
  }

  private async touchUserVisibleDoc(): Promise<void> {
    if (this.internal) return;
    try {
      await touchDoc(this.docId);
    } catch (err) {
      // `touchDoc` failure is best-effort: boot precedence tolerates a stale
      // `lastActiveDocId`, and a meta write error never blocks the user's edit.
      // Log and continue.
      slog('rustDocument.touchDocFailed', { error: err });
    }
  }
}

function providerEnvelopeVersion(
  envelope: ProviderInboundUpdateEnvelopeAny,
): 'provider-inbound-update-v1' | 'provider-inbound-update-v2' {
  return isProviderInboundUpdateEnvelopeV2(envelope)
    ? 'provider-inbound-update-v2'
    : 'provider-inbound-update-v1';
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    throw new Error('RustDocument.applyProviderUpdate: SHA-256 digest is unavailable');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function isReadOnlyAttach(result: ProviderAttachResult | void): boolean {
  return result?.status === 'ready' && result.readOnly === true;
}

function isReadyAttach(result: ProviderAttachResult | void): boolean {
  return result?.status === 'ready';
}

function isCommittedCheckpoint(result: ProviderCheckpointResult | void): boolean {
  return result?.status === 'committed';
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a RustDocument and await its `ready` promise. Convenience over
 * `new RustDocument(...)` for callers that want the engine-initialized doc.
 *
 * @returns A RustDocument whose engine is initialized and whose
 *          `update_v1` subscription is live. Caller still needs to attach
 *          Providers (the new `attachProvider` API).
 * @throws  If engine initialization fails.
 */
export async function createRustDocument(options: RustDocumentOptions): Promise<RustDocument> {
  const document = new RustDocument(options);
  await document.ready;
  return document;
}
