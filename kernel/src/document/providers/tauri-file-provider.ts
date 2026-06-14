/**
 * TauriFileProvider
 *
 * Wraps the existing native I/O at `runtime/src-tauri/src/commands/xlsx.rs`
 * behind the `Provider` interface so the orchestrator (`RustDocument`)
 * can fan updates to it uniformly across web (IndexedDB) and Tauri (file)
 * deployments.
 *
 * This formalizes the interface without changing native XLSX behavior. The
 * existing native XLSX I/O continues to be triggered by user "Save" through
 * the Tauri menu — this Provider does not write XLSX on every
 * yrs update. It does, however, persist the yrs `update_v1` byte stream so
 * the orchestrator's contract round-trips through `attach → appendUpdate →
 * detach → re-attach`. That stream is held in a Tauri-side sidecar log keyed
 * by docId, accessed via the `TauriIpc` injected at construction time.
 *
 * **Deferred storage question:** XLSX is the file format on disk; yrs
 * updates need a sidecar. The current implementation keeps the shim abstract
 * by going through the IPC interface.
 *
 * **Storage gap:** the `xlsx.rs` Tauri commands at
 * the time of this commit expose `import_xlsx` and `export_xlsx` (full-file
 * read/write). They do **not** expose per-doc yrs-update sidecar I/O. To
 * keep prod honest, the prod-mode `TauriFileProvider` constructed without
 * a custom IPC throws on `attach()` with a clear error explaining the missing
 * sidecar IPC. Tests inject `TauriIpcStub` to exercise the conformance contract.
 *
 * @see ./__tests__/tauri-ipc-stub.ts — the stub used by the conformance suite
 */

import type {
  Provider,
  ProviderAttachMode,
  ProviderAttachResult,
  ProviderCheckpointResult,
  ProviderDoc,
} from './provider';
import type { StorageProviderCapabilities } from '@mog-sdk/types-document/storage/provider-capabilities';
import type { StorageProviderIdentity } from '@mog-sdk/types-document/storage/provider-identity';

/**
 * Minimal Tauri IPC surface this Provider depends on.
 *
 * Intentionally narrow — we only need yrs-update sidecar I/O. Tests inject
 * an in-memory `TauriIpcStub` that emulates these calls; prod injects an
 * adapter over `window.__TAURI__.invoke` (or `@tauri-apps/api/core`'s
 * `invoke`) once the corresponding Rust commands are wired.
 *
 * The five methods correspond 1:1 to Tauri commands the runtime would
 * register:
 *   - `tauri_load_updates(docId)` — return the persisted yrs update log
 *     for the doc, in arrival order. Empty array if first attach.
 *   - `tauri_append_update(docId, update)` — durably append one update
 *     to the doc's log. Resolves once the OS has accepted the bytes for
 *     write (Tauri's tokio fs is the analog of IndexedDB's tx.oncomplete).
 *   - `tauri_clear_document_state(docId)` — delete any sidecar state for
 *     a fresh create using an existing document id.
 *   - `tauri_state_vector(docId)` — return the doc's persisted state
 *     vector view (a hash-derived summary of "which updates are stored").
 *     Used for diff requests in future websocket transports.
 *   - `tauri_flush_sync(docId, pending)` — synchronously start a durable
 *     write of all pending updates. Tauri's IPC is async-by-default, but
 *     pagehide on Tauri is far less hostile than browser pagehide (the OS
 *     gives processes a graceful shutdown window), so a synchronously-
 *     queued ipc dispatch is sufficient. Returns void.
 *
 * Until native sidecar commands are wired in `xlsx.rs`, the production constructor
 * throws on `attach()` — see top-of-file note.
 */
export interface TauriIpc {
  loadUpdates(docId: string): Promise<Uint8Array[]>;
  appendUpdate(docId: string, update: Uint8Array): Promise<void>;
  clearDocumentState(docId: string): Promise<void>;
  stateVector(docId: string): Promise<Uint8Array>;
  /**
   * Synchronously dispatch a durable write of `pending`. Implementations
   * MUST start the underlying tx / fs syscall before returning so the
   * shutdown path can drain it; they MUST NOT throw (set `failed: true`
   * on the returned status instead — analogous to IndexedDB's `flushFailed`).
   */
  flushSync(docId: string, pending: Uint8Array[]): { failed: boolean };
}

/**
 * Test/native-sidecar injection point. Production uses the default constructor
 * which constructs a real IPC adapter on demand (and throws if the runtime
 * isn't Tauri).
 */
