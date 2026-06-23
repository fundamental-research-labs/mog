import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_PROVENANCE_REDACTION_POLICY,
  PROVIDER_AUTHORITY_CANONICAL_PAYLOAD_CANONICALIZATION,
  PROVIDER_AUTHORITY_CANONICAL_PAYLOAD_SCHEMA_VERSION,
  PROVIDER_AUTHORITY_PROOF_V2_SCHEMA_VERSION,
  PROVIDER_INBOUND_PROOF_FIELDS,
  PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS,
  PROVIDER_INBOUND_V2_OPTIONAL_IDENTITY_PROOF_FIELDS,
  PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS,
  classifyLegacyProviderInboundUpdate,
  classifyLegacyRawUpdate,
  exportProviderInboundUpdateAdmissionEvidence,
  exportSyncUpdateProvenanceEvidence,
  requiredProviderInboundV2ProofFields,
  validateProviderInboundUpdateEnvelope,
  validateSyncUpdateProvenance,
  type ProviderAuthorityProof,
  type ProviderAuthorityProofV2,
  type ProviderInboundProofField,
  type ProviderInboundUpdateEnvelope,
  type ProviderInboundUpdateEnvelopeV2,
  type SyncUpdateDiagnosticEvidence,
  type SyncUpdateProvenance,
} from '../inbound-updates';

const PAYLOAD_HASH = 'a'.repeat(64);
const OTHER_PAYLOAD_HASH = 'b'.repeat(64);
const PROVENANCE_HASH = 'c'.repeat(64);

const storageScope = {
  kind: 'scoped',
  scope: {
    tenantId: { kind: 'single-tenant' },
    workspaceId: { kind: 'no-workspace' },
    documentId: 'doc-1',
  },
} as const;

function proof(coveredFields: readonly ProviderInboundProofField[]): ProviderAuthorityProof {
  return {
    kind: 'signed-provider-message',
    issuer: 'issuer-1',
    algorithm: 'ed25519',
    issuedAt: 1,
    coveredFields,
    canonicalPayloadHash: PROVENANCE_HASH,
    proofBytesOrRef: 'proof-ref-1',
  };
}

function proofV2(coveredFields: readonly ProviderInboundProofField[]): ProviderAuthorityProofV2 {
  return {
    ...proof(coveredFields),
    schemaVersion: PROVIDER_AUTHORITY_PROOF_V2_SCHEMA_VERSION,
    audience: [
      {
        kind: 'provider-inbound-update',
        authorityRef: 'authority-1',
        providerRefId: 'provider-session-1',
        storageScope,
      },
    ],
    canonicalPayload: {
      schemaVersion: PROVIDER_AUTHORITY_CANONICAL_PAYLOAD_SCHEMA_VERSION,
      algorithm: 'sha256',
      canonicalization: PROVIDER_AUTHORITY_CANONICAL_PAYLOAD_CANONICALIZATION,
      value: PROVENANCE_HASH,
      coveredFields,
    },
  };
}

function makeV1(
  overrides: Partial<ProviderInboundUpdateEnvelope> = {},
): ProviderInboundUpdateEnvelope {
  return {
    providerRefId: 'provider-session-1',
    authorityRef: 'authority-1',
    storageScope,
    decisionId: 'decision-1',
    sessionId: 'local-session-1',
    providerEpoch: 'epoch-1',
    updateId: 'update-1',
    payloadKind: 'yrs-update-v1',
    payloadHash: PAYLOAD_HASH,
    payload: new Uint8Array([1, 2, 3]),
    authorityProof: proof(['payloadHash', 'updateId']),
    ...overrides,
  };
}

function makeLiveProvenance(overrides: Partial<SyncUpdateProvenance> = {}): SyncUpdateProvenance {
  return {
    schemaVersion: 'sync-update-provenance-v1',
    sourceKind: 'providerLiveInbound',
    updateIdentity: {
      originKind: 'provider',
      stableOriginId: 'provider-stable-1',
      providerId: 'provider-stable-1',
      providerKind: 'test-provider',
      providerRefId: 'provider-session-1',
      storageScope,
      authorityRef: 'authority-1',
      epoch: 'epoch-1',
      updateId: 'update-1',
      payloadHash: PAYLOAD_HASH,
      provenancePayloadHash: PROVENANCE_HASH,
    },
    trust: {
      status: 'verified',
      authorityRef: 'authority-1',
      proofKind: 'signed-provider-message',
      proofSchemaVersion: PROVIDER_AUTHORITY_PROOF_V2_SCHEMA_VERSION,
      proofAudienceKinds: ['provider-inbound-update'],
      canonicalPayloadHashAlgorithm: 'sha256',
      proofCoverage: [
        ...PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS,
        ...PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS,
        'providerId',
        'providerKind',
      ],
      issuer: 'issuer-1',
    },
    author: {
      kind: 'singleRemote',
      remoteAuthorRef: {
        kind: 'opaque-subject-ref',
        value: 'subject-ref-1',
      },
    },
    remoteSessionId: 'remote-session-1',
    correlationId: 'correlation-1',
    causationIds: ['cause-1'],
    replay: false,
    system: false,
    capturePolicy: 'commitEligible',
    redaction: {
      ...DEFAULT_PROVENANCE_REDACTION_POLICY,
      mode: 'opaque-digest-only',
      durableAuthorIdentity: 'opaque-subject-ref',
      durableProviderIdentity: 'opaque-provider-ref',
    },
    ...overrides,
  };
}

