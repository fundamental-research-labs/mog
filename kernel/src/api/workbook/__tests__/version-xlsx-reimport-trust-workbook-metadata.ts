import type {
  MogWorkbookVersionXlsxMetadata,
  MogWorkbookVersionXlsxMetadataExpectedHead,
} from '../version/xlsx-metadata/xlsx-version-metadata';

export function trustedVersionMetadata(
  documentId: string,
  workspaceId: string | undefined,
  expectedHead: MogWorkbookVersionXlsxMetadataExpectedHead,
): MogWorkbookVersionXlsxMetadata {
  return {
    schemaVersion: 'mog.workbookVersion.xlsxMetadata.v1',
    exportedAt: '2026-06-23T00:00:00.000Z',
    documentId,
    ...(workspaceId ? { workspaceId } : {}),
    head: {
      commitId: expectedHead.commitId,
      ...(expectedHead.refName ? { refName: expectedHead.refName } : {}),
      ...(expectedHead.resolvedFrom ? { resolvedFrom: expectedHead.resolvedFrom } : {}),
      ...(expectedHead.refRevision ? { refRevision: expectedHead.refRevision } : {}),
      ...(expectedHead.semanticChangeSetDigest
        ? { semanticChangeSetDigest: expectedHead.semanticChangeSetDigest }
        : {}),
      ...(expectedHead.snapshotRootDigest
        ? { snapshotRootDigest: expectedHead.snapshotRootDigest }
        : {}),
    },
    diagnostics: [],
    redaction: {
      policy: 'commit-document-and-object-digests-only',
      omitted: [
        'authors',
        'agentTraces',
        'rawWorkbookBytes',
        'credentials',
        'externalDataSecrets',
        'objectStoreNamespace',
        'workspaceId',
        'principalScope',
      ],
    },
  };
}
