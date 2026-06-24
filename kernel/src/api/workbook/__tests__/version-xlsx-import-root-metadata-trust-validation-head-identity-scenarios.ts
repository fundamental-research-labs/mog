import { readAndValidateMogVersionMetadataFromXlsx } from '../version/xlsx-metadata/xlsx-version-metadata';
import { expectedMetadataTrustHead } from './version-xlsx-import-root-metadata-trust-validation-helpers';
import {
  createMetadataTrustXlsx,
  createMetadataTrustXlsxWithMissingHead,
} from './version-xlsx-import-root-metadata-trust-validation-scenario-helpers';
import {
  METADATA_TRUST_DOCUMENT_ID,
  OLD_METADATA_COMMIT_ID,
  OTHER_METADATA_COMMIT_ID,
  REF_REVISION,
} from './version-xlsx-import-root-test-utils';

export function registerRootMetadataTrustValidationHeadIdentityScenarios(): void {
  it('rejects metadata without a verified head identity', async () => {
    const xlsxBytes = await createMetadataTrustXlsx({
      refRevision: REF_REVISION,
    });

    expect(
      readAndValidateMogVersionMetadataFromXlsx(xlsxBytes, {
        expectedDocumentId: METADATA_TRUST_DOCUMENT_ID,
      }),
    ).toMatchObject({
      status: 'untrusted',
      reason: 'head-unverified',
      diagnostics: [
        expect.objectContaining({
          code: 'mogVersionMetadataUntrusted',
          reason: 'head-unverified',
          details: expect.objectContaining({ redacted: true }),
        }),
      ],
    });
  });

  it('rejects metadata copied into another document', async () => {
    const xlsxBytes = await createMetadataTrustXlsx({
      refRevision: REF_REVISION,
    });

    expect(
      readAndValidateMogVersionMetadataFromXlsx(xlsxBytes, {
        expectedDocumentId: 'copied-target-document',
        expectedHead: expectedMetadataTrustHead({
          commitId: OLD_METADATA_COMMIT_ID,
          refRevision: REF_REVISION,
        }),
      }),
    ).toMatchObject({
      status: 'untrusted',
      reason: 'wrong-document',
    });
  });

  it('rejects metadata with a mismatched head identity', async () => {
    const xlsxBytes = await createMetadataTrustXlsx({
      refRevision: REF_REVISION,
    });

    expect(
      readAndValidateMogVersionMetadataFromXlsx(xlsxBytes, {
        expectedDocumentId: METADATA_TRUST_DOCUMENT_ID,
        expectedHead: expectedMetadataTrustHead({
          commitId: OTHER_METADATA_COMMIT_ID,
          refRevision: REF_REVISION,
        }),
      }),
    ).toMatchObject({
      status: 'untrusted',
      reason: 'head-mismatch',
    });
  });

  it('requires object digests before trusting a matched head identity', async () => {
    const xlsxBytes = await createMetadataTrustXlsx({
      refRevision: REF_REVISION,
    });

    expect(
      readAndValidateMogVersionMetadataFromXlsx(xlsxBytes, {
        expectedDocumentId: METADATA_TRUST_DOCUMENT_ID,
        expectedHead: expectedMetadataTrustHead({
          commitId: OLD_METADATA_COMMIT_ID,
          refRevision: REF_REVISION,
        }),
      }),
    ).toMatchObject({
      status: 'untrusted',
      reason: 'missing-object-digests',
    });
  });

  it('rejects metadata with no head', async () => {
    const xlsxBytes = await createMetadataTrustXlsxWithMissingHead();

    expect(
      readAndValidateMogVersionMetadataFromXlsx(xlsxBytes, {
        expectedDocumentId: METADATA_TRUST_DOCUMENT_ID,
      }),
    ).toMatchObject({ status: 'untrusted', reason: 'missing-head' });
  });
}
