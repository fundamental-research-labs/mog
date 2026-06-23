import 'fake-indexeddb/auto';

import {
  addMogVersionMetadataToXlsx,
  readAndValidateMogVersionMetadataFromXlsx,
} from '../xlsx-version-metadata';
import { installMetadataTrustIndexedDbHooks } from './version-xlsx-import-root-metadata-trust-test-utils';
import {
  createSourceXlsx,
  METADATA_TRUST_DOCUMENT_ID,
  OLD_METADATA_COMMIT_ID,
  OTHER_METADATA_COMMIT_ID,
  OTHER_REF_REVISION,
  OTHER_SEMANTIC_CHANGE_SET_DIGEST,
  OTHER_SNAPSHOT_ROOT_DIGEST,
  REF_REVISION,
  SEMANTIC_CHANGE_SET_DIGEST,
  SNAPSHOT_ROOT_DIGEST,
  testVersionMetadata,
} from './version-xlsx-import-root-test-utils';

installMetadataTrustIndexedDbHooks();

describe('WorkbookVersion XLSX import root metadata trust', () => {
  it('validates Mog version metadata only against authoritative document and head identity', async () => {
    const xlsxBytes = addMogVersionMetadataToXlsx(
      await createSourceXlsx(),
      testVersionMetadata({
        documentId: METADATA_TRUST_DOCUMENT_ID,
        commitId: OLD_METADATA_COMMIT_ID,
        refRevision: REF_REVISION,
      }),
    );

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

    expect(
      readAndValidateMogVersionMetadataFromXlsx(xlsxBytes, {
        expectedDocumentId: 'copied-target-document',
        expectedHead: {
          commitId: OLD_METADATA_COMMIT_ID,
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
          refRevision: REF_REVISION,
        },
      }),
    ).toMatchObject({
      status: 'untrusted',
      reason: 'wrong-document',
    });

    expect(
      readAndValidateMogVersionMetadataFromXlsx(xlsxBytes, {
        expectedDocumentId: METADATA_TRUST_DOCUMENT_ID,
        expectedHead: {
          commitId: OTHER_METADATA_COMMIT_ID,
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
          refRevision: REF_REVISION,
        },
      }),
    ).toMatchObject({
      status: 'untrusted',
      reason: 'head-mismatch',
    });

    expect(
      readAndValidateMogVersionMetadataFromXlsx(xlsxBytes, {
        expectedDocumentId: METADATA_TRUST_DOCUMENT_ID,
        expectedHead: {
          commitId: OLD_METADATA_COMMIT_ID,
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
          refRevision: REF_REVISION,
        },
      }),
    ).toMatchObject({
      status: 'untrusted',
      reason: 'missing-object-digests',
    });

    const missingHeadXlsxBytes = addMogVersionMetadataToXlsx(await createSourceXlsx(), {
      ...testVersionMetadata({
        documentId: METADATA_TRUST_DOCUMENT_ID,
        commitId: OLD_METADATA_COMMIT_ID,
      }),
      head: null,
    });
    expect(
      readAndValidateMogVersionMetadataFromXlsx(missingHeadXlsxBytes, {
        expectedDocumentId: METADATA_TRUST_DOCUMENT_ID,
      }),
    ).toMatchObject({ status: 'untrusted', reason: 'missing-head' });

    const digestBoundXlsxBytes = addMogVersionMetadataToXlsx(
      await createSourceXlsx(),
      testVersionMetadata({
        documentId: METADATA_TRUST_DOCUMENT_ID,
        commitId: OLD_METADATA_COMMIT_ID,
        refRevision: REF_REVISION,
        semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
        snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
      }),
    );

    const digestBoundWithoutRevisionXlsxBytes = addMogVersionMetadataToXlsx(
      await createSourceXlsx(),
      testVersionMetadata({
        documentId: METADATA_TRUST_DOCUMENT_ID,
        commitId: OLD_METADATA_COMMIT_ID,
        semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
        snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
      }),
    );

    expect(
      readAndValidateMogVersionMetadataFromXlsx(digestBoundWithoutRevisionXlsxBytes, {
        expectedDocumentId: METADATA_TRUST_DOCUMENT_ID,
        expectedHead: {
          commitId: OLD_METADATA_COMMIT_ID,
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
          refRevision: REF_REVISION,
          semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
          snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
        },
      }),
    ).toMatchObject({
      status: 'untrusted',
      reason: 'head-unverified',
    });

    expect(
      readAndValidateMogVersionMetadataFromXlsx(digestBoundXlsxBytes, {
        expectedDocumentId: METADATA_TRUST_DOCUMENT_ID,
        expectedHead: {
          commitId: OLD_METADATA_COMMIT_ID,
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
          semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
          snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
        },
      }),
    ).toMatchObject({
      status: 'untrusted',
      reason: 'head-unverified',
    });

    expect(
      readAndValidateMogVersionMetadataFromXlsx(digestBoundXlsxBytes, {
        expectedDocumentId: METADATA_TRUST_DOCUMENT_ID,
        expectedHead: {
          commitId: OLD_METADATA_COMMIT_ID,
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
          refRevision: REF_REVISION,
          semanticChangeSetDigest: OTHER_SEMANTIC_CHANGE_SET_DIGEST,
          snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
        },
      }),
    ).toMatchObject({
      status: 'untrusted',
      reason: 'object-digest-mismatch',
    });

    expect(
      readAndValidateMogVersionMetadataFromXlsx(digestBoundXlsxBytes, {
        expectedDocumentId: METADATA_TRUST_DOCUMENT_ID,
        expectedHead: {
          commitId: OLD_METADATA_COMMIT_ID,
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
          refRevision: REF_REVISION,
          semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
          snapshotRootDigest: OTHER_SNAPSHOT_ROOT_DIGEST,
        },
      }),
    ).toMatchObject({
      status: 'untrusted',
      reason: 'snapshot-root-mismatch',
    });

    expect(
      readAndValidateMogVersionMetadataFromXlsx(digestBoundXlsxBytes, {
        expectedDocumentId: METADATA_TRUST_DOCUMENT_ID,
        expectedHead: {
          commitId: OLD_METADATA_COMMIT_ID,
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
          refRevision: OTHER_REF_REVISION,
          semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
          snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
        },
      }),
    ).toMatchObject({
      status: 'untrusted',
      reason: 'head-mismatch',
    });

    expect(
      readAndValidateMogVersionMetadataFromXlsx(digestBoundXlsxBytes, {
        expectedDocumentId: METADATA_TRUST_DOCUMENT_ID,
        expectedHead: {
          commitId: OLD_METADATA_COMMIT_ID,
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
          refRevision: REF_REVISION,
          semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
          snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
        },
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
});
