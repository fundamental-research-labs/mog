/**
 * InMemoryProvider — reference `Provider` implementation backed by a Map.
 *
 * Two roles:
 *   1. **Conformance seed.** Proves the conformance suite (§3.4) is
 *      green-able — if any conformance row fails on a Map-backed Provider,
 *      the row is buggy, not the implementation.
 *   2. **Reference implementation.** The "Provider conformance — fresh
 *      in-memory Provider" scenario reuses this exact module to
 *      document that the contract is implementation-agnostic.
 *
 * Storage is shared across instances **per docId** via a module-scoped
 * Map. That's required for conformance row #2 ("attach with prior persisted
 * bytes") and #3 ("reattach a fresh doc replays all N updates"): the test
 * detaches one Provider, constructs another with the same docId, and
 * expects the second to see the first's writes — exactly the IndexedDB
 * model. Pass an explicit `storage` to construct an isolated instance
 * (used by the conformance suite to run rows in parallel without bleed).
 *
 */

import type {
  Provider,
  ProviderAttachMode,
  ProviderAttachResult,
  ProviderCheckpointResult,
  ProviderDoc,
} from '../provider';

/**
 * Per-docId log of updates. Module-scoped so a "reattach" picks up the
 * prior session's writes (mirrors `IndexedDBProvider`'s persistence).
 */
const DEFAULT_STORAGE = new Map<string, Uint8Array[]>();

/**
 * Storage shape consumed by InMemoryProvider. Tests can inject an isolated
 * Map to keep state between two Providers in the same test, without leaking
 * to other tests.
 */
export type InMemoryProviderStorage = Map<string, Uint8Array[]>;

export interface InMemoryProviderOptions {
  /**
   * Backing storage. Default: process-wide singleton. Pass a fresh `new
   * Map()` for test isolation.
   */
  storage?: InMemoryProviderStorage;

  /**
   * Inject `flushSync` failure for conformance row #8. When this returns
   * `true` on a `flushSync` invocation, the Provider behaves as if it
   * could not start a tx: sets `flushFailed = true`, leaves `pendingUpdates`
   * in place, returns without throwing.
   */
  failFlushSync?: () => boolean;
}

export class InMemoryProvider implements Provider {
  readonly name = 'InMemoryProvider';

  private readonly docId: string;
  private readonly storage: InMemoryProviderStorage;
  private readonly failFlushSync: () => boolean;

  /** Sync-enqueued updates pending durable write. */
  private pendingUpdates: Uint8Array[] = [];

  /**
   * In-flight async flush, if any. Used by `flush()` to coalesce concurrent
   * callers into the same drain (§3.3 backpressure).
   */
  private flushing: Promise<void> | null = null;

  /**
   * Set by `detach()`. Once true:
   *   - `appendUpdate` becomes a silent no-op (orchestrator should not
   *     be calling us, but the contract forbids throwing).
   *   - `attach`, `flush`, `flushSync` short-circuit.
   * Idempotency for `detach` is enforced by checking this flag.
   */
  private detached = false;

  /** §3.3 / §6.1 — read by the orchestrator on `beforeunload`. */
  private _flushFailed = false;

  constructor(docId: string, options: InMemoryProviderOptions = {}) {
    this.docId = docId;
    this.storage = options.storage ?? DEFAULT_STORAGE;
    this.failFlushSync = options.failFlushSync ?? (() => false);
  }

