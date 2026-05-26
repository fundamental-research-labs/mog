/**
 * RedactedPublishedSnapshotProvider — read-only Provider for published,
 * redacted document content.
 *
 * Similar to `ReadOnlySnapshotProvider` but tailored for the published-doc
 * surface: the snapshot is resolved via a `PublishedSnapshotResolver` that
 * also validates a redaction policy ID and generation proof before returning
 * bytes. If validation fails, `attach()` throws — the document must not be
 * presented with an invalid or expired policy.
 *
 * All write operations are no-ops or blocked (readOnly). The Provider is
 * fully stateless after attach: no pending writes, no flush state.
 *
 * Capabilities: writable=false, durable=false.
 *
 */

import type { StorageProviderIdentity } from '@mog-sdk/types-document/storage/provider-identity';
import type { StorageProviderCapabilities } from '@mog-sdk/types-document/storage/provider-capabilities';
import type {
  StorageProviderConfig,
  RedactedPublishedSnapshotProviderConfig,
} from '@mog-sdk/types-document/storage/provider-configs';
import type { Provider, ProviderDoc } from './provider';
import type { ProviderFactory, ProviderInstance } from './factory';

// =============================================================================
// Published snapshot resolver
// =============================================================================

/**
 * Result of resolving a published snapshot. Includes the raw bytes plus
 * proof metadata the Provider uses for validation.
 */
export interface PublishedSnapshotResult {
  /** Raw yrs `update_v1` bytes for the published snapshot. */
  snapshot: Uint8Array;
  /** The generation proof string the host produced. */
  generationProof: string;
}

/**
 * Resolves published snapshot handles with policy validation. The host
 * implements this to fetch the published snapshot from its backend and
 * validate the redaction policy.
 */
export interface PublishedSnapshotResolver {
  /**
   * Resolve a published snapshot handle. Must validate that the redaction
   * policy ID is current and the generation proof is valid. Returns `null`
   * if the handle points to nothing or the policy is expired/invalid.
   *
   * @param handle    Opaque published-snapshot handle.
   * @param policyId  Redaction policy ID to validate against.
   */
  resolve(handle: string, policyId: string): Promise<PublishedSnapshotResult | null>;

  /**
   * Validate a redaction policy ID without fetching a snapshot. Used by
   * `attach()` as a pre-flight check. Returns `true` if the policy is
   * valid and current.
   */
  validatePolicy(policyId: string): Promise<boolean>;
}

// =============================================================================
// RedactedPublishedSnapshotProvider
// =============================================================================

export class RedactedPublishedSnapshotProvider implements Provider {
  readonly name = 'RedactedPublishedSnapshotProvider';
  readonly readOnly = true;

  private readonly docId: string;
  private readonly snapshotHandle: string;
  private readonly policyId: string;
  private readonly resolver: PublishedSnapshotResolver;

  /** Set by `detach()`. Subsequent calls become no-ops (idempotent). */
  private detached = false;

  /** Always false — no writes to fail. */
  private _flushFailed = false;

  /**
   * @param docId           Document identifier.
   * @param snapshotHandle  Opaque handle for the published snapshot.
   * @param policyId        Redaction policy ID to validate on attach.
   * @param resolver        Host-supplied published-snapshot resolver.
   */
  constructor(
    docId: string,
    snapshotHandle: string,
    policyId: string,
    resolver: PublishedSnapshotResolver,
  ) {
    this.docId = docId;
    this.snapshotHandle = snapshotHandle;
    this.policyId = policyId;
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
      throw new Error('RedactedPublishedSnapshotProvider.attach: provider has been detached');
    }

    // Pre-flight: validate the redaction policy before fetching data.
    const policyValid = await this.resolver.validatePolicy(this.policyId);
    if (!policyValid) {
      throw new Error(
        `RedactedPublishedSnapshotProvider.attach: redaction policy '${this.policyId}' is invalid or expired`,
      );
    }

    // Resolve the published snapshot with policy validation.
    const result = await this.resolver.resolve(this.snapshotHandle, this.policyId);
    if (!result) {
      throw new Error(
        `RedactedPublishedSnapshotProvider.attach: snapshot '${this.snapshotHandle}' not found or policy validation failed`,
      );
    }

    // Apply the snapshot bytes to the doc.
    if (result.snapshot.length > 0) {
      await doc.applyUpdate(result.snapshot);
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

  /** No-op — read-only Provider cannot checkpoint. */
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
    // Read-only: the state vector is a fixed empty marker.
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
      providerRefId: `redactedPublishedSnapshot:${this.docId}`,
      storageScope: { kind: 'explicit-no-scope', reason: 'ephemeral-memory' },
      contractVersion: '0.3.0',
      providerProtocolVersion: '0.1.0',
    };
  }

  async storageCursor(): Promise<Uint8Array> {
    const cursor = `redactedPublishedSnapshot:${this.docId}:${this.snapshotHandle}:${this.policyId}`;
    return new TextEncoder().encode(cursor);
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a factory that builds `RedactedPublishedSnapshotProvider` instances
 * bound to a fixed `PublishedSnapshotResolver`.
 */
export function createRedactedPublishedSnapshotProviderFactory(
  resolver: PublishedSnapshotResolver,
): (docId: string, snapshotHandle: string, policyId: string) => RedactedPublishedSnapshotProvider {
  return (docId: string, snapshotHandle: string, policyId: string) =>
    new RedactedPublishedSnapshotProvider(docId, snapshotHandle, policyId, resolver);
}

/**
 * Registry-compatible factory for RedactedPublishedSnapshotProvider.
 */
export function createRedactedPublishedSnapshotRegistryFactory(
  resolver: PublishedSnapshotResolver,
): ProviderFactory {
  return async (config: StorageProviderConfig): Promise<ProviderInstance> => {
    if (config.kind !== 'redactedPublishedSnapshot') {
      throw new Error(
        `RedactedPublishedSnapshotProviderFactory: expected kind "redactedPublishedSnapshot", got "${config.kind}"`,
      );
    }
    const rpConfig = config as RedactedPublishedSnapshotProviderConfig;
    const provider = new RedactedPublishedSnapshotProvider(
      rpConfig.providerRefId,
      rpConfig.publishedSnapshotHandle,
      rpConfig.redactionPolicyId,
      resolver,
    );
    return {
      config: rpConfig,
      provider,
      capabilities: provider.getCapabilities(),
    };
  };
}
