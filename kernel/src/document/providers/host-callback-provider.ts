/**
 * HostCallbackProvider — delegates persistence to host-supplied callbacks.
 *
 * The embed SDK and headless-server hosts inject save/load/checkpoint callbacks
 * at construction time. All persistence flows through these callbacks, making
 * the Provider host-agnostic: the same Provider runs against an in-memory stub
 * in tests, a cloud-backed adapter in production, or an Electron fs wrapper
 * in a desktop embed.
 *
 * Capabilities: writable=true, fullStateCheckpoint=true,
 * incrementalUpdateLog=true. Durability depends on what the host callbacks
 * actually do — the Provider cannot know.
 *
 */

import type { StorageProviderIdentity } from '@mog-sdk/types-document/storage/provider-identity';
import type { StorageProviderCapabilities } from '@mog-sdk/types-document/storage/provider-capabilities';
import type {
  StorageProviderConfig,
  HostCallbackProviderConfig,
} from '@mog-sdk/types-document/storage/provider-configs';
import type { Provider, ProviderAttachMode, ProviderAttachResult, ProviderDoc } from './provider';
import type { ProviderFactory, ProviderInstance } from './factory';

// =============================================================================
// Host callback registry
// =============================================================================

/**
 * Callbacks the host registers to handle persistence. All async; the Provider
 * awaits them at the appropriate lifecycle boundary.
 */
export interface HostCallbackRegistry {
  /**
   * Load persisted update log for a doc. Returns an ordered array of
   * `update_v1` byte streams. Empty array if no prior state exists.
   */
  load(docId: string): Promise<Uint8Array[]>;

  /**
   * Persist a batch of incremental `update_v1` byte streams. The host is
   * responsible for appending them to whatever durable store it owns.
   * Resolves when the writes are durable (or best-effort committed).
   */
  save(docId: string, updates: Uint8Array[]): Promise<void>;

  /**
   * Persist a full-state checkpoint. The host may replace its stored update
   * log with this single snapshot, or keep both — Provider doesn't dictate.
   * Resolves when the checkpoint is durable.
   */
  checkpoint(docId: string, fullState: Uint8Array): Promise<void>;

  /**
   * Clear any persisted state for a doc. Used by create-fresh opens to
   * replace existing host state before the provider becomes live.
   */
  clear(docId: string): Promise<void>;
}

// =============================================================================
// HostCallbackProvider
// =============================================================================

export class HostCallbackProvider implements Provider {
  readonly name = 'HostCallbackProvider';

  private readonly docId: string;
  private readonly registry: HostCallbackRegistry;
  private readonly durableHint: boolean;

  /** Sync-enqueued updates pending durable write. */
  private pendingUpdates: Uint8Array[] = [];

  /** In-flight async flush, coalesces concurrent `flush()` callers. */
  private flushing: Promise<void> | null = null;

  /** Set by `detach()`. Subsequent calls become no-ops (idempotent). */
  private detached = false;

  /** §3.3 / §6.1 — read by orchestrator on `beforeunload`. */
  private _flushFailed = false;

  /** Monotonic counter for state-vector encoding. */
  private writeCounter = 0;

  /**
   * @param docId   Document identifier used as the key for host callbacks.
   * @param registry  Host-supplied load/save/checkpoint callbacks.
   * @param options.durable  Hint for `getCapabilities().durable`. Defaults
   *   false — the Provider cannot know whether the host's callbacks are
   *   durable; the host opts in by passing `true`.
   */
  constructor(docId: string, registry: HostCallbackRegistry, options: { durable?: boolean } = {}) {
    this.docId = docId;
    this.registry = registry;
    this.durableHint = options.durable ?? false;
  }

  // ---------------------------------------------------------------------------
  // Public Provider API
  // ---------------------------------------------------------------------------

  get flushFailed(): boolean {
    return this._flushFailed;
  }

  async attach(
    doc: ProviderDoc,
    mode: ProviderAttachMode = { kind: 'normal' },
  ): Promise<ProviderAttachResult> {
    if (this.detached) {
      throw new Error('HostCallbackProvider.attach: provider has been detached');
    }

    if (mode.kind === 'importInitialize' || mode.kind === 'createFresh') {
      this.pendingUpdates = [];
      this.flushing = null;
      if (mode.kind === 'createFresh') {
        await this.registry.clear(this.docId);
        this.writeCounter = 0;
      }
      return {
        status: 'ready',
        mode: mode.kind,
      };
    }

    const persisted = await this.registry.load(this.docId);
    for (const update of persisted) {
      await doc.applyUpdate(update);
    }
    return {
      status: 'ready',
      mode: mode.kind,
    };
  }

