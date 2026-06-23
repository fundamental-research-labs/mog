/**
 * Canonical provider inbound V2 proof coverage helpers.
 */

import type { ProviderInboundProofField } from './inbound-proof';
import type { ProviderInboundUpdateEnvelopeV2 } from './inbound-updates-envelope';
import type { SyncUpdateProvenance } from './inbound-updates-provenance';

export const PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS = Object.freeze([
  'sourceKind',
  'originKind',
  'stableOriginId',
  'providerRefId',
  'storageScope',
  'authorityRef',
  'authorState',
  'provenanceRedactionPolicy',
  'provenancePayloadHash',
  'decisionId',
  'sessionId',
  'epoch',
  'providerEpoch',
  'updateId',
  'payloadKind',
  'payloadHash',
] as const satisfies readonly ProviderInboundProofField[]);

export const PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS = Object.freeze([
  'remoteSessionId',
  'remoteAuthorRef',
  'correlationId',
  'causationIds',
] as const satisfies readonly ProviderInboundProofField[]);

export const PROVIDER_INBOUND_V2_OPTIONAL_IDENTITY_PROOF_FIELDS = Object.freeze([
  'providerId',
  'providerKind',
  'roomId',
  'sequence',
] as const satisfies readonly ProviderInboundProofField[]);

type ProviderInboundUpdateEnvelopeV2ProofField = Extract<
  keyof ProviderInboundUpdateEnvelopeV2,
  ProviderInboundProofField
>;
type ProviderInboundUpdateEnvelopeV2CanonicalProofField =
  | (typeof PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS)[number]
  | (typeof PROVIDER_INBOUND_V2_OPTIONAL_IDENTITY_PROOF_FIELDS)[number]
  | (typeof PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS)[number];
type MissingProviderInboundUpdateEnvelopeV2ProofField = Exclude<
  ProviderInboundUpdateEnvelopeV2ProofField,
  ProviderInboundUpdateEnvelopeV2CanonicalProofField
>;
type AssertNoMissingProviderInboundUpdateEnvelopeV2ProofFields<T extends never> = T;
type ProviderInboundUpdateEnvelopeV2ProofFieldsComplete =
  AssertNoMissingProviderInboundUpdateEnvelopeV2ProofFields<MissingProviderInboundUpdateEnvelopeV2ProofField>;

export function requiredProviderInboundV2ProofFields(
  provenance: SyncUpdateProvenance,
): readonly ProviderInboundProofField[] {
  const required: ProviderInboundProofField[] = [...PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS];
  const identity = provenance.updateIdentity;
  if (identity.providerId) required.push('providerId');
  if (identity.providerKind) required.push('providerKind');
  if (identity.roomId) required.push('roomId');
  if (identity.sequence !== undefined) required.push('sequence');
  if (provenance.trust.status === 'verified' && provenance.author.kind === 'singleRemote') {
    required.push(...PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS);
  }

  return [...new Set(required)];
}
