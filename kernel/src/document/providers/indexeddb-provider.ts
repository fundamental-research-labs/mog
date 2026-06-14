/**
 * IndexedDBProvider — IDB-backed `Provider` implementation.
 *
 * Owns `snapshots` + `updates` for one docId. The Meta API (sibling module
 * `indexeddb-meta.ts`) owns the `meta` store and is **not** a Provider; both
 * modules share the schema in `indexeddb-schema.ts`.
 *
 * Design notes:
 *   - `appendUpdate` is sync fire-and-forget. It pushes to an in-memory
 *     queue and schedules a microtask drain. Same-tick callers coalesce
 *     into ONE `readwrite` tx (one tx per microtask-batch).
 *   - `flushSync` opens its tx synchronously (no `await` between handler
 *     entry and `tx.put`). pagehide-safe across Chrome/Safari/Firefox.
 *   - On tx-open failure (quota, db locked, version mismatch mid-migration)
 *     `flushSync` sets `flushFailed=true` and returns. Never throws.
 *   - `attach` replays `snapshots[docId]` first, then `updates[docId, *]`
 *     in seq order. Resolves when replay completes.
 *   - Compaction: triggered when `updates` count for this doc > 200 OR after
 *     10s of idle (`requestIdleCallback`). Reads snapshot + log,
 *     applies into a transient ProviderDoc, encodes the new full state via
 *     `encodeDiff(emptySv)`, writes the new snapshot and deletes folded
 *     log entries (seq ≤ read watermark) in one atomic tx.
 *   - Eviction: on every `attach`, sweep `recentDocs` and drop snapshots and
 *     updates for any doc beyond the 50-newest cap or
 *     soft-evict-at-90-days threshold. `lastActiveDocId` is exempt; the
 *     currently-attaching `this.docId` is exempt.
 *
 * Concurrent appendUpdate / compaction race guard: an `appendUpdate` during
 * compaction lands in the post-snapshot segment via the in-memory
 * `seqCounter`. The compactor only deletes seqs ≤ its read watermark, so
 * appends arriving during the compaction tx's lifetime survive correctly.
 *
 */

import type {
  Provider,
  ProviderAttachMode,
  ProviderAttachResult,
  ProviderCheckpointMode,
  ProviderCheckpointResult,
  ProviderDoc,
} from './provider';
import type { StorageProviderCapabilities } from '@mog-sdk/types-document/storage/provider-capabilities';
import type { StorageProviderIdentity } from '@mog-sdk/types-document/storage/provider-identity';
import type {
  IndexedDbProviderConfig,
  StorageProviderConfig,
} from '@mog-sdk/types-document/storage/provider-configs';
import { SNAPSHOTS_STORE, UPDATES_STORE, META_STORE, openDb } from './indexeddb-schema';
import { readMetaUsingDb, writeMetaWithinTx, type RecentDoc } from './indexeddb-meta';
import { getEvictionSink } from '../../context/bridge-devtools-wrapper';

// =============================================================================
// IndexedDB provider constants
// =============================================================================

/** Compaction trigger: updates count for one doc above this fires compact. */
const COMPACTION_UPDATE_THRESHOLD = 200;

/** Idle-fold trigger: ms of no writes before a `requestIdleCallback` fold. */
const COMPACTION_IDLE_MS = 10_000;

/** Eviction: cap on `recentDocs` length (Q2 default). */
const EVICT_MAX_RECENT_DOCS = 50;

/**
 * Eviction: soft-evict docs not touched in this many ms (Q2 default — 90
 * days).  `lastActiveDocId` is exempt regardless of age.
 */
const EVICT_SOFT_AGE_MS = 90 * 24 * 60 * 60 * 1000;

// =============================================================================
// Internal types
// =============================================================================

/** Public construction options for `IndexedDBProvider`. */
export interface IndexedDBProviderOptions {
  /** Whether to run eviction on attach. Defaults true; tests opt out. */
  enableEviction?: boolean;
  /** Whether to run compaction. Defaults true; tests opt out. */
  enableCompaction?: boolean;
}

export type IndexedDBProviderTestOptions = IndexedDBProviderOptions;

// =============================================================================
// IndexedDBProvider
// =============================================================================

export class IndexedDBProvider implements Provider {
  readonly name = 'IndexedDBProvider';

  private readonly docId: string;
  private readonly options: Required<
    Pick<IndexedDBProviderOptions, 'enableEviction' | 'enableCompaction'>
  >;

  /**
   * the storage provider lifecycle typed config, set when constructed via `fromConfig()`.
   * `null` when constructed via the legacy `new IndexedDBProvider(docId)` path.
   */
  private readonly _config: IndexedDbProviderConfig | null = null;

  /** Pending updates awaiting their next microtask drain. */
  private pendingUpdates: Uint8Array[] = [];

  /**
   * Monotonic seq counter for `updates[docId, seq]` keys. Loaded from the
   * max existing seq during `attach` so a Provider re-opened on the same
   * docId continues from where the prior session stopped.
   */
  private seqCounter = 0;

  /**
   * Promise of the currently-scheduled microtask drain, if any. Null when
   * no drain is pending. Reused by `flush()` so concurrent flushers
   * coalesce onto the same drain.
   */
  private pendingDrain: Promise<void> | null = null;

  /** True once `detach` runs. After detach, all calls short-circuit. */
  private detached = false;

  /** True while `attach` is mid-replay; appends queue normally. */
  private attached = false;

  /** Read by orchestrator on `beforeunload`. */
  private _flushFailed = false;

  /**
   * Web Lock read-only state: `true` when another tab holds the exclusive
   * write lock for this docId. In read-only mode `appendUpdate` and `flushSync`
   * are no-ops; the doc is still hydrated from IDB (read path works).
   * Flips to `false` when the primary tab closes and this tab is promoted.
   */
  private _readOnly = false;