export interface TauriFileProviderOptions {
  /**
   * Inject a custom IPC client. Tests pass a `TauriIpcStub`. A production
   * adapter passes a real `@tauri-apps/api/core`-backed adapter.
   *
   * If omitted, the constructor records "not yet wired" — `attach()`
   * throws when called. This keeps the import path live (so future
   * production wiring lands by passing the real IPC, not by editing the
   * Provider) without silently no-op-ing in shipping builds.
   */
  ipc?: TauriIpc;
}

/**
 * Sentinel error message used by `attach()` when no IPC was injected and
 * we've detected a Tauri runtime but the corresponding Rust commands are
 * not yet wired. Native sidecar commands will remove this throw path.
 */
const TAURI_SIDECAR_NOT_WIRED_MSG =
  'Tauri persistence: NOT YET WIRED. ' +
  'TauriFileProvider needs `tauri_load_updates` / `tauri_append_update` / ' +
  '`tauri_clear_document_state` / `tauri_state_vector` / `tauri_flush_sync` Rust commands; xlsx.rs only ' +
  'exposes import_xlsx + export_xlsx today. Inject a `TauriIpc` via ' +
  '`new TauriFileProvider(docId, { ipc })` (tests use TauriIpcStub).';

/**
 * Sentinel error message used by the constructor when neither a `TauriIpc`
 * nor a Tauri runtime is available. Misuse — calling code is on the web
 * path and should be using `IndexedDBProvider` instead.
 */
const NOT_IN_TAURI_MSG =
  'TauriFileProvider: not running in Tauri (window.__TAURI__ undefined) ' +
  'and no `ipc` injected. On web, attach IndexedDBProvider instead.';

/**
 * Detect a Tauri runtime via the `window.__TAURI__` global injected by
 * the Tauri webview at boot. Returns `false` in jest/jsdom (where no
 * window-level Tauri global exists) and on the web build.
 *
 * We probe via `globalThis` so unit tests running under jest's node
 * test-env (no `window` binding at all) can still simulate a Tauri
 * runtime by setting `globalThis.window = { __TAURI__: ... }` — which
 * matches the shape jsdom would expose if the suite were configured
 * for browser-mode. The runtime-guard tests in this Provider's spec
 * use that approach.
 */
function detectTauriRuntime(): boolean {
  const g = globalThis as { window?: { __TAURI__?: unknown } };
  if (typeof g.window === 'undefined') return false;
  return typeof g.window.__TAURI__ !== 'undefined';
}

/**
 * Build a real Tauri-runtime-backed IPC. Stubbed until the matching Rust
 * commands exist; once they do, this body becomes a thin wrapper around
 * `secureInvoke` (or `@tauri-apps/api/core`'s `invoke` for non-secured commands).
 *
 * Until then, this is the explicit "NOT YET WIRED" path: `attach()` throws
 * with the missing-IPC message, with no silent fallback.
 */
function makeNotYetWiredIpc(): TauriIpc {
  const fail = () => {
    throw new Error(TAURI_SIDECAR_NOT_WIRED_MSG);
  };
  return {
    loadUpdates: () => Promise.reject(new Error(TAURI_SIDECAR_NOT_WIRED_MSG)),
    appendUpdate: () => Promise.reject(new Error(TAURI_SIDECAR_NOT_WIRED_MSG)),
    clearDocumentState: () => Promise.reject(new Error(TAURI_SIDECAR_NOT_WIRED_MSG)),
    stateVector: () => Promise.reject(new Error(TAURI_SIDECAR_NOT_WIRED_MSG)),
    flushSync: () => {
      // flushSync must not throw per Provider contract; degrade to
      // failed=true so the orchestrator's beforeunload handler can
      // surface the prompt — same shape as an IDB tx-open failure.
      void fail; // documents the contract; we still set failed=true
      return { failed: true };
    },
  };
}

export class TauriFileProvider implements Provider {
  readonly name = 'TauriFileProvider';

  private readonly docId: string;
  private readonly ipc: TauriIpc;
  /**
   * `true` iff this Provider was constructed without an injected IPC
   * AND the runtime is Tauri — the "production NOT YET WIRED" path. We
   * record this at construction time so the throw at `attach()` is the
   * only failure surface; subsequent calls (`appendUpdate`, `flushSync`)
   * fall through to `notYetWiredIpc` which does the right thing per
   * each method's contract (sync no-throw for flushSync, reject for
   * the async ones — though we never get to those once attach throws).
   */
  private readonly notYetWired: boolean;

