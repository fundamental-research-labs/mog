import {
  MOG_WORKBOOK_VERSION_XLSX_METADATA_PART,
  MOG_WORKBOOK_VERSION_XLSX_METADATA_REDACTION_POLICIES,
  MOG_WORKBOOK_VERSION_XLSX_METADATA_SCHEMA_VERSION,
  MOG_WORKBOOK_VERSION_XLSX_METADATA_TRUST_REASONS,
  MOG_WORKBOOK_VERSION_XLSX_METADATA_TRUST_STATUSES,
  VERSIONING_CONTRACT_FIXTURES,
} from '../index';
import type {
  MogWorkbookVersionXlsxMetadataRedactionPolicy,
  MogWorkbookVersionXlsxMetadataTrustReason,
  MogWorkbookVersionXlsxMetadataTrustStatus,
  MogWorkbookVersionXlsxMetadataTrustSummary,
} from '../index';

type Assert<T extends true> = T;
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type ExpectedRedactionPolicy =
  | 'commit-and-document-only'
  | 'commit-document-and-object-digests-only';
type ExpectedTrustStatus = 'absent' | 'trusted' | 'untrusted';
type ExpectedTrustReason =
  | 'duplicate-sidecar'
  | 'sidecar-too-large'
  | 'unsupported-compression'
  | 'malformed-sidecar'
  | 'invalid-schema'
  | 'wrong-document'
  | 'missing-head'
  | 'head-unverified'
  | 'head-mismatch'
  | 'missing-object-digests'
  | 'commit-missing'
  | 'object-digest-mismatch'
  | 'snapshot-root-mismatch';

type _ExactRedactionPolicySet = Assert<
  IsEqual<MogWorkbookVersionXlsxMetadataRedactionPolicy, ExpectedRedactionPolicy>
>;
type _ExactTrustStatusSet = Assert<
  IsEqual<MogWorkbookVersionXlsxMetadataTrustStatus, ExpectedTrustStatus>
>;
type _ExactTrustReasonSet = Assert<
  IsEqual<MogWorkbookVersionXlsxMetadataTrustReason, ExpectedTrustReason>
>;

describe('Mog workbook version XLSX interop contracts', () => {
  it('exports stable sidecar identifiers and closed trust taxonomies', () => {
    expect(MOG_WORKBOOK_VERSION_XLSX_METADATA_SCHEMA_VERSION).toBe(
      'mog.workbookVersion.xlsxMetadata.v1',
    );
    expect(MOG_WORKBOOK_VERSION_XLSX_METADATA_PART).toBe(
      'customXml/mog-version-metadata.xml',
    );
    expect(MOG_WORKBOOK_VERSION_XLSX_METADATA_REDACTION_POLICIES).toEqual([
      'commit-and-document-only',
      'commit-document-and-object-digests-only',
    ]);
    expect(MOG_WORKBOOK_VERSION_XLSX_METADATA_TRUST_STATUSES).toEqual([
      'absent',
      'trusted',
      'untrusted',
    ]);
    expect(MOG_WORKBOOK_VERSION_XLSX_METADATA_TRUST_REASONS).toEqual([
      'duplicate-sidecar',
      'sidecar-too-large',
      'unsupported-compression',
      'malformed-sidecar',
      'invalid-schema',
      'wrong-document',
      'missing-head',
      'head-unverified',
      'head-mismatch',
      'missing-object-digests',
      'commit-missing',
      'object-digest-mismatch',
      'snapshot-root-mismatch',
    ]);
  });

  it('models redacted metadata trust without exposing import-time head candidates', () => {
    const absentTrust = {
      status: 'absent',
      sidecarPart: MOG_WORKBOOK_VERSION_XLSX_METADATA_PART,
    } satisfies MogWorkbookVersionXlsxMetadataTrustSummary;
    const untrustedTrust = {
      status: 'untrusted',
      sidecarPart: MOG_WORKBOOK_VERSION_XLSX_METADATA_PART,
      reason: 'wrong-document',
      redacted: true,
    } satisfies MogWorkbookVersionXlsxMetadataTrustSummary;

    expect(absentTrust).not.toHaveProperty('redacted');
    expect(untrustedTrust).toMatchObject({
      status: 'untrusted',
      reason: 'wrong-document',
      redacted: true,
    });

    const metadata = VERSIONING_CONTRACT_FIXTURES.xlsxMetadata;
    const trustedResult = VERSIONING_CONTRACT_FIXTURES.xlsxTrustResult;
    const provenance = VERSIONING_CONTRACT_FIXTURES.xlsxImportRootProvenance;

    expect(metadata).toMatchObject({
      schemaVersion: MOG_WORKBOOK_VERSION_XLSX_METADATA_SCHEMA_VERSION,
      documentId: 'vc10-xlsx-public-contract-fixture',
      head: {
        commitId: `commit:sha256:${'a'.repeat(64)}`,
        refName: 'refs/heads/main',
        resolvedFrom: 'HEAD',
        semanticChangeSetDigest: {
          algorithm: 'sha256',
          digest: '1'.repeat(64),
        },
        snapshotRootDigest: {
          algorithm: 'sha256',
          digest: '2'.repeat(64),
        },
      },
      redaction: {
        policy: 'commit-document-and-object-digests-only',
      },
    });
    expect(trustedResult).toMatchObject({
      status: 'trusted',
      trust: {
        status: 'trusted',
        sidecarPart: MOG_WORKBOOK_VERSION_XLSX_METADATA_PART,
        redacted: true,
      },
      diagnostics: [],
    });
    expect(provenance).toMatchObject({
      kind: 'xlsx',
      source: {
        sourceType: 'bytes',
        byteLength: 4096,
      },
      diagnostics: [],
      versionMetadataTrust: trustedResult.trust,
    });
    expect(provenance).not.toHaveProperty('versionMetadataHeadCandidate');
    expect(JSON.stringify(provenance)).not.toContain('commit:sha256');
  });
});
