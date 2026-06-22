/**
 * Bridge-backed `ProviderDoc` production-path adapter.
 *
 * The Provider interface (`./provider.ts`) talks to a doc-side handle via
 * `applyUpdate`, `encodeDiff`, `currentStateVector`. In production those
 * three operations are forwarded to a yrs `Doc` living inside the compute
 * engine (Rust); the orchestrator has a `ComputeBridge` already wired,
 * so the production `ProviderDoc` is a thin shim that calls the bridge.
 *
 * This module exists so:
 *   1. The orchestrator (`rust-document.ts`) can hand a real `ProviderDoc`
 *      to a Provider's `attach()` without a circular dependency between
 *      `Provider` and the bridge-housing layer.
 *   2. The IndexedDBProvider's compaction path (`setProviderDocFactory`,
 *      see `indexeddb-provider.ts`) can build transient ProviderDocs from
 *      the same bridge — no MockProviderDoc in production code paths.
 *
 * The conformance suite still uses `MockProviderDoc` (no bridge required),
 * but every shipping attach flows through this adapter so the test/prod
 * paths are identical in shape.
 *
 * @see ./provider.ts — the `ProviderDoc` interface contract
 */

import {
  classifyLegacyRawUpdate,
  DEFAULT_PROVENANCE_REDACTION_POLICY,
  validateSyncUpdateProvenance,
  type SyncUpdateProvenance,
} from '@mog-sdk/types-document/storage';
import type { StorageScopeBinding } from '@mog-sdk/types-document/storage/provider-identity';
import type { ComputeBridge } from '../../bridges/compute/compute-bridge';
import {
  createAdmittedSyncApplyContext,
  type AdmittedSyncApplyContext,
} from '../../bridges/compute/sync-apply-admission';
import { slog } from '../../lib/slog';
import type {
  Provider,
  ProviderDoc,
  ProviderDocApplyUpdateMetadata,
  ProviderDocApplyUpdateResult,
} from './provider';

export interface BridgeBackedProviderReplayAdmissionOptions {
  readonly providerRefId?: string;
  readonly providerId?: string;
  readonly authorityRef?: string;
  readonly storageScope?: StorageScopeBinding;
}

export interface BridgeBackedProviderDocOptions {
  readonly onApplyUpdateAdmission?: (metadata: ProviderDocApplyUpdateMetadata) => void;
  readonly providerReplayAdmission?: BridgeBackedProviderReplayAdmissionOptions;
}

export function getBridgeBackedProviderReplayAdmission(
  provider: Pick<Provider, 'name' | 'getIdentity'>,
): BridgeBackedProviderReplayAdmissionOptions {
  const identity = provider.getIdentity?.();
  return {
    providerRefId: identity?.providerRefId ?? provider.name,
    ...(identity?.providerId === undefined ? {} : { providerId: identity.providerId }),
    ...(identity?.authorityRef === undefined ? {} : { authorityRef: identity.authorityRef }),
    ...(identity?.storageScope === undefined ? {} : { storageScope: identity.storageScope }),
  };
}

type ComputeBridgeAdmissionHooks = {
  recordProviderDocApplyUpdateAdmission?: (metadata: ProviderDocApplyUpdateMetadata) => void;
};

type ComputeBridgeSyncApplyWithMetadata = {
  syncApplyWithMetadata?: (
    update: Uint8Array,
    syncApplyContext: AdmittedSyncApplyContext,
  ) => Promise<ProviderDocApplyUpdateResult>;
};

/**
 * Build a `ProviderDoc` backed by `bridge`. The returned object is stable
 * (same reference returned on subsequent reads of any property) and stateless
 * — all state lives inside the bridge / compute engine.
 *
 * `applyUpdate(bytes)` calls the bridge sync-apply path (which the engine
 * routes through `compute_apply_sync_update`). When the bridge exposes sync
 * apply metadata, the result is returned for document orchestration; Providers
 * can continue to ignore it.
 *
 * `currentStateVector()` calls `bridge.currentStateVector()`.
 *
 * `encodeDiff(remoteSv)` calls `bridge.encodeDiff(remoteSv)`.
 *
 * @param bridge The ComputeBridge instance the orchestrator already holds.
 * @param docId  Document identifier — kept for diagnostics; the bridge
 *               itself owns docId routing internally, so the shim does
 *               not have to thread the docId through every call.
 */
