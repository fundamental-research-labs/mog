/**
 * SDK Storage Provider Adapter
 *
 * Adapts the public `MogSdkStorageProvider` interface (from
 * `@mog-sdk/contracts/sdk`) to the internal `Provider`
 * interface used by the `RustDocument` orchestrator.
 *
 * The two interfaces model different persistence directions:
 *
 * - **Internal Provider**: the provider's `attach(doc)` receives a `ProviderDoc`
 *   it *writes into* via `doc.applyUpdate(bytes)` to replay persisted state.
 *
 * - **SDK Provider**: the provider's `attach(doc)` receives a `MogSdkProviderDoc`
 *   it *reads from* via `doc.encodeStateAsUpdate()` / `doc.encodeStateVector()`,
 *   and may return an `initialUpdate` that the adapter then applies via the
 *   internal `ProviderDoc.applyUpdate()`.
 *
 * This adapter bridges the gap: it builds an `MogSdkProviderDoc` from the
 * internal `ProviderDoc` (async→sync via cached snapshots), delegates to the
 * SDK provider, and applies any returned `initialUpdate`.
 *
 * @see ./provider.ts — internal Provider contract
 * @see contracts/src/sdk/providers.ts — SDK MogSdkStorageProvider contract
 */

import type {
  MogSdkStorageProvider,
  MogSdkProviderDoc,
  MogSdkProviderCheckpointResult,
} from '@mog-sdk/contracts/sdk';
import type {
  Provider,
  ProviderAttachReturn,
  ProviderCheckpointReturn,
  ProviderCheckpointMode,
  ProviderAttachMode,
  ProviderDoc,
} from './provider';

/**
 * Adapt a public `MogSdkStorageProvider` to the internal `Provider` contract.
 *
 * The returned `Provider` can be passed directly to
 * `RustDocument.attachProvider()`.
 */
export function createSdkStorageAdapter(sdk: MogSdkStorageProvider): Provider {
  // Track whether the adapter has been attached/detached for idempotency.
  let attached = false;

  // Cache the latest state snapshot so the MogSdkProviderDoc sync methods
  // can return data without awaiting. Populated fresh before each SDK call
  // that receives a `MogSdkProviderDoc`.
  let cachedStateUpdate: Uint8Array = new Uint8Array(0);
  let cachedStateVector: Uint8Array = new Uint8Array(0);

  /**
   * Build a `MogSdkProviderDoc` from cached snapshots. The internal
   * `ProviderDoc` methods are async (they cross the WASM bridge), but
   * the SDK contract requires sync methods. We pre-populate the cache
   * before handing this object to the SDK provider.
   */
  function buildSdkDoc(internalDoc: ProviderDoc): MogSdkProviderDoc {
    return {
      get documentId() {
        return internalDoc.docId;
      },
      encodeStateAsUpdate(): Uint8Array {
        return cachedStateUpdate;
      },
      encodeStateVector(): Uint8Array {
        return cachedStateVector;
      },
    };
  }

  /** Pre-populate the cached state snapshots from the async internal doc. */
  async function refreshStateCache(internalDoc: ProviderDoc): Promise<void> {
    // Encode the full state (diff against empty state vector = full update)
    const [sv, fullState] = await Promise.all([
      internalDoc.currentStateVector(),
      internalDoc.encodeDiff(new Uint8Array(0)),
    ]);
    cachedStateVector = sv;
    cachedStateUpdate = fullState;
  }

  const adapter: Provider = {
    get name() {
      return sdk.name;
    },

    get flushFailed() {
      return sdk.flushFailed;
    },

    get readOnly() {
      return sdk.readOnly;
    },

    async attach(doc: ProviderDoc, _mode?: ProviderAttachMode): Promise<ProviderAttachReturn> {
      // Snapshot current engine state so SDK sync methods work.
      await refreshStateCache(doc);

      const sdkDoc = buildSdkDoc(doc);
      const result = await sdk.attach(sdkDoc);

      if (!result.ok) {
        return {
          status: 'blocked',
          mode: _mode?.kind ?? 'normal',
          reason: 'unavailable',
          message: result.error ?? `SDK provider "${sdk.name}" attach failed`,
        };
      }

      // If the SDK provider returned an initial update (e.g. from its own
      // persisted state), replay it into the internal doc.
      if (result.initialUpdate && result.initialUpdate.byteLength > 0) {
        await doc.applyUpdate(result.initialUpdate);
      }

      attached = true;
      return {
        status: 'ready',
        mode: _mode?.kind ?? 'normal',
        readOnly: sdk.readOnly,
      };
    },

    appendUpdate(update: Uint8Array): void {
      sdk.appendUpdate(update);
    },

    async flush(): Promise<void> {
      await sdk.flush();
    },

    async checkpointFullState(
      doc: ProviderDoc,
      _mode?: ProviderCheckpointMode,
    ): Promise<ProviderCheckpointReturn> {
      // Refresh state cache so the SDK checkpoint can read full state.
      await refreshStateCache(doc);

      const sdkDoc = buildSdkDoc(doc);
      let result: MogSdkProviderCheckpointResult;
      try {
        result = await sdk.checkpoint(sdkDoc);
      } catch (err) {
        return {
          status: 'blocked',
          mode: _mode?.kind ?? 'normal',
          reason: 'unavailable',
          message:
            err instanceof Error ? err.message : `SDK provider "${sdk.name}" checkpoint failed`,
        };
      }

      if (!result.ok) {
        return {
          status: 'blocked',
          mode: _mode?.kind ?? 'normal',
          reason: 'unavailable',
          message: result.error ?? `SDK provider "${sdk.name}" checkpoint returned not-ok`,
        };
      }

      return {
        status: 'committed',
        mode: _mode?.kind ?? 'normal',
      };
    },

    flushSync(): void {
      sdk.flushSync();
    },

    async detach(): Promise<void> {
      if (!attached) return;
      attached = false;
      await sdk.detach();
    },

    async stateVector(): Promise<Uint8Array> {
      return cachedStateVector;
    },
  };

  return adapter;
}