  /**
   * Cached doc handle — installed by `attach()`, used during `attach`
   * replay and never written outside that scope. Current replay does not need
   * the doc after attach (the orchestrator owns the doc; we only see
   * yrs `update_v1` bytes via `appendUpdate`), but holding it lets a
   * future sidecar integration (e.g. the XLSX-import-stable-docId path) call
   * `doc.applyUpdate` lazily without re-plumbing.
   */
  private doc: ProviderDoc | null = null;

  /** Sync-enqueued updates pending durable write. */
  private pendingUpdates: Uint8Array[] = [];

  /** In-flight async flush, coalesces concurrent `flush()` callers. */
  private flushing: Promise<void> | null = null;

  /** Set by `detach()`. Subsequent calls become no-ops (idempotent). */
  private detached = false;

  /** Read by the orchestrator on `beforeunload`. */
  private _flushFailed = false;

  /**
   * Construct a `TauriFileProvider` for one doc.
   *
   * @param docId — doc identifier; used as the key for the Tauri-side
   *   persisted update log.
   * @param options.ipc — optional `TauriIpc` (tests) or undefined for
   *   production (then runtime-detect Tauri; throw if neither).
   */
  constructor(docId: string, options: TauriFileProviderOptions = {}) {
    this.docId = docId;

    if (options.ipc) {
      this.ipc = options.ipc;
      this.notYetWired = false;
      return;
    }

    // No IPC injected — runtime must be Tauri; otherwise this is misuse
    // (web should be using IndexedDBProvider). Fail loud at construction.
    if (!detectTauriRuntime()) {
      throw new Error(NOT_IN_TAURI_MSG);
    }

    // Tauri runtime present, but the current runtime does not have the matching
    // Rust commands. Use the not-yet-wired IPC so `attach()` throws with the
    // missing-IPC message and downstream calls behave per their contracts.
    this.ipc = makeNotYetWiredIpc();
    this.notYetWired = true;
  }

  get flushFailed(): boolean {
    return this._flushFailed;
  }

  // ---------------------------------------------------------------------------
  // the storage provider lifecycle optional methods
  // ---------------------------------------------------------------------------

  getCapabilities(): StorageProviderCapabilities {
    return {
      writable: true,
      durable: true,
      synchronousFlushStart: false,
      fullStateCheckpoint: true,
      incrementalUpdateLog: false,
      yrsStateVectorDiff: false,
      storageCursor: false,
      subscriptions: false,
      exclusiveWriteLock: false,
      readOnlyFallback: false,
      offlineOpen: true,
      reconnect: false,
      inboundUpdates: false,
      idempotentRemoteUpdates: false,
      binaryAssets: false,
      assetContentAddressing: false,
      assetGarbageCollection: false,
      assetAtomicCommit: false,
      atomicBatch: false,
    };
  }

  getIdentity(): StorageProviderIdentity {
    return {
      providerRefId: `tauri:${this.docId}`,
      storageScope: {
        kind: 'scoped',
        scope: {
          tenantId: { kind: 'single-tenant' },
          workspaceId: { kind: 'no-workspace' },
          documentId: this.docId,
        },
      },
      contractVersion: '0.3.0',
      providerProtocolVersion: '0.1.0',
    };
  }

  async attach(
    doc: ProviderDoc,
    mode: ProviderAttachMode = { kind: 'normal' },
  ): Promise<ProviderAttachResult> {
    if (this.detached) {
      return {
        status: 'blocked',
        mode: mode.kind,
        reason: 'detached',
        message: 'TauriFileProvider.attach: provider has been detached',
      };
    }
    if (this.notYetWired) {
      throw new Error(TAURI_SIDECAR_NOT_WIRED_MSG);
    }

    this.doc = doc;

    if (mode.kind === 'importInitialize' || mode.kind === 'createFresh') {
      this.pendingUpdates = [];
      if (mode.kind === 'createFresh') {
        await this.ipc.clearDocumentState(this.docId);
      }
      return {
        status: 'ready',
        mode: mode.kind,
      };
    }

    // Replay every persisted update into the doc, in arrival order.
    // Awaited serially — same model as `InMemoryProvider`. yrs's CRDT
    // semantics make `applyUpdate` idempotent so a re-replay after a
    // crash-mid-attach is safe.
    const persisted = await this.ipc.loadUpdates(this.docId);
    for (const update of persisted) {
      await doc.applyUpdate(update);
    }
    return {
      status: 'ready',
      mode: mode.kind,
    };
  }

  appendUpdate(update: Uint8Array): void {
    if (this.detached) {
      // Silently drop; orchestrator should not be calling us after detach,
      // but the contract forbids throwing from `appendUpdate`.
      return;
    }
    // Defensive copy — callers may reuse the input buffer.
    this.pendingUpdates.push(new Uint8Array(update));
  }

