/**
 * Provider inbound authority proof contracts.
 *
 * These are schema-level contracts only. Runtime update application remains in
 * the storage/collaboration paths that consume the envelope.
 */

import type { StorageScopeBinding } from './provider-identity';

export const PROVIDER_AUTHORITY_PROOF_V2_SCHEMA_VERSION = 'provider-authority-proof-v2' as const;
export const PROVIDER_AUTHORITY_CANONICAL_PAYLOAD_SCHEMA_VERSION =
  'provider-authority-canonical-payload-v1' as const;
export const PROVIDER_AUTHORITY_CANONICAL_PAYLOAD_CANONICALIZATION =
  'mog-provider-authority-proof-v2/sorted-json-sha256-v1' as const;

export const PROVIDER_INBOUND_PROOF_FIELDS = Object.freeze([
  'sourceKind',
  'originKind',
  'stableOriginId',
  'providerId',
  'providerKind',
  'providerRefId',
  'decisionId',
  'sessionId',
  'remoteSessionId',
  'remoteAuthorRef',
  'authorState',
  'correlationId',
  'causationIds',
  'provenanceRedactionPolicy',
  'provenancePayloadHash',
  'authorityRef',
  'storageScope',
  'roomId',
  'epoch',
  'providerEpoch',
  'updateId',
  'sequence',
  'payloadKind',
  'payloadHash',
  'rawBytesPolicy',
] as const);

export type ProviderInboundProofField = (typeof PROVIDER_INBOUND_PROOF_FIELDS)[number];

export type ProviderAuthorityProofSchemaVersion =
  | 'provider-authority-proof-v1'
  | typeof PROVIDER_AUTHORITY_PROOF_V2_SCHEMA_VERSION;
export type ProviderAuthorityProofKind =
  | 'handoff-bound-token'
  | 'signed-provider-message'
  | 'trusted-sidecar-session';
export type ProviderAuthorityProofAlgorithm = 'hmac-sha256' | 'ed25519' | 'trusted-session-mac';
export type ProviderAuthorityProofAudienceKind =
  | 'provider-inbound-update'
  | 'collaboration-inbound-update'
  | 'versioning-sync-provenance';
export type ProviderAuthorityCanonicalPayloadHashAlgorithm = 'sha256';

export interface ProviderAuthorityProofAudience {
  readonly kind: ProviderAuthorityProofAudienceKind;
  readonly authorityRef?: string;
  readonly providerRefId?: string;
  readonly roomId?: string;
  readonly storageScope?: StorageScopeBinding;
  readonly documentId?: string;
}

export interface ProviderAuthorityCanonicalPayloadHash {
  readonly schemaVersion: typeof PROVIDER_AUTHORITY_CANONICAL_PAYLOAD_SCHEMA_VERSION;
  readonly algorithm: ProviderAuthorityCanonicalPayloadHashAlgorithm;
  readonly canonicalization: typeof PROVIDER_AUTHORITY_CANONICAL_PAYLOAD_CANONICALIZATION;
  readonly value: string;
  readonly coveredFields: readonly ProviderInboundProofField[];
}

export interface ProviderAuthorityProofBase {
  readonly kind: ProviderAuthorityProofKind;
  readonly issuer: string;
  readonly algorithm: ProviderAuthorityProofAlgorithm;
  readonly issuedAt: number;
  readonly expiresAt?: number;
  readonly coveredFields: readonly ProviderInboundProofField[];
  readonly canonicalPayloadHash: string;
  readonly proofBytesOrRef: string;
}

export interface ProviderAuthorityProofV1 extends ProviderAuthorityProofBase {
  readonly schemaVersion?: 'provider-authority-proof-v1';
}

export interface ProviderAuthorityProofV2 extends ProviderAuthorityProofBase {
  readonly schemaVersion: typeof PROVIDER_AUTHORITY_PROOF_V2_SCHEMA_VERSION;
  readonly audience: readonly ProviderAuthorityProofAudience[];
  readonly canonicalPayload: ProviderAuthorityCanonicalPayloadHash;
  readonly keyId?: string;
  readonly notBefore?: number;
}

export type ProviderAuthorityProof = ProviderAuthorityProofV1 | ProviderAuthorityProofV2;

export function isProviderAuthorityProofV2(
  proof: ProviderAuthorityProof,
): proof is ProviderAuthorityProofV2 {
  return proof.schemaVersion === PROVIDER_AUTHORITY_PROOF_V2_SCHEMA_VERSION;
}

export function providerAuthorityProofSchemaVersion(
  proof: ProviderAuthorityProof,
): ProviderAuthorityProofSchemaVersion {
  return isProviderAuthorityProofV2(proof)
    ? PROVIDER_AUTHORITY_PROOF_V2_SCHEMA_VERSION
    : (proof.schemaVersion ?? 'provider-authority-proof-v1');
}

export function providerAuthorityProofAudienceKinds(
  proof: ProviderAuthorityProof,
): readonly ProviderAuthorityProofAudienceKind[] {
  return isProviderAuthorityProofV2(proof) ? proof.audience.map((audience) => audience.kind) : [];
}

export function providerAuthorityProofCanonicalPayloadHashAlgorithm(
  proof: ProviderAuthorityProof,
): ProviderAuthorityCanonicalPayloadHashAlgorithm | undefined {
  return isProviderAuthorityProofV2(proof) ? proof.canonicalPayload.algorithm : undefined;
}

export function providerAuthorityProofCanonicalPayloadHash(proof: ProviderAuthorityProof): string {
  return isProviderAuthorityProofV2(proof)
    ? proof.canonicalPayload.value
    : proof.canonicalPayloadHash;
}

export function providerAuthorityProofCoveredFields(
  proof: ProviderAuthorityProof,
): readonly ProviderInboundProofField[] {
  return isProviderAuthorityProofV2(proof)
    ? proof.canonicalPayload.coveredFields
    : proof.coveredFields;
}
