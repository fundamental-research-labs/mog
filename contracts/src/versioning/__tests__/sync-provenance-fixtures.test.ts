import {
  PROVIDER_INBOUND_PROOF_FIELDS,
  PROVIDER_INBOUND_V2_BASE_PROOF_FIELDS,
  PROVIDER_INBOUND_V2_SINGLE_AUTHOR_PROOF_FIELDS,
} from '@mog-sdk/types-document/storage/inbound-updates';
import {
  VERSION_SYNC_PROVENANCE_PROVIDER_AUTHORITY_PROOF_V2_FIXTURE,
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
    expect(
      VERSION_SYNC_PROVENANCE_PROVIDER_AUTHORITY_PROOF_V2_FIXTURE.canonicalPayload.value,
    ).toBe(VERSION_SYNC_PROVENANCE_PROVIDER_AUTHORITY_PROOF_V2_FIXTURE.canonicalPayloadHash);
  });

  it('exports a redaction-safe diagnostic DTO fixture', () => {
    const evidence = VERSION_SYNC_PROVENANCE_REDACTION_SAFE_EVIDENCE_FIXTURE;

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
});
