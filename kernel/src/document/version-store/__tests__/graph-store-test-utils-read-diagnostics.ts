import { workbookCommitIdFromObjectDigest, type WorkbookCommitId } from '../object-digest';
import {
  createVersionObjectRecord,
  type InMemoryVersionObjectStore,
  type VersionObjectMemoryBackend,
  type VersionObjectRecord,
} from '../object-store';
import { AUTHOR, NAMESPACE } from './graph-store-test-utils-constants';
import { objectRecord } from './graph-store-test-utils-object-records';

export async function persistRootCommitForReadDiagnostics(
  backend: VersionObjectMemoryBackend,
  objectStore: InMemoryVersionObjectStore,
  label: string,
): Promise<{
  readonly commitId: WorkbookCommitId;
  readonly semanticChangeSet: VersionObjectRecord<unknown>;
}> {
  const snapshotRoot = await objectRecord('workbook.snapshotRoot.v1', { label, sheets: [] });
  const semanticChangeSet = await objectRecord('workbook.semanticChangeSet.v1', {
    label,
    changes: [],
  });
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
      {
        kind: 'object',
        objectType: 'workbook.semanticChangeSet.v1',
        digest: semanticChangeSet.digest,
      },
      {
        kind: 'object',
        objectType: 'workbook.snapshotRoot.v1',
        digest: snapshotRoot.digest,
      },
    ],
    payload,
  });
  expect(await objectStore.putObjects([snapshotRoot])).toMatchObject({ status: 'success' });
  backend.putCorruptRecordForTesting(NAMESPACE, commitRecord.digest, commitRecord);
  return {
    commitId: workbookCommitIdFromObjectDigest(commitRecord.digest),
    semanticChangeSet,
  };
}