  get flushFailed(): boolean {
    return this._flushFailed;
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
        message: 'InMemoryProvider.attach: provider has been detached',
      };
    }

    if (mode.kind === 'importInitialize' || mode.kind === 'createFresh') {
      this.pendingUpdates = [];
      this.flushing = null;
      if (mode.kind === 'createFresh') {
        this.storage.delete(this.docId);
      }
      return {
        status: 'ready',
        mode: mode.kind,
      };
    }

    const persisted = this.storage.get(this.docId);
    if (!persisted || persisted.length === 0) {
      return {
        status: 'ready',
        mode: mode.kind,
      };
    }

    // Replay every persisted byte stream into the doc, in arrival order.
    // Each `applyUpdate` is awaited because real ProviderDocs round-trip
    // through the bridge; doing it serially preserves yrs's update-after-
    // update ordering for transports that care.
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
      // Silently drop — orchestrator should not be calling us after detach,
      // but per the contract we never throw from appendUpdate.
      return;
    }
    // Defensive copy: callers (orchestrator microtask coalescer, or yrs
    // engine) may reuse the input buffer.
    this.pendingUpdates.push(new Uint8Array(update));
  }

  async flush(): Promise<void> {
    // Coalesce concurrent flushers (§3.3 backpressure). One in-flight
    // flush serves all callers awaiting it; appendUpdates that arrive
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

  /**
   * One drain cycle: snapshot `pendingUpdates`, write the snapshot, clear
   * the snapshot's slots from the queue. Updates that arrive during the
   * cycle remain in the queue for the next call.
   */
  private async runFlush(): Promise<void> {
    if (this.detached) return;

    // Microtask boundary so any sync caller that did `appendUpdate;
    // await flush()` sees the append included. Also models the real
    // IndexedDBProvider's coalesce-then-tx pattern.
    await Promise.resolve();

    if (this.pendingUpdates.length === 0) return;

    // Freeze the batch — appendUpdate during this microtask drain
    // doesn't mutate `batch`, only future drains.
    const batch = this.pendingUpdates;
    this.pendingUpdates = [];

    const log = this.storage.get(this.docId) ?? [];
    log.push(...batch);
    this.storage.set(this.docId, log);
  }

  async checkpointFullState(doc: ProviderDoc): Promise<ProviderCheckpointResult> {
    if (this.detached) {
      return {
        status: 'blocked',
        mode: 'normal',
        reason: 'detached',
        message: 'InMemoryProvider.checkpointFullState: provider has been detached',
      };
    }
    await this.flush();
    const fullState = await doc.encodeDiff(new Uint8Array([0]));

    const pending = this.pendingUpdates;
    this.pendingUpdates = [];
    this.storage.set(this.docId, [new Uint8Array(fullState)]);

    if (pending.length > 0) {
      const log = this.storage.get(this.docId) ?? [];
      log.push(...pending.map((update) => new Uint8Array(update)));
      this.storage.set(this.docId, log);
    }
    return {
      status: 'committed',
      mode: 'normal',
    };
  }

  flushSync(): void {
    if (this.detached) return;

    // Idempotent no-op when nothing's pending (§3.3). Don't reset
    // `flushFailed` — if a prior flushSync failed and the orchestrator
    // is calling us a second time before any new pending data exists,
    // the failure state is still meaningful.
    if (this.pendingUpdates.length === 0) return;

    if (this.failFlushSync()) {
      // Per §6.1: do not throw. Set the flag for the orchestrator's
      // beforeunload handler to read. Leave pendingUpdates intact so a
      // later `flush()` (if the page survives) can drain them.
      this._flushFailed = true;
      return;
    }

    // Synchronous drain — no `await`, no microtask. The contract for
    // pagehide is "the write must be queued in a tx the browser will
    // continue to drain during unload." For the in-memory store the
    // backing is a Map so "queued" == "written"; for IndexedDB it's
    // "tx.put then return."
    const batch = this.pendingUpdates;
    this.pendingUpdates = [];

    const log = this.storage.get(this.docId) ?? [];
    log.push(...batch);
    this.storage.set(this.docId, log);

    // Successful sync-drain clears any lingering failure flag from a
    // prior partially-failed lifecycle.
    this._flushFailed = false;
  }

  async detach(): Promise<void> {
    if (this.detached) return; // idempotent
    this.detached = true;

    // Final flush — drain anything still pending. Use `runFlush` directly
    // to bypass the `detached` guard inside `flush()`. We've set the flag
    // because subsequent `appendUpdate` calls should be no-ops, but we
    // still want this last drain to commit.
    if (this.pendingUpdates.length > 0) {
      const batch = this.pendingUpdates;
      this.pendingUpdates = [];
      const log = this.storage.get(this.docId) ?? [];
      log.push(...batch);
      this.storage.set(this.docId, log);
    }
  }

  async stateVector(): Promise<Uint8Array> {
    // For an in-memory log, the "state vector" is the count of stored
    // updates encoded as 4 big-endian bytes. Sufficient for diff-style
    // round-trips in tests; real Providers reuse the doc's
    // `currentStateVector()` here.
    const log = this.storage.get(this.docId) ?? [];
    const out = new Uint8Array(4);
    out[0] = (log.length >>> 24) & 0xff;
    out[1] = (log.length >>> 16) & 0xff;
    out[2] = (log.length >>> 8) & 0xff;
    out[3] = log.length & 0xff;
    return out;
  }
}

/**
 * Convenience: clear the module-default storage. Not part of the
 * Provider interface — used by tests that opt into the default singleton.
 */
export function clearInMemoryProviderDefaultStorage(): void {
  DEFAULT_STORAGE.clear();
}