  /**
   * Resolves the "hold lock" promise inside the Web Lock callback, releasing
   * the lock when `detach()` is called. `null` in environments without the
   * Web Locks API or when in read-only mode.
   */
  private _lockRelease: (() => void) | null = null;

  /** Cache of the open DB handle for write-path operations after `attach`. */
  private db: IDBDatabase | null = null;

  /** Idle-fold timer, set by `appendUpdate`, cleared on every new append. */
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Number of updates currently held in the on-disk `updates` log for
   * this doc. Used to fire the >200-entries compaction trigger without
   * a fresh count() request after every batch.
   */
  private logCount = 0;

  /** True while a compaction tx is in flight. New appends still land. */
  private compacting = false;

  constructor(docId: string, options: IndexedDBProviderOptions = {}) {
    this.docId = docId;
    this.options = {
      enableEviction: options.enableEviction ?? true,
      enableCompaction: options.enableCompaction ?? true,
    };
  }

  /**
   * the storage provider lifecycle typed-config factory. Accepts an `IndexedDbProviderConfig` and
   * returns a provider with full identity/capabilities reporting.
   *
   * The `databaseName` and `storeName` fields on the config are informational
   * for identity reporting; the actual IDB database/store names are fixed by
   * `indexeddb-schema.ts`.
   */
  static fromConfig(config: IndexedDbProviderConfig): IndexedDBProvider {
    // The config's providerRefId doubles as the docId for this provider.
    const provider = new IndexedDBProvider(config.providerRefId);
    // Store the config for identity/capability queries. Use Object.defineProperty
    // to write the readonly private field after construction.
    Object.defineProperty(provider, '_config', { value: config });
    return provider;
  }

  // ---------------------------------------------------------------------------
  // Public Provider API
  // ---------------------------------------------------------------------------

  get flushFailed(): boolean {
    return this._flushFailed;
  }

  /** `true` while another tab holds the write lock for this docId. */
  get readOnly(): boolean {
    return this._readOnly;
  }

  /**
   * **`__dt`-only inspection surface — never read by production code.**
   *
   * Returns the live `IDBDatabase` handle the Provider is bound to (set on
   * `attach()`, cleared on `detach()`), or `null` if the Provider is not
   * yet attached / has been detached.
   *
   * Exposed so the `__dt.persistenceProviders` getter (see
   * `@mog/devtools/shell-persistence`)
   * can hand the live `db` to a Playwright spec which then shadows
   * `db.transaction()` in-page to drive the real production failure path
   * (mirrors `FailingIndexedDBProvider`'s test-only subclass approach in
   * `__tests__/failing-indexeddb-provider.ts`).
   *
   * Naming convention: dev-only inspection fields are prefixed with
   * `_devtools*` so a future code search makes the intent obvious.
   * Read-only — there is no setter; the Provider continues to own the
   * lifecycle of the underlying handle.
   */
  get _devtoolsDb(): IDBDatabase | null {
    return this.db;
  }

  /**
   * Attach to `doc`. Acquires the Web Lock (`mog:doc:${docId}`) before
   * replaying IDB state, so at most one tab holds the write-lock at a time.
   *
   * Lock behaviour (ifAvailable semantics):
   *   - Lock available → acquired → `doAttach(doc)` replays IDB, Provider
   *     becomes read-write. Lock is held until `detach()`.
   *   - Lock NOT available → `_readOnly = true`, `doAttach(doc)` still
   *     replays IDB (read side works), but `appendUpdate`/`flushSync` are
   *     no-ops. A background lock request queues for auto-promotion once
   *     the primary tab releases.
   *
   * Falls back to normal attach (no lock) in environments without the Web
   * Locks API (SSR, Node, older Safari, Jest/jsdom).
   *
   * Initial-snapshot guarantee: when no IDB data exists for this docId (e.g.
   * first attach after XLSX import), `doAttach` encodes the full doc state via
   * `encodeDiff(emptySv)` and writes it as the initial
   * snapshot. This ensures imported content survives a page refresh even
   * before the user makes any explicit edits.
   */
  async attach(
    doc: ProviderDoc,
    mode: ProviderAttachMode = { kind: 'normal' },
  ): Promise<ProviderAttachResult> {
    if (this.detached) {
      return {
        status: 'blocked',
        mode: mode.kind,
        reason: 'detached',
        message: 'IndexedDBProvider.attach: provider has been detached',
      };
    }
    if (this.attached) {
      return {
        status: 'blocked',
        mode: mode.kind,
        reason: 'alreadyAttached',
        message: 'IndexedDBProvider.attach: provider already attached',
      };
    }

    this.db = await openDb();

    // Web Locks guard. Skip in environments without the API.
    const locks =
      typeof navigator !== 'undefined'
        ? (navigator as unknown as { locks?: LockManager }).locks
        : undefined;
    if (!locks) {
      await this.doAttach(doc, mode);
      return {
        status: 'ready',
        mode: mode.kind,
        readOnly: false,
      };
    }

    const lockName = `mog:doc:${this.docId}`;

    await new Promise<void>((resolveAttach) => {
      void locks.request(lockName, { ifAvailable: true }, async (lock) => {
        if (lock === null) {
          // Another tab owns the write lock — enter read-only mode.
          this._readOnly = true;
          if (mode.kind === 'importInitialize' || mode.kind === 'createFresh') {
            resolveAttach();
            return;
          }
          // Still replay IDB state so the doc content is visible.
          await this.doAttach(doc, mode);
          resolveAttach();
          // Queue for promotion: fires once the primary tab releases.
          this.schedulePromotion(lockName, locks);
          return;
        }
        // Lock acquired — full read-write mode.
        await this.doAttach(doc, mode);
        resolveAttach();
        // Hold lock until detach() resolves this promise.
        await new Promise<void>((holdResolve) => {
          this._lockRelease = holdResolve;
        });
      });
    });

    if ((mode.kind === 'importInitialize' || mode.kind === 'createFresh') && this._readOnly) {
      return {
        status: 'blocked',
        mode: mode.kind,
        reason: 'readOnly',
        message: `IndexedDBProvider cannot attach document ${this.docId} with ${mode.kind}: provider is read-only`,
      };
    }

    return {
      status: 'ready',
      mode: mode.kind,
      readOnly: this._readOnly,
    };
  }

