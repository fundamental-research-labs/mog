import type { ObjectDigest, WorkbookCommitId } from '@mog-sdk/contracts/api';

import type { MogWorkbookVersionXlsxMetadata } from '../version/xlsx-metadata/xlsx-version-metadata';

export function testVersionMetadata(input: {
  readonly documentId: string;
  readonly commitId: WorkbookCommitId;
  readonly refRevision?: NonNullable<MogWorkbookVersionXlsxMetadata['head']>['refRevision'];
  readonly semanticChangeSetDigest?: ObjectDigest;
  readonly snapshotRootDigest?: ObjectDigest;
}): MogWorkbookVersionXlsxMetadata {
  return {
    schemaVersion: 'mog.workbookVersion.xlsxMetadata.v1',
    exportedAt: '2026-06-21T00:00:00.000Z',
    documentId: input.documentId,
    head: {
      commitId: input.commitId,
      refName: 'refs/heads/main',
      resolvedFrom: 'HEAD',
      ...(input.refRevision ? { refRevision: input.refRevision } : {}),
      ...(input.semanticChangeSetDigest
        ? { semanticChangeSetDigest: input.semanticChangeSetDigest }
        : {}),
      ...(input.snapshotRootDigest ? { snapshotRootDigest: input.snapshotRootDigest } : {}),
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
