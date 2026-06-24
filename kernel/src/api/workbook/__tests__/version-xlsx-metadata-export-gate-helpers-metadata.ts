import type { VersionHead, WorkbookCommitId } from '@mog-sdk/contracts/api';

import { type MogWorkbookVersionXlsxMetadata } from '../version/xlsx-metadata/xlsx-version-metadata';
import { REQUIRED_MOG_VERSION_METADATA_REDACTION_OMISSIONS } from '../version/xlsx-metadata/version-xlsx-metadata-export-gate';

import {
  REF_REVISION,
  SEMANTIC_CHANGE_SET_DIGEST,
  SNAPSHOT_ROOT_DIGEST,
} from './version-xlsx-metadata-export-gate-helpers-constants';

export function testVersionMetadata(input: {
  readonly documentId: string;
  readonly workspaceId?: string;
  readonly commitId: WorkbookCommitId;
  readonly refRevision?: NonNullable<VersionHead['refRevision']>;
}): MogWorkbookVersionXlsxMetadata {
  return {
    schemaVersion: 'mog.workbookVersion.xlsxMetadata.v1',
    exportedAt: '2026-06-23T00:00:00.000Z',
    documentId: input.documentId,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    head: {
      commitId: input.commitId,
      refName: 'refs/heads/main',
      resolvedFrom: 'HEAD',
      refRevision: input.refRevision ?? REF_REVISION,
      semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
      snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
    },
    diagnostics: [],
    redaction: {
      policy: 'commit-document-and-object-digests-only',
      omitted: [...REQUIRED_MOG_VERSION_METADATA_REDACTION_OMISSIONS, 'workspaceId'],
    },
  };
}

export function versionHead(input: {
  readonly id: WorkbookCommitId;
  readonly refRevision?: NonNullable<VersionHead['refRevision']>;
}): VersionHead {
  return {
    id: input.id,
    refName: 'refs/heads/main',
    resolvedFrom: 'HEAD',
    ...(input.refRevision ? { refRevision: input.refRevision } : {}),
  };
}

export function expectedMetadataHead(head: VersionHead) {
  return {
    commitId: head.id,
    ...(head.refName ? { refName: head.refName } : {}),
    ...(head.resolvedFrom ? { resolvedFrom: head.resolvedFrom } : {}),
    ...(head.refRevision ? { refRevision: head.refRevision } : {}),
    semanticChangeSetDigest: SEMANTIC_CHANGE_SET_DIGEST,
    snapshotRootDigest: SNAPSHOT_ROOT_DIGEST,
  };
}