  /**
   * Core attach logic: replay snapshot + updates, write initial snapshot if
   * IDB was empty, then run eviction. Called from both the read-write and
   * read-only paths of `attach()`.
   */
  private async doAttach(
    doc: ProviderDoc,
    mode: ProviderAttachMode = { kind: 'normal' },
  ): Promise<void> {
    if (mode.kind === 'importInitialize') {
      this.seqCounter = 0;
      this.logCount = 0;
      this.pendingUpdates = [];
      this.pendingDrain = null;
      this.attached = true;
      return;
    }

    if (mode.kind === 'createFresh') {
      await this.clearPersistedState(this.db!, this.docId);
      this.seqCounter = 0;
      this.logCount = 0;
      this.pendingUpdates = [];
      this.pendingDrain = null;
      if (!this._readOnly) {
        try {
          const fullState = await doc.encodeDiff(new Uint8Array([0]));
          if (fullState.length > 0) {
            await this.writeSnapshot(this.db!, this.docId, fullState);
          }
        } catch (err) {
          console.warn('[IndexedDBProvider] Failed to write fresh-create snapshot:', err);
        }
      }
      this.attached = true;
      if (this.options.enableEviction) {
        try {
          await this.evictAged(this.db!, this.docId);
        } catch (err) {
          console.error('[IndexedDBProvider] Eviction sweep failed:', err);
        }
      }
      return;
    }

    // 1) Replay snapshot.
    const snapshot = await this.readSnapshot(this.db!, this.docId);
    if (snapshot) {
      await doc.applyUpdate(snapshot);
    }

    // 2) Replay updates in seq order; track max seq.
    const replayed = await this.replayUpdates(this.db!, this.docId, doc);
    this.seqCounter = replayed.maxSeqExclusive;
    this.logCount = replayed.count;

    // 3) Initial-snapshot guarantee: if IDB was completely empty (no snapshot
    //    and no update log — e.g. first attach after XLSX import), encode the
    //    current in-memory doc state and persist it now. Without this, imported
    //    sheet content only ever lives in memory and a page refresh loses
    //    everything the user imported.
    if (!this._readOnly && !snapshot && replayed.count === 0) {
      try {
        const fullState = await doc.encodeDiff(new Uint8Array([0]));
        if (fullState.length > 0) {
          await this.writeSnapshot(this.db!, this.docId, fullState);
        }
      } catch (err) {
        // Best-effort — a failed initial snapshot is a degraded experience
        // (refresh loses the import), not a crash. Log for observability.
        console.warn('[IndexedDBProvider] Failed to write initial snapshot:', err);
      }
    }

    this.attached = true;

    // 4) Eviction sweep — best-effort, errors logged. Current spec: every
    //    `attach` runs the sweep; the currently-attaching doc is exempt.
    if (this.options.enableEviction) {
      try {
        await this.evictAged(this.db!, this.docId);
      } catch (err) {
        console.error('[IndexedDBProvider] Eviction sweep failed:', err);
      }
    }
  }

  /**
   * Queue a lock request (no `ifAvailable`) so this Provider auto-promotes
   * to read-write when the current primary tab releases the lock. Called
   * only in the read-only attach path.
   */
  private schedulePromotion(lockName: string, locks: LockManager): void {
    void locks.request(lockName, async () => {
      if (this.detached) return;
      // Promoted — flip to read-write mode and hold the lock.
      this._readOnly = false;
      await new Promise<void>((holdResolve) => {
        this._lockRelease = holdResolve;
      });
    });
  }

  /**
   * Push `update` into the in-memory queue, schedule a microtask drain
   * (idempotent), and bump the idle-fold timer. Sync, fire-and-forget.
   * Never throws.
   */
  appendUpdate(update: Uint8Array): void {
    if (this.detached) return;
    if (this._readOnly) return;
    // Defensive copy — orchestrator microtask coalescer / yrs callbacks
    // may reuse the input buffer.
    this.pendingUpdates.push(new Uint8Array(update));
    this.scheduleDrain();
    this.bumpIdleTimer();
  }

  /**
   * Drain pending writes through one IDB tx, await `oncomplete`. Coalesces
   * concurrent callers onto the same drain via `pendingDrain`.
   *
   * After draining, may trigger a compaction if `logCount` crossed the
   * threshold. Compaction runs in a separate tx so `flush()` returns once
   * the appended bytes are durable, regardless of compaction outcome.
   */
  async flush(): Promise<void> {
    if (this.detached) return;
    if (this._readOnly) return;

    // Coalesce: if a drain is already scheduled, await it. Coordinator
    // appends before/during a flush land in the next batch via the
    // microtask boundary in `runDrain`.
    if (this.pendingDrain) {
      await this.pendingDrain;
    } else if (this.pendingUpdates.length > 0) {
      this.scheduleDrain();
      if (this.pendingDrain) {
        await this.pendingDrain;
      }
    }

    // Post-drain, decide whether to compact. Run async to keep `flush()`
    // semantics narrow — caller awaits the durable write, not compaction.
    if (this.shouldCompact() && !this.compacting) {
      void this.compact().catch((err) => {
        console.error('[IndexedDBProvider] Compaction failed:', err);
      });
    }
  }

