import type { ReadWorkbookCommitResult } from '../commit-store';
import type { WorkbookCommitId } from '../object-digest';
import type { VersionGraphNamespace, VersionObjectRecord } from '../object-store';
import type { RefRecord } from '../refs/ref-store';
import type { InMemoryRefStoreSnapshot } from '../refs/ref-store-snapshot';

export type InMemoryVersionGraphStoreSnapshot = {
  readonly namespace: VersionGraphNamespace;
  readonly objectRecords: readonly VersionObjectRecord<unknown>[];
  readonly refStore: InMemoryRefStoreSnapshot;
};

export function assertRefStoreSnapshotManifestInvariants(
  snapshot: InMemoryRefStoreSnapshot,
  documentId: string,
): void {
  if (
    typeof snapshot.nextGeneratedId !== 'number' ||
    !Number.isSafeInteger(snapshot.nextGeneratedId) ||
    snapshot.nextGeneratedId < 0
  ) {
    throw new Error('Version graph ref snapshot has an invalid generated id manifest.');
  }

  const seenRefNames = new Set<string>();
  for (const record of snapshot.records) {
    if (seenRefNames.has(record.name)) {
      throw new Error('Version graph ref snapshot contains duplicate ref records.');
    }
    seenRefNames.add(record.name);
  }

  const liveRefCount = snapshot.records.filter((record) => record.state === 'live').length;
  if (snapshot.liveRefCount !== undefined && snapshot.liveRefCount !== liveRefCount) {
    throw new Error('Version graph ref snapshot live ref count manifest is stale.');
  }

  const maxGeneratedId = maxGeneratedRefRecordId(snapshot.records, documentId);
  if (snapshot.nextGeneratedId < maxGeneratedId) {
    throw new Error('Version graph ref snapshot generated id manifest is stale.');
  }
}

export async function assertSnapshotRefTargetsReadable(
  records: readonly RefRecord[],
  readCommit: (commitId: WorkbookCommitId) => Promise<ReadWorkbookCommitResult>,
): Promise<void> {
  for (const record of records) {
    const commitId =
      record.state === 'live' ? record.targetCommitId : record.previousTargetCommitId;
    const read = await readCommit(commitId);
    if (read.status !== 'success') {
      throw new Error('Version graph ref snapshot references an unreadable commit object.');
    }
  }
}

export function maxGeneratedRefRecordId(records: readonly RefRecord[], documentId: string): number {
  let max = 0;
  for (const record of records) {
    if (record.state === 'live') {
      max = Math.max(
        max,
        generatedRefIdValue(record.providerRefId, 'provider-ref', documentId),
        generatedRefIdValue(record.refIncarnationId, 'ref-incarnation', documentId),
      );
    } else {
      max = Math.max(
        max,
        generatedRefIdValue(record.previousProviderRefId, 'provider-ref', documentId),
        generatedRefIdValue(record.previousRefIncarnationId, 'ref-incarnation', documentId),
      );
    }
  }
  return max;
}

function generatedRefIdValue(value: string, prefix: string, documentId: string): number {
  const expectedPrefix = `${prefix}:${documentId}:`;
  if (!value.startsWith(expectedPrefix)) return 0;

  const suffix = value.slice(expectedPrefix.length);
  if (!/^(0|[1-9][0-9]*)$/.test(suffix)) return 0;

  const parsed = Number(suffix);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}