  appendUpdate(update: Uint8Array): void {
    if (this.detached) return;
    // Defensive copy — callers may reuse the input buffer.
    this.pendingUpdates.push(new Uint8Array(update));
  }

  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.runFlush();
    try {
      await this.flushing;
    } finally {
      this.flushing = null;
    }
  }

  async checkpointFullState(doc: ProviderDoc): Promise<void> {
    // Drain pending updates first so the checkpoint is up to date.
    await this.flush();
    // Empty state vector = "give me everything". yrs encodes the empty SV
    // as `[0]`; MockProviderDoc uses a zero-length array. Use zero-length
    // for compatibility with both.
    const fullState = await doc.encodeDiff(new Uint8Array());
    await this.registry.checkpoint(this.docId, fullState);
    this.writeCounter++;
  }

  flushSync(): void {
    if (this.detached) return;
    if (this.pendingUpdates.length === 0) return;

    // Host callbacks are async by nature. Best-effort: attempt to invoke
    // the save callback and fire-and-forget the resulting promise. If the
    // callback throws synchronously (e.g. registry misconfigured, or a
    // test-injected failure), set flushFailed and restore the batch.
    const batch = this.pendingUpdates;
    this.pendingUpdates = [];

    try {
      // Fire-and-forget — the save is async; we cannot await it here.
      // The host's save callback may or may not complete before page death.
      const p = this.registry.save(this.docId, batch);
      void p.catch(() => {
        // Async rejection after return — unobservable from flushSync.
        // Mark failed so a later check sees it.
        this._flushFailed = true;
      });
      this.writeCounter += batch.length;
      this._flushFailed = false;
    } catch {
      this._flushFailed = true;
      // Restore pending so a later flush() can retry.
      this.pendingUpdates = [...batch, ...this.pendingUpdates];
    }
  }

  async detach(): Promise<void> {
    if (this.detached) return;

    // Final flush before marking detached. Best-effort — if the host
    // callback fails (e.g. registry torn down), the Provider still detaches
    // cleanly. The bytes stay lost, same as IndexedDB quota-exceeded at
    // page death.
    if (this.pendingUpdates.length > 0) {
      const batch = this.pendingUpdates;
      this.pendingUpdates = [];
      try {
        await this.registry.save(this.docId, batch);
        this.writeCounter += batch.length;
      } catch {
        // Best-effort — set flushFailed so the orchestrator can observe
        // the data loss, but don't throw from detach.
        this._flushFailed = true;
      }
    }

    this.detached = true;
  }

  async stateVector(): Promise<Uint8Array> {
    const out = new Uint8Array(4);
    const c = this.writeCounter >>> 0;
    out[0] = (c >>> 24) & 0xff;
    out[1] = (c >>> 16) & 0xff;
    out[2] = (c >>> 8) & 0xff;
    out[3] = c & 0xff;
    return out;
  }

  // ---------------------------------------------------------------------------
  // the storage provider lifecycle optional methods
  // ---------------------------------------------------------------------------

  getCapabilities(): StorageProviderCapabilities {
    return {
      writable: true,
      durable: this.durableHint,
      synchronousFlushStart: false,
      fullStateCheckpoint: true,
      incrementalUpdateLog: true,
      yrsStateVectorDiff: false,
      storageCursor: true,
      subscriptions: false,
      exclusiveWriteLock: false,
      readOnlyFallback: false,
      offlineOpen: false,
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
      providerRefId: `hostCallback:${this.docId}`,
      storageScope: { kind: 'explicit-no-scope', reason: 'ephemeral-memory' },
      contractVersion: '0.3.0',
      providerProtocolVersion: '0.1.0',
    };
  }

  async storageCursor(): Promise<Uint8Array> {
    const cursor = `hostCallback:${this.docId}:${this.writeCounter}`;
    return new TextEncoder().encode(cursor);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async runFlush(): Promise<void> {
    if (this.detached) return;

    // Microtask boundary for coalescing.
    await Promise.resolve();

    if (this.pendingUpdates.length === 0) return;

    const batch = this.pendingUpdates;
    this.pendingUpdates = [];

    await this.registry.save(this.docId, batch);
    this.writeCounter += batch.length;
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a factory function that builds `HostCallbackProvider` instances
 * bound to a fixed `HostCallbackRegistry`. The returned factory takes only
 * `docId` — the registry is closed over.
 */
export function createHostCallbackProviderFactory(
  registry: HostCallbackRegistry,
  options?: { durable?: boolean },
): (docId: string) => HostCallbackProvider {
  return (docId: string) => new HostCallbackProvider(docId, registry, options);
}

/**
 * Registry-compatible factory for HostCallbackProvider.
 * The resolver maps `callbackRegistrationId` to an actual HostCallbackRegistry.
 */
export function createHostCallbackRegistryFactory(
  resolveCallbacks: (registrationId: string) => HostCallbackRegistry,
): ProviderFactory {
  return async (config: StorageProviderConfig): Promise<ProviderInstance> => {
    if (config.kind !== 'hostCallback') {
      throw new Error(
        `HostCallbackProviderFactory: expected kind "hostCallback", got "${config.kind}"`,
      );
    }
    const hcConfig = config as HostCallbackProviderConfig;
    const callbacks = resolveCallbacks(hcConfig.callbackRegistrationId);
    const provider = new HostCallbackProvider(hcConfig.providerRefId, callbacks);
    return {
      config: hcConfig,
      provider,
      capabilities: provider.getCapabilities(),
    };
  };
}