  async checkpointFullState(
    doc: ProviderDoc,
    mode: ProviderCheckpointMode = { kind: 'normal' },
  ): Promise<ProviderCheckpointResult> {
    if (this.detached) {
      return {
        status: 'blocked',
        mode: mode.kind,
        reason: 'detached',
        message: 'IndexedDBProvider.checkpointFullState: provider has been detached',
      };
    }
    if (this._readOnly) {
      return {
        status: 'blocked',
        mode: mode.kind,
        reason: 'readOnly',
        message: `IndexedDBProvider cannot checkpoint document ${this.docId}: provider is read-only`,
      };
    }
    if (!this.db) {
      return {
        status: 'blocked',
        mode: mode.kind,
        reason: 'notAttached',
        message: 'IndexedDBProvider.checkpointFullState: provider is not attached',
      };
    }

    if (mode.kind !== 'importInitialize') {
      await this.flushUntilIdle();
    } else {
      this.pendingUpdates = [];
      this.pendingDrain = null;
    }
    const watermark =
      mode.kind === 'importInitialize' ? Number.POSITIVE_INFINITY : this.seqCounter - 1;
    const fullState = await doc.encodeDiff(new Uint8Array([0]));

    await this.writeFullStateCheckpoint(this.db, this.docId, fullState, watermark);
    this.logCount = await this.countLog(this.db, this.docId);

    // Appends that arrived while the full state was being encoded may or
    // may not be represented by the snapshot depending on timing. Persisting
    // them after the checkpoint is always safe because Yrs updates are
    // idempotent, and it makes the lifecycle barrier durable for edits made
    // during import hydration/checkpoint work.
    if (mode.kind !== 'importInitialize') {
      await this.flushUntilIdle();
    }

    return {
      status: 'committed',
      mode: mode.kind,
    };
  }

  /**
   * Synchronously open a `readwrite` tx on `updates`, `put` every queued
   * entry, return. The browser drains the open tx during unload so long
   * as no `await` separates handler entry from `tx.put`. On tx-open
   * failure, set `flushFailed` and return — never throw.
   *
   * Idempotent: a second call with empty `pendingUpdates` is a no-op
   * (orchestrator may invoke from both `visibilitychange→hidden` and
   * `pagehide` in the same lifecycle).
   */
  flushSync(): void {
    if (this.detached) return;
    if (this._readOnly) return;

    if (this.pendingUpdates.length === 0) return;

    if (!this.db) {
      // Cannot start a tx without an open DB handle. Set the flag for the
      // beforeunload prompt; bytes stay in memory.
      this._flushFailed = true;
      return;
    }

    let tx: IDBTransaction;
    try {
      tx = this.db.transaction(UPDATES_STORE, 'readwrite');
    } catch (err) {
      // Db closing / version mismatch / quota mid-migration. Do not throw;
      // set the flag for the orchestrator's beforeunload handler to read.
      console.error('[IndexedDBProvider] flushSync tx open failed:', err);
      this._flushFailed = true;
      return;
    }

    const store = tx.objectStore(UPDATES_STORE);
    const batch = this.pendingUpdates;
    this.pendingUpdates = [];

    for (const update of batch) {
      const seq = this.seqCounter++;
      // Synchronous put — we do NOT await. The browser will keep the tx
      // alive during unload as long as the handler returns control before
      // the next macrotask.
      store.put(update, [this.docId, seq]);
      this.logCount++;
    }

    // Successful sync-drain clears any lingering failure flag from a
    // prior partially-failed lifecycle.
    this._flushFailed = false;
  }

