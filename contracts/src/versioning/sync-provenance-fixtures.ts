import type {
  ProviderAuthorityProofV2,
  ProviderInboundProofField,
  SyncUpdateDiagnosticEvidence,
} from '@mog-sdk/types-document/storage/inbound-updates';
import type { VersionSyncOperationContext } from './sync-provenance';

const VERSION_SYNC_PROVENANCE_PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS = Object.freeze([
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

const VERSION_SYNC_PROVENANCE_PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS = Object.freeze([
  'remoteSessionId',
  'remoteAuthorRef',
  'correlationId',
  'causationIds',
] as const satisfies readonly ProviderInboundProofField[]);

export const VERSION_SYNC_PROVENANCE_PROVIDER_AUTHORITY_PROOF_V2_REQUIRED_FIELDS = Object.freeze([
  ...VERSION_SYNC_PROVENANCE_PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS,
  'providerId',
  'providerKind',
  ...VERSION_SYNC_PROVENANCE_PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS,
] as const satisfies readonly ProviderInboundProofField[]);

export const VERSION_SYNC_PROVENANCE_PROVIDER_MIXED_AUTHORITY_PROOF_V2_REQUIRED_FIELDS =
  Object.freeze([
    ...VERSION_SYNC_PROVENANCE_PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS,
    'providerId',
    'providerKind',
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

export const VERSION_SYNC_PROVENANCE_PROVIDER_LIVE_INBOUND_EVIDENCE_FIXTURE = Object.freeze({
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

export const VERSION_SYNC_PROVENANCE_PROVIDER_MIXED_INBOUND_EVIDENCE_FIXTURE = Object.freeze({
  schemaVersion: 'sync-update-diagnostic-evidence-v1',
  envelopeVersion: 'provider-inbound-update-v2',
  sourceKind: 'providerMixedInbound',
  capturePolicy: 'excluded',
  replay: false,
  system: false,
  admission: Object.freeze({
    status: 'accepted',
    diagnosticCount: 0,
    diagnostics: Object.freeze([]),
    exclusionReason: 'mixedAuthors',
    exclusionSubreason: 'aggregateWithoutBoundaries',
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
    proofCoverage: VERSION_SYNC_PROVENANCE_PROVIDER_MIXED_AUTHORITY_PROOF_V2_REQUIRED_FIELDS,
    hasIssuer: true,
    hasVerifiedAt: true,
  }),
  author: Object.freeze({
    kind: 'mixedRemote',
    participantCount: 2,
    reason: 'aggregateWithoutBoundaries',
  }),
  redaction: Object.freeze({
    mode: 'opaque-digest-only',
    durableAuthorIdentity: 'unknown',
    durableProviderIdentity: 'hmac-sha256-digest',
    redactionKeyIdPresent: true,
    proofMaterial: 'drop',
    proofMaterialExported: false,
  }),
  correlation: Object.freeze({
    hasRemoteSessionId: false,
    hasCorrelationId: false,
    causationIdCount: 0,
  }),
} as const satisfies SyncUpdateDiagnosticEvidence);

export const VERSION_SYNC_PROVENANCE_BLOCKED_BATCH_FAILURE_CONTEXT_FIXTURE = Object.freeze({
  sourceKind: 'providerLiveInbound',
  originKind: 'provider',
  stableOriginId:
    'stable-origin-digest:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  providerId:
    'provider-digest:sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  providerKind: 'fixture-provider',
  authorityRef:
    'authority-digest:sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  epoch: 'provider-epoch-7',
  updateId: 'update-digest:sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  sequence: '42',
  payloadHash:
    'payload-digest:sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  provenancePayloadHash:
    'provenance-digest:sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  trustStatus: 'verified',
  authorState: 'singleRemote',
  remoteSessionId:
    'remote-session-digest:sha256:1111111111111111111111111111111111111111111111111111111111111111',
  correlationId:
    'correlation-digest:sha256:2222222222222222222222222222222222222222222222222222222222222222',
  causationIds: Object.freeze([
    'causation-digest:sha256:3333333333333333333333333333333333333333333333333333333333333333',
  ] as const),
  replay: false,
  system: false,
  commitGrouping: 'blockedBatchFailure',
  batchId: 'batch-digest:sha256:4444444444444444444444444444444444444444444444444444444444444444',
  subUpdateIndex: 0,
  subUpdateCount: 3,
  batchStatusId:
    'sync-batch-status:sha256:5555555555555555555555555555555555555555555555555555555555555555',
  batchStatusState: 'failedAfterMutation',
  validationDiagnosticCount: 1,
  exclusionReason: 'mixedAuthors',
  exclusionSubreason: 'blockedBatchFailure',
} as const satisfies VersionSyncOperationContext);

export const VERSION_SYNC_PROVENANCE_REDACTION_SAFE_EVIDENCE_FIXTURE =
  VERSION_SYNC_PROVENANCE_PROVIDER_LIVE_INBOUND_EVIDENCE_FIXTURE;
