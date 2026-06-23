import type {
  ProviderAuthorityProofV2,
  ProviderInboundProofField,
  SyncUpdateDiagnosticEvidence,
} from '@mog-sdk/types-document/storage/inbound-updates';

export const VERSION_SYNC_PROVENANCE_PROVIDER_AUTHORITY_PROOF_V2_REQUIRED_FIELDS = Object.freeze([
  'sourceKind',
  'originKind',
  'stableOriginId',
  'providerRefId',
  'storageScope',
  'authorityRef',
  'authorState',
  'provenanceRedactionPolicy',
  'provenancePayloadHash',
  'payloadHash',
  'updateId',
  'epoch',
  'providerId',
  'providerKind',
  'remoteSessionId',
  'remoteAuthorRef',
  'correlationId',
  'causationIds',
] as const satisfies readonly ProviderInboundProofField[]);

export const VERSION_SYNC_PROVENANCE_PROVIDER_AUTHORITY_PROOF_V2_FIXTURE = Object.freeze({
  schemaVersion: 'provider-authority-proof-v2',
  kind: 'signed-provider-message',
  issuer: 'vc09-public-fixture-issuer',
  algorithm: 'ed25519',
  issuedAt: 1_720_000_000_000,
  audience: Object.freeze([
    Object.freeze({
      kind: 'provider-inbound-update',
    }),
    Object.freeze({
      kind: 'versioning-sync-provenance',
    }),
  ]),
  coveredFields: VERSION_SYNC_PROVENANCE_PROVIDER_AUTHORITY_PROOF_V2_REQUIRED_FIELDS,
  canonicalPayloadHash: '3'.repeat(64),
  canonicalPayload: Object.freeze({
    schemaVersion: 'provider-authority-canonical-payload-v1',
    algorithm: 'sha256',
    canonicalization: 'mog-provider-authority-proof-v2/sorted-json-sha256-v1',
    value: '3'.repeat(64),
    coveredFields: VERSION_SYNC_PROVENANCE_PROVIDER_AUTHORITY_PROOF_V2_REQUIRED_FIELDS,
  }),
  proofBytesOrRef: 'proof:vc09-public-fixture',
} as const satisfies ProviderAuthorityProofV2);

export const VERSION_SYNC_PROVENANCE_REDACTION_SAFE_EVIDENCE_FIXTURE = Object.freeze({
  schemaVersion: 'sync-update-diagnostic-evidence-v1',
  envelopeVersion: 'provider-inbound-update-v2',
  sourceKind: 'providerLiveInbound',
  capturePolicy: 'commitEligible',
  replay: false,
  system: false,
  admission: Object.freeze({
    status: 'accepted',
    diagnosticCount: 0,
    diagnostics: Object.freeze([]),
  }),
  identity: Object.freeze({
    originKind: 'provider',
    hasStableOriginId: true,
    hasProviderId: true,
    providerKind: 'fixture-provider',
    hasProviderRefId: true,
    storageScopeKind: 'scoped',
    hasRoomId: false,
    hasAuthorityRef: true,
    hasEpoch: true,
    hasUpdateId: true,
    hasSequence: false,
    hasPayloadHash: true,
    hasProvenancePayloadHash: true,
  }),
  trust: Object.freeze({
    status: 'verified',
    hasAuthorityRef: true,
    proofKind: 'signed-provider-message',
    proofSchemaVersion: 'provider-authority-proof-v2',
    proofAudienceKinds: Object.freeze([
      'provider-inbound-update',
      'versioning-sync-provenance',
    ] as const),
    canonicalPayloadHashAlgorithm: 'sha256',
    proofCoverage: VERSION_SYNC_PROVENANCE_PROVIDER_AUTHORITY_PROOF_V2_REQUIRED_FIELDS,
    hasIssuer: true,
    hasVerifiedAt: true,
  }),
  author: Object.freeze({
    kind: 'singleRemote',
    remoteRefKind: 'hmac-sha256-digest',
    remoteRefKeyIdPresent: true,
  }),
  redaction: Object.freeze({
    mode: 'opaque-digest-only',
    durableAuthorIdentity: 'hmac-sha256-digest',
    durableProviderIdentity: 'hmac-sha256-digest',
    redactionKeyIdPresent: true,
    proofMaterial: 'drop',
    proofMaterialExported: false,
  }),
  correlation: Object.freeze({
    hasRemoteSessionId: true,
    hasCorrelationId: true,
    causationIdCount: 1,
  }),
} as const satisfies SyncUpdateDiagnosticEvidence);
