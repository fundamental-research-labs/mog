/**
 * Provider inbound update envelope contracts.
 *
 * V2 envelopes carry authenticated sync provenance. V1 envelopes remain
 * supported as legacy replay input and are classified before admission.
 */

import type { ProviderAuthorityProof } from './inbound-proof';
import type { SyncUpdateProvenance } from './inbound-updates-provenance';
import type { StorageScopeBinding } from './provider-identity';

export interface ProviderInboundUpdateEnvelope {
  readonly providerRefId: string;
  readonly authorityRef?: string;
  readonly storageScope: StorageScopeBinding;
  readonly decisionId: string;
  readonly sessionId: string;
  readonly providerEpoch: string;
  readonly updateId: string;
  readonly sequence?: bigint;
  readonly payloadKind: 'yrs-update-v1' | 'yrs-state-vector-diff' | 'provider-snapshot-fragment';
  readonly payloadHash: string;
  readonly payload: Uint8Array;
  readonly assetDependencies?: readonly ProviderInboundAssetDependency[];
  readonly authorityProof: ProviderAuthorityProof;
}

export interface ProviderInboundUpdateEnvelopeV2 extends ProviderInboundUpdateEnvelope {
  readonly schemaVersion: 'provider-inbound-update-v2';
  readonly provenance: SyncUpdateProvenance;
}

export type ProviderInboundUpdateEnvelopeAny =
  | ProviderInboundUpdateEnvelope
  | ProviderInboundUpdateEnvelopeV2;

export function isProviderInboundUpdateEnvelopeV2(
  envelope: ProviderInboundUpdateEnvelopeAny,
): envelope is ProviderInboundUpdateEnvelopeV2 {
  return (
    (envelope as { readonly schemaVersion?: unknown }).schemaVersion ===
    'provider-inbound-update-v2'
  );
}

export interface ProviderInboundAssetDependency {
  readonly assetId: string;
  readonly contentFingerprint: string;
  readonly manifestFingerprint: string;
  readonly policyLabelRef?: string;
  readonly availabilityProofRef?: string;
}
