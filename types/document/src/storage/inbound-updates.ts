/**
 * Inbound update types
 *
 * Types for updates arriving from remote storage providers into the
 * kernel. Covers authority proofs, update envelopes, and asset deps.
 */

import type { StorageScopeBinding } from './provider-identity';

// =============================================================================
// Authority Proof
// =============================================================================

export interface ProviderAuthorityProof {
  readonly kind: 'handoff-bound-token' | 'signed-provider-message' | 'trusted-sidecar-session';
  readonly issuer: string;
  readonly algorithm: 'hmac-sha256' | 'ed25519' | 'trusted-session-mac';
  readonly issuedAt: number;
  readonly expiresAt?: number;
  readonly coveredFields: readonly ProviderInboundProofField[];
  readonly canonicalPayloadHash: string;
  readonly proofBytesOrRef: string;
}

// =============================================================================
// Inbound Proof Field
// =============================================================================

export type ProviderInboundProofField =
  | 'providerRefId'
  | 'decisionId'
  | 'sessionId'
  | 'authorityRef'
  | 'storageScope'
  | 'providerEpoch'
  | 'updateId'
  | 'sequence'
  | 'payloadKind'
  | 'payloadHash'
  | 'rawBytesPolicy';

// =============================================================================
// Inbound Update Envelope
// =============================================================================

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

// =============================================================================
// Inbound Asset Dependency
// =============================================================================

export interface ProviderInboundAssetDependency {
  readonly assetId: string;
  readonly contentFingerprint: string;
  readonly manifestFingerprint: string;
  readonly policyLabelRef?: string;
  readonly availabilityProofRef?: string;
}