  /** Final flush + cleanup. Idempotent. */
  async detach(): Promise<void> {
    if (this.detached) return;
    this.detached = true;

    // Release the Web Lock (if held). Calling the resolver lets the
    // lock callback return, which releases the lock in the browser. This
    // must run BEFORE the final drain so that any queued tab-B promotion
    // can start acquiring the lock while we still hold it (browser lock
    // manager queues the request; actual transfer happens after we yield).
    this._lockRelease?.();
    this._lockRelease = null;

    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    // Drain anything still pending. We bypass the `detached` guard inside
    // `flush()` by talking directly to `runDrain` — the flag is set so
    // future `appendUpdate` calls are no-ops, but this final drain must
    // commit.
    if (this.pendingUpdates.length > 0) {
      await this.runFinalDrain();
    } else if (this.pendingDrain) {
      // A drain scheduled before detach is in flight; wait for it.
      await this.pendingDrain;
    }

    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Provider's view of persisted state. Used by future websocket
   * Providers for diff requests; for IndexedDB Current it is a deterministic
   * function of the snapshot + log size, not the doc's yrs SV.
   *
   * Cursor shape: 8 bytes — 4-byte seqCounter (BE) || 4-byte logCount (BE).
   * The conformance suite uses `uint8sEqual(svBefore, svAfter)` to detect
   * "did SV advance after a flush" — the encoding is implementation-defined
   * but must change when state changes.
   *
   * @deprecated the storage provider lifecycle renames this to `storageCursor()`. This method is
   * kept for backward compatibility with the existing `Provider` interface
   * and conformance suite.
   */
  async stateVector(): Promise<Uint8Array> {
    return this.storageCursor();
  }

  /**
   * Storage-diagnostic cursor (the storage provider lifecycle). Reports an opaque 8-byte token
   * that changes whenever persisted state changes. This is NOT a real Yrs
   * state vector — it encodes `[seqCounter, logCount]` as two big-endian
   * uint32s. The capability `yrsStateVectorDiff: false` reflects this.
   *
   * Cursor shape: 8 bytes — 4-byte seqCounter (BE) || 4-byte logCount (BE).
   */
  async storageCursor(): Promise<Uint8Array> {
    const out = new Uint8Array(8);
    const seq = this.seqCounter >>> 0;
    const count = this.logCount >>> 0;
    out[0] = (seq >>> 24) & 0xff;
    out[1] = (seq >>> 16) & 0xff;
    out[2] = (seq >>> 8) & 0xff;
    out[3] = seq & 0xff;
    out[4] = (count >>> 24) & 0xff;
    out[5] = (count >>> 16) & 0xff;
    out[6] = (count >>> 8) & 0xff;
    out[7] = count & 0xff;
    return out;
  }

  // ---------------------------------------------------------------------------
  // the storage provider lifecycle — Capabilities, Identity, Config
  // ---------------------------------------------------------------------------

  /**
   * Report this provider's capability flags (the storage provider lifecycle).
   */
  getCapabilities(): StorageProviderCapabilities {
    return {
      writable: true,
      durable: true,
      synchronousFlushStart: true,
      fullStateCheckpoint: true,
      incrementalUpdateLog: true,
      yrsStateVectorDiff: false,
      storageCursor: true,
      subscriptions: false,
      exclusiveWriteLock: true,
      readOnlyFallback: true,
      offlineOpen: true,
      reconnect: false,
      inboundUpdates: false,
      idempotentRemoteUpdates: false,
      binaryAssets: false,
      assetContentAddressing: false,
      assetGarbageCollection: false,
      assetAtomicCommit: false,
      atomicBatch: true,
    };
  }

  /**
   * Report this provider's identity (the storage provider lifecycle).
   *
   * When constructed via `fromConfig()`, returns identity derived from
   * the typed config. When constructed via the legacy constructor, returns
   * a synthetic identity based on the docId.
   */
  getIdentity(): StorageProviderIdentity {
    if (this._config) {
      return {
        providerRefId: this._config.providerRefId,
        storageScope: this._config.storageScope,
        contractVersion: '03.1',
        providerProtocolVersion: '1.0',
        storageSchemaVersion: String(this._config.schemaVersion),
      };
    }
    // Legacy constructor path — synthesize identity from docId.
    return {
      providerRefId: `indexeddb:${this.docId}`,
      storageScope: {
        kind: 'scoped',
        scope: {
          tenantId: { kind: 'single-tenant' },
          workspaceId: { kind: 'no-workspace' },
          documentId: this.docId,
        },
      },
      contractVersion: '03.1',
      providerProtocolVersion: '1.0',
      storageSchemaVersion: '2',
    };
  }

  // ---------------------------------------------------------------------------
  // Microtask drain
  // ---------------------------------------------------------------------------

  /**
   * Schedule a microtask drain if none is pending. Coalesces every
   * `appendUpdate` in the same tick into one tx.
   */
  private scheduleDrain(): void {
    if (this.pendingDrain) return;
    if (this.detached) return;

    this.pendingDrain = (async () => {
      // Microtask boundary so a sync caller doing
      // `appendUpdate(); appendUpdate(); await flush()`
      // sees both appends in the SAME drain. Also models the reentrancy
      // contract: appends emitted DURING the drain land in the NEXT batch,
      // not this one.
      await Promise.resolve();
      try {
        await this.runDrain();
      } catch (drainErr) {
        console.error('[IndexedDBProvider] scheduleDrain: runDrain threw:', drainErr);
      } finally {
        this.pendingDrain = null;
      }
    })();
  }

  /**
   * One drain cycle: snapshot `pendingUpdates`, open tx, put each, await
   * tx oncomplete. Updates that arrive during this cycle stay in
   * `pendingUpdates` for the next call.
   */
  private async runDrain(): Promise<void> {
    if (this.pendingUpdates.length === 0) return;
    if (!this.db) {
      // Should not happen post-attach, but if it does — drop silently
      // until attach (re)opens. We still clear the queue to avoid
      // unbounded memory.
      this.pendingUpdates = [];
      return;
    }

    // Freeze the batch — appendUpdate during this drain doesn't mutate
    // `batch`, only future drains.
    const batch = this.pendingUpdates;
    this.pendingUpdates = [];

    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(UPDATES_STORE, 'readwrite');
      const store = tx.objectStore(UPDATES_STORE);
      for (const update of batch) {
        const seq = this.seqCounter++;
        store.put(update, [this.docId, seq]);
        this.logCount++;
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        reject(tx.error ?? new Error('updates tx error'));
      };
      tx.onabort = () => {
        reject(tx.error ?? new Error('updates tx abort'));
      };
    });
  }

  private async flushUntilIdle(): Promise<void> {
    for (;;) {
      await this.flush();
      if (this.pendingUpdates.length === 0 && !this.pendingDrain) return;
    }
  }

  /**
   * Final drain at detach time. Same shape as `runDrain` but ignores the
   * `detached` guard so the last bytes commit.
   */
  private async runFinalDrain(): Promise<void> {
    if (!this.db) return;
    if (this.pendingUpdates.length === 0) return;

    const batch = this.pendingUpdates;
    this.pendingUpdates = [];

    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(UPDATES_STORE, 'readwrite');
      const store = tx.objectStore(UPDATES_STORE);
      for (const update of batch) {
        const seq = this.seqCounter++;
        store.put(update, [this.docId, seq]);
        this.logCount++;
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('updates tx error'));
      tx.onabort = () => reject(tx.error ?? new Error('updates tx abort'));
    });
  }

  // ---------------------------------------------------------------------------
  // Read paths (attach replay)
  // ---------------------------------------------------------------------------

  private async writeSnapshot(db: IDBDatabase, docId: string, snapshot: Uint8Array): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SNAPSHOTS_STORE, 'readwrite');
      tx.objectStore(SNAPSHOTS_STORE).put(snapshot, docId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('snapshot write failed'));
      tx.onabort = () => reject(tx.error ?? new Error('snapshot write aborted'));
    });
  }

  private async readSnapshot(db: IDBDatabase, docId: string): Promise<Uint8Array | null> {
    return new Promise<Uint8Array | null>((resolve, reject) => {
      const tx = db.transaction(SNAPSHOTS_STORE, 'readonly');
      const store = tx.objectStore(SNAPSHOTS_STORE);
      const req = store.get(docId);
      req.onsuccess = () => {
        const result = req.result;
        if (result instanceof Uint8Array) {
          resolve(result);
        } else if (result instanceof ArrayBuffer) {
          resolve(new Uint8Array(result));
        } else {
          resolve(null);
        }
      };
      req.onerror = () => reject(req.error ?? new Error('snapshot read failed'));
    });
  }

  private async clearPersistedState(db: IDBDatabase, docId: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction([SNAPSHOTS_STORE, UPDATES_STORE], 'readwrite');
      tx.objectStore(SNAPSHOTS_STORE).delete(docId);
      tx.objectStore(UPDATES_STORE).delete(
        IDBKeyRange.bound([docId, -Infinity], [docId, Infinity]),
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('clear persisted state failed'));
      tx.onabort = () => reject(tx.error ?? new Error('clear persisted state aborted'));
    });
  }

  /**
   * Cursor-walk `updates[docId, *]` in seq order, applying each into `doc`.
   * Returns the count of updates applied + the next-seq value (max+1).
   */
  private async replayUpdates(
    db: IDBDatabase,
    docId: string,
    doc: ProviderDoc,
  ): Promise<{ count: number; maxSeqExclusive: number }> {
    return new Promise<{ count: number; maxSeqExclusive: number }>((resolve, reject) => {
      const tx = db.transaction(UPDATES_STORE, 'readonly');
      const store = tx.objectStore(UPDATES_STORE);
      // IDBKeyRange — bound to all entries whose key starts with `docId`.
      const range = IDBKeyRange.bound([docId, -Infinity], [docId, Infinity]);
      const cursorReq = store.openCursor(range);

      const collected: Array<{ key: [string, number]; value: Uint8Array }> = [];
      let maxSeq = -1;

      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          const key = cursor.key as [string, number];
          const value = cursor.value;
          const bytes =
            value instanceof Uint8Array
              ? value
              : value instanceof ArrayBuffer
                ? new Uint8Array(value)
                : null;
          if (bytes) {
            collected.push({ key, value: bytes });
            if (key[1] > maxSeq) maxSeq = key[1];
          }
          cursor.continue();
        }
      };
      cursorReq.onerror = () => reject(cursorReq.error ?? new Error('replay cursor failed'));

      tx.oncomplete = async () => {
        // Apply outside the IDB tx — `doc.applyUpdate` is async (it may
        // round-trip through the bridge in production) and we cannot
        // hold an IDB tx across an `await`.
        try {
          for (const entry of collected) {
            await doc.applyUpdate(entry.value);
          }
          resolve({
            count: collected.length,
            maxSeqExclusive: maxSeq + 1,
          });
        } catch (err) {
          reject(err);
        }
      };
      tx.onerror = () => reject(tx.error ?? new Error('replay tx failed'));
      tx.onabort = () => reject(tx.error ?? new Error('replay tx aborted'));
    });
  }

  // ---------------------------------------------------------------------------
  // Compaction
  // ---------------------------------------------------------------------------

  private shouldCompact(): boolean {
    return this.options.enableCompaction && this.logCount > COMPACTION_UPDATE_THRESHOLD;
  }

  /**
   * Bump or set the idle-compaction timer. Cleared on every new append;
   * fires `compact()` after `COMPACTION_IDLE_MS` of no writes.
   */
  private bumpIdleTimer(): void {
    if (!this.options.enableCompaction) return;
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.detached || this.compacting) return;
      if (this.logCount === 0) return;
      void this.compact().catch((err) => {
        console.error('[IndexedDBProvider] Idle compaction failed:', err);
      });
    }, COMPACTION_IDLE_MS);
  }

  /**
   * Fold `snapshots[docId] + updates[docId, ≤watermark]` into a new snapshot.
   * Race-safe: appends arriving during compaction land at seqs > watermark
   * and survive.
   */
  private async compact(): Promise<void> {
    if (this.compacting) return;
    if (!this.db) return;
    this.compacting = true;
    try {
      // Step 1: drain anything pending so the snapshot includes the
      // latest visible state. Use `runDrain` directly since we are
      // already inside the Provider's lifetime.
      if (this.pendingUpdates.length > 0) {
        await this.runDrain();
      }

      // Step 2: read snapshot + log inside ONE readonly tx for
      // consistency. `watermark` is the max seq we read; appends that
      // arrive after this tx completes get higher seqs and survive.
      const { snapshot, log, watermark } = await this.readForCompaction(this.db, this.docId);
      if (log.length === 0) return;

      // Step 3: replay snapshot + log into a transient ProviderDoc, then
      // ask it for a fresh full-state encoding.
      //
      // We accept any ProviderDoc factory through a side door: the
      // Provider doesn't own one. Default path — call the orchestrator-
      // attached doc's `encodeDiff(emptySV)` indirectly by constructing a
      // ProviderDoc from the same factory the test/orchestrator passes.
      //
      // Compaction is gated behind a ProviderDoc factory the orchestrator sets
      // via `setProviderDocFactory`. The conformance suite leaves it unset,
      // which is fine because the conformance threshold (200 updates per test)
      // is not crossed.
      if (!this.providerDocFactory) return;

      const transient = this.providerDocFactory(`__compact-${this.docId}`);
      if (snapshot) await transient.applyUpdate(snapshot);
      for (const update of log) await transient.applyUpdate(update);

      // `encodeDiff(remoteSv)` with an empty state vector should produce the
      // full state. yrs `StateVector::default()` v1-encodes to `[0]` (a
      // single varint zero — no client entries), not `[]`. The Rust
      // `encode_diff` decoder rejects zero-byte input as "unexpected end of
      // buffer". Send the explicit empty-SV encoding instead. This matches
      // the byte sequence `compute_collab::encode_state_vector` produces
      // for a fresh `Doc`, so the round-trip is symmetric with the
      // production replay path.
      const newSnapshot = await transient.encodeDiff(new Uint8Array([0]));

      // Step 4: atomic write — new snapshot in, log entries up to
      // watermark out. One tx covers both stores.
      await this.writeCompactionResult(this.db, this.docId, newSnapshot, watermark);
      // Update local logCount: we deleted (watermark+1) entries that
      // existed at compaction-read time. Appends since then are still in
      // logCount; we recompute from the current log state for safety.
      this.logCount = await this.countLog(this.db, this.docId);
    } finally {
      this.compacting = false;
    }
  }

  /**
   * Optional ProviderDoc factory used during compaction. The orchestrator sets
   * this so a transient doc can be built without circular imports between
   * Provider and Doc layers. Tests that don't cross the 200-update threshold
   * can leave this unset.
   */
  private providerDocFactory: ((docId: string) => ProviderDoc) | null = null;

  /**
   * Wire the ProviderDoc factory used by compaction. Called by the
   * orchestrator after construction; tests may call it explicitly to
   * exercise the compaction path.
   */
  setProviderDocFactory(factory: (docId: string) => ProviderDoc): void {
    this.providerDocFactory = factory;
  }

  private async readForCompaction(
    db: IDBDatabase,
    docId: string,
  ): Promise<{
    snapshot: Uint8Array | null;
    log: Uint8Array[];
    watermark: number;
  }> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([SNAPSHOTS_STORE, UPDATES_STORE], 'readonly');
      const snapshotStore = tx.objectStore(SNAPSHOTS_STORE);
      const updatesStore = tx.objectStore(UPDATES_STORE);

      let snapshot: Uint8Array | null = null;
      const log: Uint8Array[] = [];
      let watermark = -1;

      const snapReq = snapshotStore.get(docId);
      snapReq.onsuccess = () => {
        const v = snapReq.result;
        snapshot =
          v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : null;
      };

      const range = IDBKeyRange.bound([docId, -Infinity], [docId, Infinity]);
      const cursorReq = updatesStore.openCursor(range);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          const key = cursor.key as [string, number];
          const value = cursor.value;
          const bytes =
            value instanceof Uint8Array
              ? value
              : value instanceof ArrayBuffer
                ? new Uint8Array(value)
                : null;
          if (bytes) {
            log.push(bytes);
            if (key[1] > watermark) watermark = key[1];
          }
          cursor.continue();
        }
      };
      cursorReq.onerror = () => reject(cursorReq.error ?? new Error('compact cursor failed'));

      tx.oncomplete = () => resolve({ snapshot, log, watermark });
      tx.onerror = () => reject(tx.error ?? new Error('compact read tx failed'));
      tx.onabort = () => reject(tx.error ?? new Error('compact read tx aborted'));
    });
  }

  private async writeCompactionResult(
    db: IDBDatabase,
    docId: string,
    newSnapshot: Uint8Array,
    watermark: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([SNAPSHOTS_STORE, UPDATES_STORE], 'readwrite');
      const snapshotStore = tx.objectStore(SNAPSHOTS_STORE);
      const updatesStore = tx.objectStore(UPDATES_STORE);

      snapshotStore.put(newSnapshot, docId);

      // Delete only seqs ≤ watermark. Concurrent appends with seqs > watermark
      // survive.
      const range = IDBKeyRange.bound([docId, -Infinity], [docId, watermark]);
      updatesStore.delete(range);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('compact write tx failed'));
      tx.onabort = () => reject(tx.error ?? new Error('compact write tx aborted'));
    });
  }

  private async writeFullStateCheckpoint(
    db: IDBDatabase,
    docId: string,
    snapshot: Uint8Array,
    watermark: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([SNAPSHOTS_STORE, UPDATES_STORE], 'readwrite');
      const snapshotStore = tx.objectStore(SNAPSHOTS_STORE);
      const updatesStore = tx.objectStore(UPDATES_STORE);

      snapshotStore.put(snapshot, docId);
      if (watermark === Number.POSITIVE_INFINITY) {
        updatesStore.delete(IDBKeyRange.bound([docId, -Infinity], [docId, Infinity]));
      } else if (watermark >= 0) {
        updatesStore.delete(IDBKeyRange.bound([docId, -Infinity], [docId, watermark]));
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('full checkpoint write tx failed'));
      tx.onabort = () => reject(tx.error ?? new Error('full checkpoint write tx aborted'));
    });
  }

  private async countLog(db: IDBDatabase, docId: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(UPDATES_STORE, 'readonly');
      const store = tx.objectStore(UPDATES_STORE);
      const range = IDBKeyRange.bound([docId, -Infinity], [docId, Infinity]);
      const req = store.count(range);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('count failed'));
    });
  }

  // ---------------------------------------------------------------------------
  // Eviction
  // ---------------------------------------------------------------------------

  /**
   * Eviction sweep. Called from `attach`. Rules:
   *   - Cap `recentDocs` at the 50 newest entries.
   *   - Soft-evict at most one aged eligible doc per attach.
   *   - Exempt: `lastActiveDocId`, the currently-attaching `selfDocId`.
   *
   * Eviction deletes `snapshots[docId]` + `updates[docId, *]` + the
   * meta `recentDocs` entry, all in one atomic tx.
   */
  private async evictAged(db: IDBDatabase, selfDocId: string): Promise<void> {
    const meta = await readMetaUsingDb(db);
    const exempt = new Set<string>();
    exempt.add(selfDocId);
    if (meta.lastActiveDocId) exempt.add(meta.lastActiveDocId);

    const now = Date.now();
    const sortedRecent = [...meta.recentDocs].sort((a, b) => b.lastTouchedAt - a.lastTouchedAt);

    const eligibleOldestFirst = sortedRecent
      .filter((entry) => !exempt.has(entry.docId))
      .sort((a, b) => a.lastTouchedAt - b.lastTouchedAt);
    const overCapCount = Math.max(0, sortedRecent.length - EVICT_MAX_RECENT_DOCS);
    const hasAgedEligibleDoc = eligibleOldestFirst.some(
      (entry) => now - entry.lastTouchedAt > EVICT_SOFT_AGE_MS,
    );
    const evictCount = Math.min(
      eligibleOldestFirst.length,
      Math.max(overCapCount, hasAgedEligibleDoc ? 1 : 0),
    );
    const toEvict = eligibleOldestFirst.slice(0, evictCount).map((entry) => entry.docId);

    if (toEvict.length === 0) return;

    const evictSet = new Set(toEvict);
    const keep: RecentDoc[] = sortedRecent.filter((entry) => !evictSet.has(entry.docId));

    // Atomic delete: snapshots[evictId] + updates[evictId, *] + meta.recentDocs.
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([SNAPSHOTS_STORE, UPDATES_STORE, META_STORE], 'readwrite');
      const snapshots = tx.objectStore(SNAPSHOTS_STORE);
      const updates = tx.objectStore(UPDATES_STORE);

      for (const evictId of toEvict) {
        snapshots.delete(evictId);
        updates.delete(IDBKeyRange.bound([evictId, -Infinity], [evictId, Infinity]));
      }

      writeMetaWithinTx(tx, {
        recentDocs: keep,
        lastActiveDocId: meta.lastActiveDocId,
      });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('evict tx failed'));
      tx.onabort = () => reject(tx.error ?? new Error('evict tx aborted'));
    });

    // Emit a user-observable warning so quota-exceeded verification can find it
    // via __dt.getRecentErrors() (source contains "evict"). Route the event
    // through the injected eviction sink rather than reaching for
    // globalThis.__dt in production code.
    const msg = `[IndexedDB eviction] Evicted ${toEvict.length} doc(s) from IDB (quota/age threshold). Evicted: ${toEvict.slice(0, 5).join(', ')}${toEvict.length > 5 ? '…' : ''}`;
    console.warn(msg);
    const sink = getEvictionSink();
    if (sink) {
      try {
        sink({
          evictedCount: toEvict.length,
          evictedDocIds: toEvict,
          message: msg,
        });
      } catch (err) {
        // Sink threw — already logged via console.warn above.
        console.error('[IndexedDBProvider] eviction sink threw:', err);
      }
    }
  }
}