function makeV2(
  overrides: Partial<ProviderInboundUpdateEnvelopeV2> = {},
): ProviderInboundUpdateEnvelopeV2 {
  const provenance = overrides.provenance ?? makeLiveProvenance();
  return {
    ...makeV1(),
    schemaVersion: 'provider-inbound-update-v2',
    provenance,
    authorityProof: proofV2([
      ...PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS,
      ...PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS,
      'providerId',
      'providerKind',
    ]),
    ...overrides,
  };
}

function assertExportSafeEvidence(evidence: SyncUpdateDiagnosticEvidence): void {
  const serialized = JSON.stringify(evidence);
  for (const rawValue of [
    PAYLOAD_HASH,
    OTHER_PAYLOAD_HASH,
    PROVENANCE_HASH,
    'proof-ref-1',
    'issuer-1',
    'provider-stable-1',
    'provider-session-1',
    'authority-1',
    'local-session-1',
    'remote-session-1',
    'subject-ref-1',
    'decision-1',
    'doc-1',
    'update-1',
    'correlation-1',
    'cause-1',
  ]) {
    assert.equal(serialized.includes(rawValue), false, `leaked raw value: ${rawValue}`);
  }
}

describe('VC-09 inbound update provenance helpers', () => {
  it('validates V2 live single-author provenance', () => {
    const result = validateProviderInboundUpdateEnvelope(makeV2(), {
      expectedPayloadHash: PAYLOAD_HASH,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.diagnostics, []);
  });

  it('classifies V1 provider envelopes as provider replay without authorship', () => {
    const provenance = classifyLegacyProviderInboundUpdate(makeV1(), {
      providerId: 'provider-stable-1',
    });

    assert.equal(provenance.sourceKind, 'providerReplay');
    assert.equal(provenance.capturePolicy, 'excluded');
    assert.equal(provenance.replay, true);
    assert.equal(provenance.system, true);
    assert.equal(provenance.author.kind, 'unknown');
    assert.equal(provenance.updateIdentity.stableOriginId, 'provider-stable-1');
  });

  it('classifies raw legacy updates as legacyRawUnknown without remote author inference', () => {
    const provenance = classifyLegacyRawUpdate({
      payloadHash: PAYLOAD_HASH,
      updateId: 'raw-update-1',
    });

    assert.equal(provenance.sourceKind, 'legacyRawUnknown');
    assert.equal(provenance.capturePolicy, 'excluded');
    assert.equal(provenance.trust.status, 'legacyRaw');
    assert.equal(provenance.author.kind, 'unknown');
    assert.equal(provenance.author.reason, 'legacyRaw');
  });

  it('reports proof coverage and payload hash requirements', () => {
    const coveredFields = [
      ...PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS,
      ...PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS.filter(
        (field) => field !== 'remoteAuthorRef',
      ),
      'providerId',
      'providerKind',
    ] satisfies ProviderInboundProofField[];
    const result = validateProviderInboundUpdateEnvelope(
      makeV2({
        authorityProof: proofV2(coveredFields),
      }),
      { expectedPayloadHash: OTHER_PAYLOAD_HASH },
    );

    assert.equal(result.ok, false);
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.reason === 'partialCoverage' && diagnostic.field === 'remoteAuthorRef',
      ),
    );
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.reason === 'payloadHashMismatch'));
  });

  it('requires V2 envelope fields in canonical proof coverage', () => {
    const envelopeFields = [
      'decisionId',
      'sessionId',
      'providerEpoch',
      'payloadKind',
    ] as const satisfies readonly ProviderInboundProofField[];
    const requiredFields = requiredProviderInboundV2ProofFields(makeLiveProvenance());

    for (const field of envelopeFields) {
      assert.ok(requiredFields.includes(field), `missing canonical envelope field: ${field}`);
    }

    const result = validateProviderInboundUpdateEnvelope(
      makeV2({
        authorityProof: proofV2(requiredFields.filter((field) => field !== 'decisionId')),
      }),
    );

    assert.equal(result.ok, false);
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.reason === 'partialCoverage' && diagnostic.field === 'decisionId',
      ),
    );
  });

  it('computes the complete required V2 proof field set from provenance', () => {
    const provenance = makeLiveProvenance({
      updateIdentity: {
        ...makeLiveProvenance().updateIdentity,
        roomId: 'room-1',
        sequence: BigInt(7),
      },
    });
    const requiredFields = requiredProviderInboundV2ProofFields(provenance);

    assert.deepEqual(requiredFields, [
      ...PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS,
      ...PROVIDER_INBOUND_V2_OPTIONAL_IDENTITY_PROOF_FIELDS,
      ...PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS,
    ]);
    assert.equal(new Set(requiredFields).size, requiredFields.length);
    for (const field of requiredFields) assert.ok(PROVIDER_INBOUND_PROOF_FIELDS.includes(field));
  });

  it('rejects V2 proofs without the provider inbound audience', () => {
    const authorityProof = {
      ...proofV2(requiredProviderInboundV2ProofFields(makeLiveProvenance())),
      audience: [],
    } satisfies ProviderAuthorityProofV2;
    const result = validateProviderInboundUpdateEnvelope(makeV2({ authorityProof }));

    assert.equal(result.ok, false);
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.reason === 'invalidProofContract' &&
          diagnostic.subreason === 'missingProofAudience',
      ),
    );
  });

  it('uses V2 canonical covered fields for completeness', () => {
    const completeFields = requiredProviderInboundV2ProofFields(makeLiveProvenance());
    const canonicalFields = completeFields.filter((field) => field !== 'remoteAuthorRef');
    const proof = proofV2(completeFields);
    const result = validateProviderInboundUpdateEnvelope(
      makeV2({
        authorityProof: {
          ...proof,
          canonicalPayload: {
            ...proof.canonicalPayload,
            coveredFields: canonicalFields,
          },
        },
      }),
    );

    assert.equal(result.ok, false);
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.reason === 'partialCoverage' && diagnostic.field === 'remoteAuthorRef',
      ),
    );
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.reason === 'invalidProofContract' &&
          diagnostic.subreason === 'canonicalPayloadCoverageMismatch',
      ),
    );
  });

  it('rejects V2 proofs when canonical payload hash aliases disagree', () => {
    const proof = proofV2(requiredProviderInboundV2ProofFields(makeLiveProvenance()));
    const result = validateProviderInboundUpdateEnvelope(
      makeV2({
        authorityProof: {
          ...proof,
          canonicalPayloadHash: OTHER_PAYLOAD_HASH,
        },
      }),
    );

    assert.equal(result.ok, false);
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.reason === 'invalidProofContract' &&
          diagnostic.subreason === 'canonicalPayloadHashMismatch',
      ),
    );
  });

  it('rejects commit eligibility when local authorship would have to be inferred', () => {
    const result = validateSyncUpdateProvenance(
      makeLiveProvenance({
        author: { kind: 'unknown', reason: 'notProvided' },
      }),
      { expectedPayloadHash: PAYLOAD_HASH },
    );

    assert.equal(result.ok, false);
    assert.ok(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.reason === 'unknownAuthor' &&
          diagnostic.subreason === 'localAuthorInferenceNotAllowed',
      ),
    );
  });
});