export function createBridgeBackedProviderDoc(
  bridge: ComputeBridge,
  docId: string,
  options: BridgeBackedProviderDocOptions = {},
): ProviderDoc {
  return {
    docId,
    async applyUpdate(
      update: Uint8Array,
      metadata?: ProviderDocApplyUpdateMetadata,
    ): Promise<ProviderDocApplyUpdateResult | void> {
      const admissionMetadata =
        metadata ??
        (options.providerReplayAdmission
          ? await classifyProviderReplayApplyUpdate(
              docId,
              update,
              options.providerReplayAdmission,
            )
          : await classifyLegacyRawProviderDocApplyUpdate(docId, update));
      emitApplyUpdateAdmission(bridge, options, admissionMetadata);
      const admittedContext = createAdmittedSyncApplyContext(admissionMetadata);
      const syncApplyWithMetadata = (bridge as ComputeBridgeSyncApplyWithMetadata)
        .syncApplyWithMetadata;
      if (typeof syncApplyWithMetadata === 'function') {
        return syncApplyWithMetadata.call(bridge, update, admittedContext);
      }
      await bridge.syncApply(update, admittedContext);
      return undefined;
    },
    encodeDiff(remoteSv: Uint8Array): Promise<Uint8Array> {
      return bridge.encodeDiff(remoteSv);
    },
    currentStateVector(): Promise<Uint8Array> {
      return bridge.currentStateVector();
    },
  };
}

async function classifyProviderReplayApplyUpdate(
  docId: string,
  update: Uint8Array,
  options: BridgeBackedProviderReplayAdmissionOptions,
): Promise<ProviderDocApplyUpdateMetadata> {
  const payloadHash = await sha256Hex(update);
  const provenance = buildProviderReplayProvenance(payloadHash, options);
  const validation = validateSyncUpdateProvenance(provenance, { expectedPayloadHash: payloadHash });
  return {
    source: 'provider-replay',
    docId,
    envelopeVersion: 'provider-replay',
    ...(options.providerRefId === undefined ? {} : { providerRefId: options.providerRefId }),
    payloadHash,
    provenance,
    validationDiagnostics: validation.diagnostics,
  };
}

async function classifyLegacyRawProviderDocApplyUpdate(
  docId: string,
  update: Uint8Array,
): Promise<ProviderDocApplyUpdateMetadata> {
  const payloadHash = await sha256Hex(update);
  const provenance = classifyLegacyRawUpdate({
    payloadHash,
    updateId: `legacy-raw:${payloadHash}`,
  });
  const validation = validateSyncUpdateProvenance(provenance, { expectedPayloadHash: payloadHash });
  return {
    source: 'provider-replay',
    docId,
    envelopeVersion: 'provider-replay',
    payloadHash,
    provenance,
    validationDiagnostics: validation.diagnostics,
  };
}

function buildProviderReplayProvenance(
  payloadHash: string,
  options: BridgeBackedProviderReplayAdmissionOptions,
): SyncUpdateProvenance {
  const providerId = options.providerId;
  return {
    schemaVersion: 'sync-update-provenance-v1',
    sourceKind: 'providerReplay',
    updateIdentity: {
      originKind: 'provider',
      ...(providerId === undefined ? {} : { stableOriginId: providerId, providerId }),
      ...(options.providerRefId === undefined ? {} : { providerRefId: options.providerRefId }),
      ...(options.storageScope === undefined ? {} : { storageScope: options.storageScope }),
      ...(options.authorityRef === undefined ? {} : { authorityRef: options.authorityRef }),
      payloadHash,
    },
    trust: {
      status: 'trustedLocalSystem',
      ...(options.authorityRef === undefined ? {} : { authorityRef: options.authorityRef }),
    },
    author: { kind: 'unknown', reason: 'providerReplay' },
    replay: true,
    system: true,
    capturePolicy: 'excluded',
    redaction: DEFAULT_PROVENANCE_REDACTION_POLICY,
    exclusionDiagnostic: {
      reason: 'providerReplay',
      message: 'Provider attach replay is classified without remote authorship.',
    },
  };
}

function emitApplyUpdateAdmission(
  bridge: ComputeBridge,
  options: BridgeBackedProviderDocOptions,
  metadata: ProviderDocApplyUpdateMetadata,
): void {
  try {
    options.onApplyUpdateAdmission?.(metadata);
  } catch (err) {
    slog('bridgeProviderDoc.applyUpdateAdmissionSinkFailed', { error: err });
  }

  try {
    (bridge as unknown as ComputeBridgeAdmissionHooks).recordProviderDocApplyUpdateAdmission?.(
      metadata,
    );
  } catch (err) {
    slog('bridgeProviderDoc.bridgeAdmissionHookFailed', { error: err });
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    throw new Error('BridgeBackedProviderDoc.applyUpdate: SHA-256 digest is unavailable');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
