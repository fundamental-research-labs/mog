import { readAndValidateMogVersionMetadataFromXlsx } from '../version/xlsx-metadata/xlsx-version-metadata';
import { expectedMetadataTrustHead } from './version-xlsx-import-root-metadata-trust-validation-helpers';
import {
  createDigestBoundMetadataTrustXlsx,
  createMetadataTrustXlsx,
} from './version-xlsx-import-root-metadata-trust-validation-scenario-helpers';
import {
  METADATA_TRUST_DOCUMENT_ID,
  OLD_METADATA_COMMIT_ID,
  OTHER_REF_REVISION,
  OTHER_SEMANTIC_CHANGE_SET_DIGEST,
  OTHER_SNAPSHOT_ROOT_DIGEST,
  REF_REVISION,
  SEMANTIC_CHANGE_SET_DIGEST,
  SNAPSHOT_ROOT_DIGEST,
} from './version-xlsx-import-root-test-utils';

export function registerRootMetadataTrustValidationObjectDigestScenarios(): void {
  it('requires ref revision coverage before trusting matching object digests', async () => {
    const digestBoundWithoutRevisionXlsxBytes = await createMetadataTrustXlsx({
      semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
      snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
    });

    expect(
      readAndValidateMogVersionMetadataFromXlsx(digestBoundWithoutRevisionXlsxBytes, {
        expectedDocumentId: METADATA_TRUST_DOCUMENT_ID,
        expectedHead: expectedMetadataTrustHead({
          commitId: OLD_METADATA_COMMIT_ID,
          refRevision: REF_REVISION,
          semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
          snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
        }),
      }),
    ).toMatchObject({
      status: 'untrusted',
      reason: 'head-unverified',
    });

    const digestBoundXlsxBytes = await createDigestBoundMetadataTrustXlsx();

    expect(
      readAndValidateMogVersionMetadataFromXlsx(digestBoundXlsxBytes, {
        expectedDocumentId: METADATA_TRUST_DOCUMENT_ID,
        expectedHead: expectedMetadataTrustHead({
          commitId: OLD_METADATA_COMMIT_ID,
          semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
          snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
        }),
      }),
    ).toMatchObject({
      status: 'untrusted',
      reason: 'head-unverified',
    });
  });

  it('rejects metadata with a mismatched semantic change set digest', async () => {
    const xlsxBytes = await createDigestBoundMetadataTrustXlsx();

    expect(
      readAndValidateMogVersionMetadataFromXlsx(xlsxBytes, {
        expectedDocumentId: METADATA_TRUST_DOCUMENT_ID,
        expectedHead: expectedMetadataTrustHead({
          commitId: OLD_METADATA_COMMIT_ID,
          refRevision: REF_REVISION,
          semanticChangeSetDigest: OTHER_SEMANTIC_CHANGE_SET_DIGEST,
          snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
        }),
      }),
    ).toMatchObject({
      status: 'untrusted',
      reason: 'object-digest-mismatch',
    });
  });

  it('rejects metadata with a mismatched snapshot root digest', async () => {
    const xlsxBytes = await createDigestBoundMetadataTrustXlsx();

    expect(
      readAndValidateMogVersionMetadataFromXlsx(xlsxBytes, {
        expectedDocumentId: METADATA_TRUST_DOCUMENT_ID,
        expectedHead: expectedMetadataTrustHead({
          commitId: OLD_METADATA_COMMIT_ID,
          refRevision: REF_REVISION,
          semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
          snapshotRootDigest: OTHER_SNAPSHOT_ROOT_DIGEST,
        }),
      }),
    ).toMatchObject({
      status: 'untrusted',
      reason: 'snapshot-root-mismatch',
    });
  });

  it('rejects metadata with a mismatched ref revision', async () => {
    const xlsxBytes = await createDigestBoundMetadataTrustXlsx();

    expect(
      readAndValidateMogVersionMetadataFromXlsx(xlsxBytes, {
        expectedDocumentId: METADATA_TRUST_DOCUMENT_ID,
        expectedHead: expectedMetadataTrustHead({
          commitId: OLD_METADATA_COMMIT_ID,
          refRevision: OTHER_REF_REVISION,
          semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
          snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
        }),
      }),
    ).toMatchObject({
      status: 'untrusted',
      reason: 'head-mismatch',
    });
  });

  it('trusts metadata when document, head, revision, and object digests match', async () => {
    const xlsxBytes = await createDigestBoundMetadataTrustXlsx();

    expect(
      readAndValidateMogVersionMetadataFromXlsx(xlsxBytes, {
        expectedDocumentId: METADATA_TRUST_DOCUMENT_ID,
        expectedHead: expectedMetadataTrustHead({
          commitId: OLD_METADATA_COMMIT_ID,
          refRevision: REF_REVISION,
          semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
          snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
        }),
      }),
    ).toMatchObject({
      status: 'trusted',
      metadata: {
        documentId: METADATA_TRUST_DOCUMENT_ID,
        head: {
          commitId: OLD_METADATA_COMMIT_ID,
          refRevision: REF_REVISION,
          semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
          snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
        },
      },
      diagnostics: [],
    });
  });
}
