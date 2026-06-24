import { addMogVersionMetadataToXlsx } from '../version/xlsx-metadata/xlsx-version-metadata';
import {
  createSourceXlsx,
  METADATA_TRUST_DOCUMENT_ID,
  OLD_METADATA_COMMIT_ID,
  REF_REVISION,
  SEMANTIC_CHANGE_SET_DIGEST,
  SNAPSHOT_ROOT_DIGEST,
  testVersionMetadata,
} from './version-xlsx-import-root-test-utils';

type MetadataTrustXlsxInput = Partial<Parameters<typeof testVersionMetadata>[0]>;

export async function createMetadataTrustXlsx(
  input: MetadataTrustXlsxInput = {},
): Promise<Uint8Array> {
  const {
    documentId = METADATA_TRUST_DOCUMENT_ID,
    commitId = OLD_METADATA_COMMIT_ID,
    refRevision,
    semanticChangeSetDigest,
    snapshotRootDigest,
  } = input;

  return addMogVersionMetadataToXlsx(
    await createSourceXlsx(),
    testVersionMetadata({
      documentId,
      commitId,
      ...(refRevision ? { refRevision } : {}),
      ...(semanticChangeSetDigest ? { semanticChangeSetDigest } : {}),
      ...(snapshotRootDigest ? { snapshotRootDigest } : {}),
    }),
  );
}

export async function createMetadataTrustXlsxWithMissingHead(
  input: MetadataTrustXlsxInput = {},
): Promise<Uint8Array> {
  const {
    documentId = METADATA_TRUST_DOCUMENT_ID,
    commitId = OLD_METADATA_COMMIT_ID,
    refRevision,
    semanticChangeSetDigest,
    snapshotRootDigest,
  } = input;

  return addMogVersionMetadataToXlsx(await createSourceXlsx(), {
    ...testVersionMetadata({
      documentId,
      commitId,
      ...(refRevision ? { refRevision } : {}),
      ...(semanticChangeSetDigest ? { semanticChangeSetDigest } : {}),
      ...(snapshotRootDigest ? { snapshotRootDigest } : {}),
    }),
    head: null,
  });
}

export async function createDigestBoundMetadataTrustXlsx(
  input: MetadataTrustXlsxInput = {},
): Promise<Uint8Array> {
  return createMetadataTrustXlsx({
    refRevision: REF_REVISION,
    semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
    snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
    ...input,
  });
}
