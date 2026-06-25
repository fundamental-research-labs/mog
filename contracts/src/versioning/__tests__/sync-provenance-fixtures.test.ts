import {
  PROVIDER_INBOUND_PROOF_FIELDS,
  PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS,
  PROVIDER_INBOUND_V2_OPTIONAL_IDENTITY_PROOF_FIELDS,
  PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS,
} from '@mog-sdk/types-document/storage/inbound-updates';
import {
  VERSION_SYNC_PROVENANCE_BLOCKED_BATCH_FAILURE_CONTEXT_FIXTURE,
  VERSION_SYNC_PROVENANCE_PROVIDER_AUTHORITY_PROOF_V2_FIXTURE,
  VERSION_SYNC_PROVENANCE_PROVIDER_LIVE_INBOUND_EVIDENCE_FIXTURE,
  VERSION_SYNC_PROVENANCE_PROVIDER_MIXED_AUTHORITY_PROOF_V2_REQUIRED_FIELDS,
  VERSION_SYNC_PROVENANCE_PROVIDER_MIXED_INBOUND_EVIDENCE_FIXTURE,
  VERSION_SYNC_PROVENANCE_PROVIDER_AUTHORITY_PROOF_V2_REQUIRED_FIELDS,
  VERSION_SYNC_PROVENANCE_REDACTION_SAFE_EVIDENCE_FIXTURE,
} from '../index';

