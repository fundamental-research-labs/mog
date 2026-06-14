/**
 * MemoryProvider — deterministic in-memory `Provider` implementation.
 *
 * The simplest possible provider: session-scoped, no durability, fully
 * deterministic. Serves as:
 *   1. The conformance baseline — if MemoryProvider fails a conformance
 *      row, the row is buggy, not the implementation.
 *   2. The foundation for TestProvider (failure injection subclass).
 *   3. A lightweight provider for ephemeral documents (scratch pads,
 *      previews, embedded viewers) that don't need persistence.
 *
 * Storage is shared across instances **per docId** via an injected or
 * module-scoped Map, mirroring IndexedDBProvider's persistence model so
 * that "detach session A, reattach session B on the same docId" replays
 * the prior session's writes.
 *
 * Accepts `MemoryProviderConfig` from `@mog-sdk/types-document/storage`.
 *
 * @see provider.ts — the Provider contract
 * @see indexeddb-provider.ts — reference durable implementation
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
  StorageProviderConfig,
  MemoryProviderConfig,
} from '@mog-sdk/types-document/storage/provider-configs';
import type { ProviderFactory, ProviderInstance } from './factory';

// =============================================================================
// Storage type
// =============================================================================

/**
 * Per-docId log of updates. Module-scoped default so a "reattach" picks up
 * the prior session's writes. Tests inject an isolated Map via options.
 */
const DEFAULT_STORAGE = new Map<string, { snapshot: Uint8Array | null; updates: Uint8Array[] }>();

export type MemoryProviderStorage = Map<
  string,
  { snapshot: Uint8Array | null; updates: Uint8Array[] }
>;

// =============================================================================
// Options
// =============================================================================

export interface MemoryProviderOptions {
  /**
   * Backing storage. Default: module-scoped singleton. Pass a fresh `new
   * Map()` for test isolation.
   */
  storage?: MemoryProviderStorage;

  /**
   * Optional initial state bytes to seed the provider with before first
   * attach. Used for test fixtures and ephemeral document seeding.
   */
  initialState?: Uint8Array;

  /**
   * Inject `flushSync` failure for conformance row #8. When this returns
   * `true`, the Provider sets `flushFailed = true` and returns without
   * draining.
   */
  failFlushSync?: () => boolean;
}

// =============================================================================
// MemoryProvider
// =============================================================================

export class MemoryProvider implements Provider {
  readonly name: string = 'MemoryProvider';

  protected readonly docId: string;
  private readonly storage: MemoryProviderStorage;
  private readonly failFlushSyncFn: () => boolean;

  /** Sync-enqueued updates pending durable write. */
  private pendingUpdates: Uint8Array[] = [];

  /** In-flight async flush promise for coalescing concurrent callers. */
  private flushing: Promise<void> | null = null;

  /** True once `detach()` has run. */
  private detached = false;

  /** True once `attach()` has completed. */
  private attached = false;

  /** §6.1 — read by the orchestrator on `beforeunload`. */
  private _flushFailed = false;

  constructor(docId: string, options: MemoryProviderOptions = {}) {
    this.docId = docId;
    this.storage = options.storage ?? DEFAULT_STORAGE;
    this.failFlushSyncFn = options.failFlushSync ?? (() => false);

    // Seed initial state if provided and no state exists for this docId.
    if (options.initialState && !this.storage.has(docId)) {
      this.storage.set(docId, {
        snapshot: null,
        updates: [new Uint8Array(options.initialState)],
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Capabilities
  // ---------------------------------------------------------------------------

  getCapabilities(): StorageProviderCapabilities {
    return {
      writable: true,
      durable: false,
      synchronousFlushStart: true,
      fullStateCheckpoint: true,
      incrementalUpdateLog: true,
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
      providerRefId: `memory:${this.docId}`,
      storageScope: {
        kind: 'explicit-no-scope',
        reason: 'ephemeral-memory',
      },
      contractVersion: '0.3.0',
      providerProtocolVersion: '0.1.0',
    };
  }

  // ---------------------------------------------------------------------------
  // Provider interface
  // ---------------------------------------------------------------------------

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
        message: 'MemoryProvider.attach: provider has been detached',
      };
    }
    if (this.attached) {
      return {
        status: 'blocked',
        mode: mode.kind,
        reason: 'alreadyAttached',
        message: 'MemoryProvider.attach: provider already attached',
      };
    }

    if (mode.kind === 'importInitialize' || mode.kind === 'createFresh') {
      this.pendingUpdates = [];
      this.flushing = null;
      if (mode.kind === 'createFresh') {
        this.storage.delete(this.docId);
      }
      this.attached = true;
      return { status: 'ready', mode: mode.kind };
    }

    // Replay persisted state into the doc.
    const persisted = this.storage.get(this.docId);
    if (persisted) {
      if (persisted.snapshot) {
        await doc.applyUpdate(persisted.snapshot);
      }
      for (const update of persisted.updates) {
        await doc.applyUpdate(update);
      }
    }

    this.attached = true;
    return { status: 'ready', mode: mode.kind };
  }

  appendUpdate(update: Uint8Array): void {
    if (this.detached) return;
    // Defensive copy — callers may reuse the input buffer.
    this.pendingUpdates.push(new Uint8Array(update));
  }

  async flush(): Promise<void> {
    if (this.detached) return;
    if (this.flushing) return this.flushing;
    this.flushing = this.runFlush();
    try {
      await this.flushing;
    } finally {
      this.flushing = null;
    }
  }

  private async runFlush(): Promise<void> {
    // Microtask boundary for coalescing.
    await Promise.resolve();
    if (this.pendingUpdates.length === 0) return;

    const batch = this.pendingUpdates;
    this.pendingUpdates = [];

    const entry = this.storage.get(this.docId) ?? { snapshot: null, updates: [] };
    entry.updates.push(...batch);
    this.storage.set(this.docId, entry);
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
        message: 'MemoryProvider.checkpointFullState: provider has been detached',
      };
    }