  async flush(): Promise<void> {
    // Coalesce concurrent flushers. One in-flight flush serves all callers
    // awaiting it; appendUpdates that arrive
    // *during* the in-flight drain land in the next batch via the
    // microtask boundary in `runFlush`.
    if (this.flushing) return this.flushing;
    this.flushing = this.runFlush();
    try {
      await this.flushing;
    } finally {
      this.flushing = null;
    }
  }

  async checkpointFullState(doc: ProviderDoc): Promise<ProviderCheckpointResult> {
    if (this.detached) {
      return {
        status: 'blocked',
        mode: 'normal',
        reason: 'detached',
        message: 'TauriFileProvider.checkpointFullState: provider has been detached',
      };
    }
    await this.flush();
    const fullState = await doc.encodeDiff(new Uint8Array([0]));

    // Tauri sidecar storage is append-only. Appending a full-state
    // update is safe under Yrs idempotence and gives the orchestrator a
    // Provider-neutral checkpoint boundary until native
    // sidecar snapshot replacement.
    this.pendingUpdates.push(new Uint8Array(fullState));
    await this.flush();
    return {
      status: 'committed',
      mode: 'normal',
    };
  }

  /**
   * One drain cycle: snapshot `pendingUpdates`, dispatch each write,
   * await all writes complete. Updates that arrive during the cycle
   * remain in `pendingUpdates` for the next call (the snapshot is
   * frozen — `appendUpdate` mutates the post-snapshot queue only).
   */
  private async runFlush(): Promise<void> {
    if (this.detached) return;

    // Microtask boundary so any sync caller that did `appendUpdate;
    // await flush()` sees the append included. Mirrors provider FIFO ordering.
    await Promise.resolve();

    if (this.pendingUpdates.length === 0) return;

    const batch = this.pendingUpdates;
    this.pendingUpdates = [];

    // Issue writes in FIFO order. Could parallelize with `Promise.all`
    // but the Tauri-side writer will likely funnel through
    // a single tokio task per docId anyway — preserving order at the
    // call site is cheaper than deferring to whatever ordering the
    // backend happens to apply.
    for (const update of batch) {
      await this.ipc.appendUpdate(this.docId, update);
    }
  }

  flushSync(): void {
    if (this.detached) return;

    // Idempotent no-op when nothing's pending. Don't reset `flushFailed` — if a
    // prior flushSync failed and the
    // orchestrator is calling us a second time before any new pending
    // data exists, the failure state is still meaningful.
    if (this.pendingUpdates.length === 0) return;

    // Snapshot then clear before invoking IPC, so a re-entrant
    // `appendUpdate` from inside the IPC's sync prelude doesn't
    // double-queue (defensive — the IPC interface is sync only at the
    // dispatch point, but transports may invoke completion callbacks
    // synchronously).
    const batch = this.pendingUpdates;
    this.pendingUpdates = [];

    const result = this.ipc.flushSync(this.docId, batch);
    if (result.failed) {
      // Do not throw; set the flag for the orchestrator's beforeunload handler.
      // Restore `pendingUpdates` so a follow-up
      // `flush()` (if the page survives) can drain them — symmetric
      // with `InMemoryProvider`'s row-8 semantics.
      this._flushFailed = true;
      this.pendingUpdates = [...batch, ...this.pendingUpdates];
      return;
    }

    // Successful sync-drain clears any lingering failure flag from a
    // prior partially-failed lifecycle.
    this._flushFailed = false;
  }

  async detach(): Promise<void> {
    if (this.detached) return; // idempotent

    // Final flush — drain anything still pending. We set `detached`
    // AFTER the final flush so `runFlush`'s `if (this.detached)` guard
    // doesn't short-circuit our last drain. After the flush, mark the
    // Provider closed so subsequent `appendUpdate` calls are silent
    // no-ops per the contract.
    if (this.pendingUpdates.length > 0) {
      const batch = this.pendingUpdates;
      this.pendingUpdates = [];
      for (const update of batch) {
        await this.ipc.appendUpdate(this.docId, update);
      }
    }

    this.detached = true;
    this.doc = null;
  }

  async stateVector(): Promise<Uint8Array> {
    if (this.detached) {
      // After detach, the contract is undefined — but returning the
      // last-known SV from the IPC is the most useful answer. The
      // conformance suite never calls stateVector after detach.
    }
    return this.ipc.stateVector(this.docId);
  }
}
