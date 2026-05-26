/**
 * ReadOnlySnapshotProvider — loads a snapshot once on attach, never writes.
 *
 * Used for previews, shared links, and any context where the document should
 * be visible but not editable. The snapshot is resolved once via the injected
 * `SnapshotResolver`, applied to the doc, and then the Provider enters a
 * permanent read-only state where all write operations are no-ops.
 *
 * Capabilities: writable=false, durable=false, fullStateCheckpoint=false.
 *
 */

import type { StorageProviderIdentity } from '@mog-sdk/types-document/storage/provider-identity';
import type { StorageProviderCapabilities } from '@mog-sdk/types-document/storage/provider-capabilities';
import type {
  StorageProviderConfig,
  ReadOnlySnapshotProviderConfig,
} from '@mog-sdk/types-document/storage/provider-configs';
import type { Provider, ProviderDoc } from './provider';
import type { ProviderFactory, ProviderInstance } from './factory';

// =============================================================================
// Snapshot resolver
// =============================================================================

/**
 * Maps a snapshot handle to raw bytes. The handle is opaque — it may be a
 * URL, a content-addressable hash, or a database key. The resolver fetches
 * the bytes; the Provider applies them.
 */
export interface SnapshotResolver {
  /**
   * Resolve a snapshot handle to its bytes. Returns `null` if the handle
   * points to nothing (e.g. deleted or expired snapshot).
   */
  resolve(handle: string): Promise<Uint8Array | null>;
}

// =============================================================================
// ReadOnlySnapshotProvider
// =============================================================================

export class ReadOnlySnapshotProvider implements Provider {
  readonly name = 'ReadOnlySnapshotProvider';
  readonly readOnly = true;

  private readonly docId: string;
  private readonly snapshotHandle: string;
  private readonly resolver: SnapshotResolver;

  /** Set by `detach()`. Subsequent calls become no-ops (idempotent). */
  private detached = false;

  /** Always false — no writes to fail. */
  private _flushFailed = false;

  /**
   * @param docId           Document identifier.
   * @param snapshotHandle  Opaque handle passed to the resolver on attach.
   * @param resolver        Host-supplied snapshot resolver.
   */
  constructor(docId: string, snapshotHandle: string, resolver: SnapshotResolver) {
    this.docId = docId;
    this.snapshotHandle = snapshotHandle;
    this.resolver = resolver;
  }

  // ---------------------------------------------------------------------------
  // Public Provider API
  // ---------------------------------------------------------------------------

  get flushFailed(): boolean {
    return this._flushFailed;
  }

  async attach(doc: ProviderDoc): Promise<void> {
    if (this.detached) {
      throw new Error('ReadOnlySnapshotProvider.attach: provider has been detached');
    }

    const snapshot = await this.resolver.resolve(this.snapshotHandle);
    if (snapshot && snapshot.length > 0) {
      await doc.applyUpdate(snapshot);
    }
  }

  /** No-op — read-only Provider. */
  appendUpdate(_update: Uint8Array): void {
    // Silently drop. Read-only Providers never persist writes.
  }

  /** No-op — nothing to flush. */
  async flush(): Promise<void> {
    // No pending writes in a read-only Provider.
  }

  /**
   * Blocked — read-only Provider cannot checkpoint.
   * Returns a rejected promise with reason 'readOnly'.
   */
  async checkpointFullState(_doc: ProviderDoc): Promise<void> {
    // No-op for read-only. Callers can check `readOnly` or
    // `getCapabilities().fullStateCheckpoint` before calling.
  }

  /** No-op — read-only Provider has nothing to sync-flush. */
  flushSync(): void {
    // Nothing pending; nothing to fail.
  }

  async detach(): Promise<void> {
    if (this.detached) return;
    this.detached = true;
  }

  async stateVector(): Promise<Uint8Array> {
    // Read-only: the state vector is a fixed empty marker. The Provider
    // never advances its state after the initial attach replay.
    return new Uint8Array(4);
  }

  // ---------------------------------------------------------------------------
  // the storage provider lifecycle optional methods
  // ---------------------------------------------------------------------------

  getCapabilities(): StorageProviderCapabilities {
    return {
      writable: false,
      durable: false,
      synchronousFlushStart: false,
      fullStateCheckpoint: false,
      incrementalUpdateLog: false,
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
      providerRefId: `readOnlySnapshot:${this.docId}`,
      storageScope: { kind: 'explicit-no-scope', reason: 'ephemeral-memory' },
      contractVersion: '0.3.0',
      providerProtocolVersion: '0.1.0',
    };
  }

  async storageCursor(): Promise<Uint8Array> {
    const cursor = `readOnlySnapshot:${this.docId}:${this.snapshotHandle}`;
    return new TextEncoder().encode(cursor);
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a factory that builds `ReadOnlySnapshotProvider` instances bound
 * to a fixed `SnapshotResolver`. The returned factory takes `docId` and
 * `snapshotHandle`.
 */
export function createReadOnlySnapshotProviderFactory(
  resolver: SnapshotResolver,
): (docId: string, snapshotHandle: string) => ReadOnlySnapshotProvider {
  return (docId: string, snapshotHandle: string) =>
    new ReadOnlySnapshotProvider(docId, snapshotHandle, resolver);
}

/**
 * Registry-compatible factory for ReadOnlySnapshotProvider.
 * The resolver maps snapshot handles to raw bytes.
 */
export function createReadOnlySnapshotRegistryFactory(resolver: SnapshotResolver): ProviderFactory {
  return async (config: StorageProviderConfig): Promise<ProviderInstance> => {
    if (config.kind !== 'readOnlySnapshot') {
      throw new Error(
        `ReadOnlySnapshotProviderFactory: expected kind "readOnlySnapshot", got "${config.kind}"`,
      );
    }
    const roConfig = config as ReadOnlySnapshotProviderConfig;
    const provider = new ReadOnlySnapshotProvider(
      roConfig.providerRefId,
      roConfig.snapshotSourceHandle,
      resolver,
    );
    return {
      config: roConfig,
      provider,
      capabilities: provider.getCapabilities(),
    };
  };
}