describe('versioning sync provenance public fixtures', () => {
  it('covers the complete ProviderAuthorityProofV2 single-author field contract', () => {
    const expectedFields = [
      ...PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS,
      'providerId',
      'providerKind',
      ...PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS,
    ];

    expect(VERSION_SYNC_PROVENANCE_PROVIDER_AUTHORITY_PROOF_V2_REQUIRED_FIELDS).toEqual(
      expectedFields,
    );
    expect(new Set(VERSION_SYNC_PROVENANCE_PROVIDER_AUTHORITY_PROOF_V2_REQUIRED_FIELDS).size).toBe(
      VERSION_SYNC_PROVENANCE_PROVIDER_AUTHORITY_PROOF_V2_REQUIRED_FIELDS.length,
    );
    for (const field of VERSION_SYNC_PROVENANCE_PROVIDER_AUTHORITY_PROOF_V2_REQUIRED_FIELDS) {
      expect(PROVIDER_INBOUND_PROOF_FIELDS).toContain(field);
    }

    expect(VERSION_SYNC_PROVENANCE_PROVIDER_AUTHORITY_PROOF_V2_FIXTURE.coveredFields).toBe(
      VERSION_SYNC_PROVENANCE_PROVIDER_AUTHORITY_PROOF_V2_REQUIRED_FIELDS,
    );
    expect(
      VERSION_SYNC_PROVENANCE_PROVIDER_AUTHORITY_PROOF_V2_FIXTURE.canonicalPayload.coveredFields,
    ).toBe(VERSION_SYNC_PROVENANCE_PROVIDER_AUTHORITY_PROOF_V2_REQUIRED_FIELDS);
    expect(
      VERSION_SYNC_PROVENANCE_PROVIDER_AUTHORITY_PROOF_V2_FIXTURE.audience.map(
        (audience) => audience.kind,
      ),
    ).toEqual(['provider-inbound-update', 'versioning-sync-provenance']);
    expect(VERSION_SYNC_PROVENANCE_PROVIDER_AUTHORITY_PROOF_V2_FIXTURE.canonicalPayload.value).toBe(
      VERSION_SYNC_PROVENANCE_PROVIDER_AUTHORITY_PROOF_V2_FIXTURE.canonicalPayloadHash,
    );
  });

  it('exports a redaction-safe diagnostic DTO fixture', () => {
    const evidence = VERSION_SYNC_PROVENANCE_PROVIDER_LIVE_INBOUND_EVIDENCE_FIXTURE;

    expect(evidence.sourceKind).toBe('providerLiveInbound');
    expect(evidence.capturePolicy).toBe('commitEligible');
    expect(evidence.author.kind).toBe('singleRemote');
    expect(evidence.trust.proofSchemaVersion).toBe('provider-authority-proof-v2');
    expect(evidence.trust.proofAudienceKinds).toEqual([
      'provider-inbound-update',
      'versioning-sync-provenance',
    ]);
    expect(evidence.trust.canonicalPayloadHashAlgorithm).toBe('sha256');
    expect(evidence.trust.proofCoverage).toBe(
      VERSION_SYNC_PROVENANCE_PROVIDER_AUTHORITY_PROOF_V2_REQUIRED_FIELDS,
    );
    expect(evidence.redaction.proofMaterialExported).toBe(false);

    const serialized = JSON.stringify(evidence);
    for (const forbidden of [
      '3'.repeat(64),
      'proof:vc09-public-fixture',
      'vc09-public-fixture-issuer',
      'provider-stable-1',
      'provider-session-1',
      'remote-session-1',
      'subject-ref-1',
      'authority-1',
      'update-1',
      'doc-1',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).not.toContain('"canonicalPayloadHash":');
    expect(serialized).not.toContain('"proofBytesOrRef":');
  });

  it('keeps the legacy redaction-safe fixture name as the live inbound fixture', () => {
    expect(VERSION_SYNC_PROVENANCE_REDACTION_SAFE_EVIDENCE_FIXTURE).toBe(
      VERSION_SYNC_PROVENANCE_PROVIDER_LIVE_INBOUND_EVIDENCE_FIXTURE,
    );
  });

  it('distinguishes provider mixed inbound from live single-author inbound', () => {
    const expectedMixedFields = [
      ...PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS,
      'providerId',
      'providerKind',
    ];

    expect(VERSION_SYNC_PROVENANCE_PROVIDER_MIXED_AUTHORITY_PROOF_V2_REQUIRED_FIELDS).toEqual(
      expectedMixedFields,
    );
    for (const field of VERSION_SYNC_PROVENANCE_PROVIDER_MIXED_AUTHORITY_PROOF_V2_REQUIRED_FIELDS) {
      expect(PROVIDER_INBOUND_PROOF_FIELDS).toContain(field);
    }

    const live = VERSION_SYNC_PROVENANCE_PROVIDER_LIVE_INBOUND_EVIDENCE_FIXTURE;
    const mixed = VERSION_SYNC_PROVENANCE_PROVIDER_MIXED_INBOUND_EVIDENCE_FIXTURE;

    expect(mixed.sourceKind).toBe('providerMixedInbound');
    expect(mixed.capturePolicy).toBe('excluded');
    expect(mixed.author).toEqual({
      kind: 'mixedRemote',
      participantCount: 2,
      reason: 'aggregateWithoutBoundaries',
    });
    expect(mixed.admission).toMatchObject({
      status: 'accepted',
      exclusionReason: 'mixedAuthors',
      exclusionSubreason: 'aggregateWithoutBoundaries',
    });
    expect(mixed.correlation).toEqual({
      hasRemoteSessionId: false,
      hasCorrelationId: false,
      causationIdCount: 0,
    });
    expect(mixed.trust.proofCoverage).toBe(
      VERSION_SYNC_PROVENANCE_PROVIDER_MIXED_AUTHORITY_PROOF_V2_REQUIRED_FIELDS,
    );
    expect(mixed.trust.proofCoverage).not.toEqual(live.trust.proofCoverage);

    for (const singleAuthorField of PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS) {
      expect(mixed.trust.proofCoverage).not.toContain(singleAuthorField);
    }
    for (const optionalIdentityField of PROVIDER_INBOUND_V2_OPTIONAL_IDENTITY_PROOF_FIELDS) {
      if (optionalIdentityField === 'roomId' || optionalIdentityField === 'sequence') continue;
      expect(mixed.trust.proofCoverage).toContain(optionalIdentityField);
    }

    expect(JSON.stringify(mixed)).not.toContain('subject-ref-1');
    expect(JSON.stringify(mixed)).not.toContain('remote-session-1');
  });

  it('exports a redaction-safe blocked batch failure grouping fixture', () => {
    const context = VERSION_SYNC_PROVENANCE_BLOCKED_BATCH_FAILURE_CONTEXT_FIXTURE;

    expect(context.sourceKind).toBe('providerLiveInbound');
    expect(context.commitGrouping).toBe('blockedBatchFailure');
    expect(context.batchStatusState).toBe('failedAfterMutation');
    expect(context.batchId).toMatch(/^batch-digest:sha256:[0-9a-f]{64}$/);
    expect(context.batchStatusId).toMatch(/^sync-batch-status:sha256:[0-9a-f]{64}$/);
    expect(context.subUpdateIndex).toBe(0);
    expect(context.subUpdateCount).toBe(3);
    expect(context.validationDiagnosticCount).toBeGreaterThan(0);

    const serialized = JSON.stringify(context);
    for (const forbidden of [
      'provider-stable-1',
      'provider-session-1',
      'remote-session-1',
      'subject-ref-1',
      'authority-1',
      'update-1',
      'doc-1',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).toContain('blockedBatchFailure');
    expect(serialized).toContain('failedAfterMutation');
  });
});