describe('VC-09 inbound update export-safe diagnostic evidence', () => {
  it('exports verified provenance without raw proof, hash, session, or author material', () => {
    const unsortedCoverage = [
      'providerKind',
      'providerId',
      ...[...PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS].reverse(),
      ...[...PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS].reverse(),
    ] satisfies ProviderInboundProofField[];
    const provenance = makeLiveProvenance({
      trust: {
        ...makeLiveProvenance().trust,
        proofCoverage: unsortedCoverage,
      },
    });
    const evidence = exportSyncUpdateProvenanceEvidence(provenance);

    assert.equal(evidence.schemaVersion, 'sync-update-diagnostic-evidence-v1');
    assert.equal(evidence.envelopeVersion, 'provenance-only');
    assert.equal(evidence.admission.status, 'accepted');
    assert.deepEqual(evidence.admission.diagnostics, []);
    assert.equal(evidence.sourceKind, 'providerLiveInbound');
    assert.equal(evidence.capturePolicy, 'commitEligible');
    assert.deepEqual(evidence.author, {
      kind: 'singleRemote',
      remoteRefKind: 'opaque-subject-ref',
      remoteRefKeyIdPresent: false,
    });
    assert.equal(evidence.redaction.proofMaterialExported, false);
    assert.equal(evidence.trust.proofSchemaVersion, PROVIDER_AUTHORITY_PROOF_V2_SCHEMA_VERSION);
    assert.deepEqual(evidence.trust.proofAudienceKinds, ['provider-inbound-update']);
    assert.equal(evidence.trust.canonicalPayloadHashAlgorithm, 'sha256');
    assert.deepEqual(evidence.trust.proofCoverage, [...new Set(unsortedCoverage)].sort());
    assertExportSafeEvidence(evidence);
  });

  it('exports unverified admission rejection as diagnostics-only evidence', () => {
    const envelope = makeV2({
      provenance: makeLiveProvenance({
        trust: { status: 'unverified' },
      }),
    });
    const evidence = exportProviderInboundUpdateAdmissionEvidence(envelope, {
      expectedPayloadHash: PAYLOAD_HASH,
    });

    assert.equal(evidence.envelopeVersion, 'provider-inbound-update-v2');
    assert.equal(evidence.admission.status, 'rejected');
    assert.deepEqual(evidence.admission.diagnostics, [
      {
        reason: 'unverifiedProvenance',
        subreason: 'unverifiedTrust',
      },
    ]);
    assert.equal(evidence.trust.status, 'unverified');
    assertExportSafeEvidence(evidence);
  });

  it('exports payload hash mismatch without serializing either hash', () => {
    const evidence = exportProviderInboundUpdateAdmissionEvidence(makeV2(), {
      expectedPayloadHash: OTHER_PAYLOAD_HASH,
    });

    assert.equal(evidence.admission.status, 'rejected');
    assert.deepEqual(evidence.admission.diagnostics, [
      {
        reason: 'payloadHashMismatch',
        subreason: 'payloadHashMismatch',
        field: 'payloadHash',
      },
    ]);
    assert.equal(evidence.identity.hasPayloadHash, true);
    assert.equal(evidence.identity.hasProvenancePayloadHash, true);
    assertExportSafeEvidence(evidence);
  });

  it('exports mixed-author provenance as excluded evidence without participant identity', () => {
    const provenance = makeLiveProvenance({
      sourceKind: 'providerMixedInbound',
      capturePolicy: 'excluded',
      author: {
        kind: 'mixedRemote',
        participantCount: 2,
        reason: 'multipleProvenAuthors',
      },
      exclusionDiagnostic: {
        reason: 'mixedAuthors',
        message: 'Multiple remote authors were aggregated before admission.',
      },
    });
    const evidence = exportProviderInboundUpdateAdmissionEvidence(makeV2({ provenance }), {
      expectedPayloadHash: PAYLOAD_HASH,
    });

    assert.equal(evidence.admission.status, 'accepted');
    assert.equal(evidence.admission.exclusionReason, 'mixedAuthors');
    assert.equal(evidence.sourceKind, 'providerMixedInbound');
    assert.equal(evidence.capturePolicy, 'excluded');
    assert.deepEqual(evidence.author, {
      kind: 'mixedRemote',
      participantCount: 2,
      reason: 'multipleProvenAuthors',
    });
    assertExportSafeEvidence(evidence);
  });

  it('exports provider replay admission as excluded system evidence without local envelope identity', () => {
    const evidence = exportProviderInboundUpdateAdmissionEvidence(makeV1(), {
      expectedPayloadHash: PAYLOAD_HASH,
      legacyClassification: {
        providerId: 'provider-stable-1',
        stableOriginId: 'provider-stable-1',
      },
    });

    assert.equal(evidence.envelopeVersion, 'provider-inbound-update-v1');
    assert.equal(evidence.admission.status, 'accepted');
    assert.equal(evidence.admission.exclusionReason, 'providerReplay');
    assert.equal(evidence.sourceKind, 'providerReplay');
    assert.equal(evidence.capturePolicy, 'excluded');
    assert.equal(evidence.replay, true);
    assert.equal(evidence.system, true);
    assert.deepEqual(evidence.author, {
      kind: 'unknown',
      reason: 'providerReplay',
    });
    assert.equal(evidence.identity.hasStableOriginId, true);
    assert.equal(evidence.identity.hasProviderId, true);
    assertExportSafeEvidence(evidence);
  });
});
