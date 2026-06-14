/**
 * DatabaseLogProvider — conformance-baseline stub for the storage provider lifecycle.
 *
 * Represents a database-backed update log (Postgres, SQLite, DynamoDB) that
 * stores document state as a sequence of incremental updates with optional
 * full-state checkpoints. This is an in-memory stub that passes the provider
 * conformance suite; production implementations will delegate to actual
 * database drivers.
 *
 * Kind traits: roles ['authority', 'replica'], durable, writable.
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
  DatabaseLogProviderConfig,
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

export type DatabaseLogProviderStorage = Map<
  string,
  { snapshot: Uint8Array | null; updates: Uint8Array[] }
>;

// =============================================================================
// Options
// =============================================================================

export interface DatabaseLogProviderOptions {
  /** Backing storage. Default: module-scoped singleton. */
  storage?: DatabaseLogProviderStorage;

  /** Inject `flushSync` failure for conformance row #8. */
  failFlushSync?: () => boolean;
}

// =============================================================================
// DatabaseLogProvider
// =============================================================================

export class DatabaseLogProvider implements Provider {
  readonly name: string = 'DatabaseLogProvider';

  private readonly docId: string;
  private readonly storage: DatabaseLogProviderStorage;
  private readonly failFlushSyncFn: () => boolean;

  private pendingUpdates: Uint8Array[] = [];
  private flushing: Promise<void> | null = null;
  private detached = false;
  private attached = false;
  private _flushFailed = false;

  constructor(docId: string, options: DatabaseLogProviderOptions = {}) {
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
      binaryAssets: false,
      assetContentAddressing: false,
      assetGarbageCollection: false,
      assetAtomicCommit: false,
      atomicBatch: true,
    };
  }

  getIdentity(): StorageProviderIdentity {
    return {
      providerRefId: `databaseLog:${this.docId}`,
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
        message: 'DatabaseLogProvider.attach: provider has been detached',
      };
    }
    if (this.attached) {
      return {
        status: 'blocked',
        mode: mode.kind,
        reason: 'alreadyAttached',
        message: 'DatabaseLogProvider.attach: provider already attached',
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
        message: 'DatabaseLogProvider.checkpointFullState: provider has been detached',
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
 * Create a factory function for DatabaseLogProvider instances. The factory
 * returns a new DatabaseLogProvider bound to the given docId and shared storage.
 */
export function createDatabaseLogProviderFactory(
  options: DatabaseLogProviderOptions = {},
): (docId: string) => DatabaseLogProvider {
  const storage = options.storage ?? new Map();
  return (docId: string) => new DatabaseLogProvider(docId, { ...options, storage });
}

/**
 * Registry-compatible factory for DatabaseLogProvider.
 */
export function createDatabaseLogRegistryFactory(): ProviderFactory {
  return async (config: StorageProviderConfig): Promise<ProviderInstance> => {
    if (config.kind !== 'databaseLog') {
      throw new Error(
        `DatabaseLogProviderFactory: expected kind "databaseLog", got "${config.kind}"`,
      );
    }
    const dbConfig = config as DatabaseLogProviderConfig;
    const provider = new DatabaseLogProvider(dbConfig.providerRefId);
    return {
      config: dbConfig,
      provider,
      capabilities: provider.getCapabilities(),
    };
  };
}

/**
 * Clear the module-default storage. Not part of the Provider interface —
 * used by tests that opt into the default singleton.
 */
export function clearDatabaseLogProviderDefaultStorage(): void {
  DEFAULT_STORAGE.clear();
}