// =============================================================================
// the storage provider lifecycle — Provider Factory
// =============================================================================

/**
 * Provider instance as returned by a the storage provider lifecycle factory. Bundles the provider
 * with its config and capabilities so the registry/lifecycle can reason
 * about providers without calling methods on the provider itself.
 */
export interface IndexedDbProviderInstance {
  readonly config: IndexedDbProviderConfig;
  readonly provider: IndexedDBProvider;
  readonly capabilities: StorageProviderCapabilities;
}

/**
 * Factory function for creating IndexedDB providers from typed config (the storage provider lifecycle).
 *
 * Usage:
 * ```ts
 * const factory = createIndexedDbProviderFactory();
 * const instance = await factory(config);
 * ```
 */
export function createIndexedDbProviderFactory(): (
  config: StorageProviderConfig,
) => Promise<IndexedDbProviderInstance> {
  return async (config: StorageProviderConfig): Promise<IndexedDbProviderInstance> => {
    if (config.kind !== 'indexeddb') {
      throw new Error(
        `createIndexedDbProviderFactory: expected kind 'indexeddb', got '${config.kind}'`,
      );
    }
    const idbConfig = config as IndexedDbProviderConfig;
    const provider = IndexedDBProvider.fromConfig(idbConfig);
    return {
      config: idbConfig,
      provider,
      capabilities: provider.getCapabilities(),
    };
  };
}

