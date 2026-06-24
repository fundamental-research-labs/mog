import {
  workbookCommitIdFromObjectDigest,
  type VersionDependencyRef,
  type WorkbookCommitId,
} from '../object-digest';
import {
  createVersionObjectRecord,
  type InMemoryVersionObjectStore,
  type VersionObjectMemoryBackend,
} from '../object-store';
import type { InMemoryRefStore } from '../refs/ref-store';
import { AUTHOR, NAMESPACE, objectRecord } from './graph-store-recovery-test-helpers-fixtures';

export async function persistRootCommitWithSemanticDependencyGap(
  backend: VersionObjectMemoryBackend,
  objectStore: InMemoryVersionObjectStore,
  mode: 'missing' | 'corrupt',
): Promise<{
  readonly commitId: WorkbookCommitId;
  readonly semanticDependency: VersionDependencyRef;
}> {
  const snapshotRoot = await objectRecord('workbook.snapshotRoot.v1', {
    label: `${mode}-snapshot`,
    sheets: [],
  });
  const semanticChangeSet = await objectRecord('workbook.semanticChangeSet.v1', {
    label: `${mode}-semantic`,
    changes: [],
  });
  const semanticDependency: VersionDependencyRef = {
    kind: 'object',
    objectType: 'workbook.semanticChangeSet.v1',
    digest: semanticChangeSet.digest,
  };
  const payload = {
    schemaVersion: 1,
    documentId: NAMESPACE.documentId,
    parentCommitIds: [],
    snapshotRootDigest: snapshotRoot.digest,
    semanticChangeSetDigest: semanticChangeSet.digest,
    author: AUTHOR,
    createdAt: '2026-06-20T00:00:00.000Z',
    completenessDiagnostics: [],
  };
  const commitRecord = await createVersionObjectRecord(NAMESPACE, {
    objectType: 'workbook.commit.v1',
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [
      semanticDependency,
      {
        kind: 'object',
        objectType: 'workbook.snapshotRoot.v1',
        digest: snapshotRoot.digest,
      },
    ],
    payload,
  });

  expect(await objectStore.putObjects([snapshotRoot])).toMatchObject({ status: 'success' });
  if (mode === 'corrupt') {
    const corruptSemantic = await objectRecord('workbook.semanticChangeSet.v1', {
      label: 'corrupt-semantic',
      changes: ['digest-mismatch'],
    });
    backend.putCorruptRecordForTesting(NAMESPACE, semanticChangeSet.digest, {
      ...corruptSemantic,
      digest: semanticChangeSet.digest,
    });
  }
  backend.putCorruptRecordForTesting(NAMESPACE, commitRecord.digest, commitRecord);

  return {
    commitId: workbookCommitIdFromObjectDigest(commitRecord.digest),
    semanticDependency,
  };
}

export function initializeMainAt(refStore: InMemoryRefStore, commitId: WorkbookCommitId): void {
  expect(refStore.initializeMain({ targetCommitId: commitId, createdBy: AUTHOR })).toMatchObject({
    ok: true,
  });
}