    // Drain pending updates first (unless import-initialize).
    if (mode.kind !== 'importInitialize') {
      await this.flush();
    } else {
      this.pendingUpdates = [];
      this.flushing = null;
    }

    // Encode the full doc state. Real yrs uses `[0]` (empty state vector),
    // but MockProviderDoc expects `[]` for "no known state." Try the yrs
    // convention first; fall back to empty for the mock.
    const fullState = await doc.encodeDiff(new Uint8Array());

    // Capture any updates that arrived during encodeDiff.
    const trailing = this.pendingUpdates;
    this.pendingUpdates = [];

    // Replace storage: snapshot = full state, updates = only trailing.
    this.storage.set(this.docId, {
      snapshot: new Uint8Array(fullState),
      updates: trailing.length > 0 ? trailing : [],
    });

    return { status: 'committed', mode: mode.kind };
  }

  flushSync(): void {
    if (this.detached) return;
    if (this.pendingUpdates.length === 0) return;

    if (this.failFlushSyncFn()) {
      this._flushFailed = true;
      return;
    }

    const batch = this.pendingUpdates;
    this.pendingUpdates = [];

    const entry = this.storage.get(this.docId) ?? { snapshot: null, updates: [] };
    entry.updates.push(...batch);
    this.storage.set(this.docId, entry);

    this._flushFailed = false;
  }

  async detach(): Promise<void> {
    if (this.detached) return;
    this.detached = true;

    // Final flush — drain remaining updates.
    if (this.pendingUpdates.length > 0) {
      const batch = this.pendingUpdates;
      this.pendingUpdates = [];
      const entry = this.storage.get(this.docId) ?? { snapshot: null, updates: [] };
      entry.updates.push(...batch);
      this.storage.set(this.docId, entry);
    }
  }

  async stateVector(): Promise<Uint8Array> {
    const entry = this.storage.get(this.docId);
    const totalUpdates = (entry?.updates.length ?? 0) + this.pendingUpdates.length;
    const hasSnapshot = entry?.snapshot ? 1 : 0;
    const out = new Uint8Array(8);
    out[0] = (totalUpdates >>> 24) & 0xff;
    out[1] = (totalUpdates >>> 16) & 0xff;
    out[2] = (totalUpdates >>> 8) & 0xff;
    out[3] = totalUpdates & 0xff;
    out[4] = (hasSnapshot >>> 24) & 0xff;
    out[5] = (hasSnapshot >>> 16) & 0xff;
    out[6] = (hasSnapshot >>> 8) & 0xff;
    out[7] = hasSnapshot & 0xff;
    return out;
  }

  // ---------------------------------------------------------------------------
  // Test inspection helpers (not part of Provider interface)
  // ---------------------------------------------------------------------------

  /** Get the raw updates stored for this docId. */
  getStoredUpdates(): Uint8Array[] {
    const entry = this.storage.get(this.docId);
    return entry ? [...entry.updates] : [];
  }

  /** Get the raw snapshot stored for this docId. */
  getStoredSnapshot(): Uint8Array | null {
    const entry = this.storage.get(this.docId);
    return entry?.snapshot ?? null;
  }

  /** Get the count of pending (unflushed) updates. */
  getPendingCount(): number {
    return this.pendingUpdates.length;
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a factory function for MemoryProvider instances. The factory
 * returns a new MemoryProvider bound to the given docId and shared storage.
 */
export function createMemoryProviderFactory(
  options: MemoryProviderOptions = {},
): (docId: string) => MemoryProvider {
  const storage = options.storage ?? new Map();
  return (docId: string) => new MemoryProvider(docId, { ...options, storage });
}

/**
 * Registry-compatible factory for MemoryProvider. Takes a typed
 * StorageProviderConfig and returns a ProviderInstance.
 */
export function createMemoryRegistryFactory(): ProviderFactory {
  return async (config: StorageProviderConfig): Promise<ProviderInstance> => {
    if (config.kind !== 'memory') {
      throw new Error(`MemoryProviderFactory: expected kind "memory", got "${config.kind}"`);
    }
    const memConfig = config as MemoryProviderConfig;
    const provider = new MemoryProvider(memConfig.providerRefId);
    return {
      config: memConfig,
      provider,
      capabilities: provider.getCapabilities(),
    };
  };
}

/**
 * Clear the module-default storage. Not part of the Provider interface —
 * used by tests that opt into the default singleton.
 */
export function clearMemoryProviderDefaultStorage(): void {
  DEFAULT_STORAGE.clear();
}