// =============================================================================
// hasPersistedSnapshot — boot-precedence helper
// =============================================================================

/**
 * Existence probe for a doc's persisted state. Used by the boot precedence
 * table in `dev/app/src/App.tsx` to decide whether `?doc=<id>`
 * (or `lastActiveDocId`) points at a real (hydratable) doc or an
 * evicted/foreign id that should fall back to the welcome screen.
 *
 * Read-only across the `snapshots` AND `updates` stores — the provider's
 * IndexedDBProvider only writes snapshots during compaction, so
 * a doc that has only had incremental updates (no compaction yet) has
 * `snapshots[docId]` empty but a non-empty `updates` log. Both forms
 * are hydratable: `attach()` replays snapshot then walks the updates
 * log. The probe must accept either.
 *
 * Returns `false` only when both stores are empty for `docId` (truly
 * evicted / never-seen). Resolves `false` on a fresh DB; rejects only
 * on tx-level IDB errors.
 *
 * Pre-fix bug: the probe checked only `snapshots`, so a freshly-edited
 * doc (updates log non-empty, snapshot not yet generated) failed the
 * boot precedence's hydration gate, App.tsx fell through to welcome,
 * and `__dt.persistenceEnabled` stayed false because no doc was
 * hydrated. Reload-class scenarios pass through this surface, so this fixes
 * the full reload family instead of only one path.
 */
