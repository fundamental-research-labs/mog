import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_PROVENANCE_REDACTION_POLICY,
  PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS,
  PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS,
  classifyLegacyProviderInboundUpdate,
  classifyLegacyRawUpdate,
  validateProviderInboundUpdateEnvelope,
  validateSyncUpdateProvenance,
  type ProviderAuthorityProof,
  type ProviderInboundProofField,
  type ProviderInboundUpdateEnvelope,
  type ProviderInboundUpdateEnvelopeV2,
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

function makeV1(overrides: Partial<ProviderInboundUpdateEnvelope> = {}): ProviderInboundUpdateEnvelope {
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

function makeV2(overrides: Partial<ProviderInboundUpdateEnvelopeV2> = {}): ProviderInboundUpdateEnvelopeV2 {
  const provenance = overrides.provenance ?? makeLiveProvenance();
  return {
    ...makeV1(),
    schemaVersion: 'provider-inbound-update-v2',
    provenance,
    authorityProof: proof([
      ...PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS,
      ...PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS,
      'providerId',
      'providerKind',
    ]),
    ...overrides,
  };
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
        authorityProof: proof(coveredFields),
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
    assert.ok(
      result.diagnostics.some((diagnostic) => diagnostic.reason === 'payloadHashMismatch'),
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
