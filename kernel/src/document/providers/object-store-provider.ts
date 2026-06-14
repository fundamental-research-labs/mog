/**
 * ObjectStoreProvider — conformance-baseline stub for the storage provider lifecycle.
 *
 * Represents a cloud object-store backend (S3, GCS, Azure Blob, R2) that
 * stores document snapshots and incremental update logs as keyed objects.
 * This is an in-memory stub that passes the provider conformance suite;
 * production implementations will delegate to actual object-store SDKs.
 *
 * Kind traits: roles ['authority', 'snapshot', 'exportSink'], durable, writable.
 *
 * @see provider.ts — the Provider contract
 * @see memory-provider.ts — reference in-memory implementation
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
  ObjectStoreProviderConfig,
} from '@mog-sdk/types-document/storage/provider-configs';
import type { ProviderFactory, ProviderInstance } from './factory';

// =============================================================================
// Storage type
// =============================================================================

/**
 * Per-docId storage entry. Module-scoped default so "detach session A,
 * reattach session B on the same docId" replays the prior session's writes.
 */
const DEFAULT_STORAGE = new Map<string, { snapshot: Uint8Array | null; updates: Uint8Array[] }>();

export type ObjectStoreProviderStorage = Map<
  string,
  { snapshot: Uint8Array | null; updates: Uint8Array[] }
>;

// =============================================================================
// Options
// =============================================================================

export interface ObjectStoreProviderOptions {
  /** Backing storage. Default: module-scoped singleton. */
  storage?: ObjectStoreProviderStorage;

  /** Inject `flushSync` failure for conformance row #8. */
  failFlushSync?: () => boolean;
}

// =============================================================================
// ObjectStoreProvider
// =============================================================================

export class ObjectStoreProvider implements Provider {
  readonly name: string = 'ObjectStoreProvider';

  private readonly docId: string;
  private readonly storage: ObjectStoreProviderStorage;
  private readonly failFlushSyncFn: () => boolean;

  private pendingUpdates: Uint8Array[] = [];
  private flushing: Promise<void> | null = null;
  private detached = false;
  private attached = false;
  private _flushFailed = false;

  constructor(docId: string, options: ObjectStoreProviderOptions = {}) {
    this.docId = docId;
    this.storage = options.storage ?? DEFAULT_STORAGE;
    this.failFlushSyncFn = options.failFlushSync ?? (() => false);
  }

  // ---------------------------------------------------------------------------
  // Capabilities
  // ---------------------------------------------------------------------------

  getCapabilities(): StorageProviderCapabilities {
    return {
      writable: true,
      durable: true,
      synchronousFlushStart: false,
      fullStateCheckpoint: true,
      incrementalUpdateLog: true,
      yrsStateVectorDiff: false,
      storageCursor: false,
      subscriptions: false,
      exclusiveWriteLock: false,
      readOnlyFallback: false,
      offlineOpen: false,
      reconnect: false,
      inboundUpdates: false,
      idempotentRemoteUpdates: false,
      binaryAssets: true,
      assetContentAddressing: true,
      assetGarbageCollection: false,
      assetAtomicCommit: false,
      atomicBatch: false,
    };
  }

  getIdentity(): StorageProviderIdentity {
    return {
      providerRefId: `objectStore:${this.docId}`,
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
        message: 'ObjectStoreProvider.attach: provider has been detached',
      };
    }
    if (this.attached) {
      return {
        status: 'blocked',
        mode: mode.kind,
        reason: 'alreadyAttached',
        message: 'ObjectStoreProvider.attach: provider already attached',
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
        message: 'ObjectStoreProvider.checkpointFullState: provider has been detached',
      };
    }

    if (mode.kind !== 'importInitialize') {
      await this.flush();
    } else {
      this.pendingUpdates = [];
      this.flushing = null;
    }

    const fullState = await doc.encodeDiff(new Uint8Array());

    // Capture any updates that arrived during encodeDiff.
    const trailing = this.pendingUpdates;
    this.pendingUpdates = [];

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
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a factory function for ObjectStoreProvider instances. The factory
 * returns a new ObjectStoreProvider bound to the given docId and shared storage.
 */
export function createObjectStoreProviderFactory(
  options: ObjectStoreProviderOptions = {},
): (docId: string) => ObjectStoreProvider {
  const storage = options.storage ?? new Map();
  return (docId: string) => new ObjectStoreProvider(docId, { ...options, storage });
}

/**
 * Registry-compatible factory for ObjectStoreProvider.
 */
export function createObjectStoreRegistryFactory(): ProviderFactory {
  return async (config: StorageProviderConfig): Promise<ProviderInstance> => {
    if (config.kind !== 'objectStore') {
      throw new Error(
        `ObjectStoreProviderFactory: expected kind "objectStore", got "${config.kind}"`,
      );
    }
    const osConfig = config as ObjectStoreProviderConfig;
    const provider = new ObjectStoreProvider(osConfig.providerRefId);
    return {
      config: osConfig,
      provider,
      capabilities: provider.getCapabilities(),
    };
  };
}

/**
 * Clear the module-default storage. Not part of the Provider interface —
 * used by tests that opt into the default singleton.
 */
export function clearObjectStoreProviderDefaultStorage(): void {
  DEFAULT_STORAGE.clear();
}