export async function hasPersistedSnapshot(docId: string): Promise<boolean> {
  const db = await openDb();
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction([SNAPSHOTS_STORE, UPDATES_STORE], 'readonly');
      let snapshotCount = 0;
      let updatesCount = 0;
      let pending = 2;

      const finish = () => {
        if (--pending > 0) return;
        resolve(snapshotCount > 0 || updatesCount > 0);
      };

      const snapReq = tx.objectStore(SNAPSHOTS_STORE).count(docId);
      snapReq.onsuccess = () => {
        snapshotCount = snapReq.result ?? 0;
        finish();
      };

      // Updates use a compound `[docId, seq]` key — count via a key range
      // bounded by [docId, -Inf]..[docId, +Inf] which covers every seq
      // for this docId regardless of how high the counter has climbed.
      const range = IDBKeyRange.bound([docId, -Infinity], [docId, Infinity]);
      const updReq = tx.objectStore(UPDATES_STORE).count(range);
      updReq.onsuccess = () => {
        updatesCount = updReq.result ?? 0;
        finish();
      };

      tx.onerror = () => reject(tx.error ?? new Error('hasPersistedSnapshot: tx failed'));
      tx.onabort = () => reject(tx.error ?? new Error('hasPersistedSnapshot: tx aborted'));
    });
  } finally {
    db.close();
  }
}
