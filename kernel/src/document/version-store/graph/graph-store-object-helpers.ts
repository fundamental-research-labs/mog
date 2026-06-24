import {
  createInMemoryWorkbookCommitStore,
  type InMemoryWorkbookCommitStore,
  type ReadWorkbookCommitResult,
} from '../commit-store';
import type { WorkbookCommitId } from '../object-digest';
import {
  createInMemoryVersionObjectStore,
  normalizeVersionGraphNamespace,
  type InMemoryVersionObjectStore,
  type VersionGraphNamespace,
} from '../object-store';
import {
  assertRefStoreSnapshotManifestInvariants,
  assertSnapshotRefTargetsReadable,
  type InMemoryVersionGraphStoreSnapshot,
} from './graph-store-snapshot';
import { createInMemoryRefStore, type InMemoryRefStore } from '../refs/ref-store';

export type InMemoryVersionGraphStoreParts = {
  readonly namespace: VersionGraphNamespace;
  readonly objectStore: InMemoryVersionObjectStore;
  readonly commitStore: InMemoryWorkbookCommitStore;
  readonly refStore: InMemoryRefStore;
};

export async function exportInMemoryVersionGraphStoreSnapshot(input: {
  readonly namespace: VersionGraphNamespace;
  readonly objectStore: InMemoryVersionObjectStore;
  readonly refStore: InMemoryRefStore;
  readonly readCommit: (commitId: WorkbookCommitId) => Promise<ReadWorkbookCommitResult>;
}): Promise<InMemoryVersionGraphStoreSnapshot> {
  const refStore = input.refStore.exportSnapshot();
  assertRefStoreSnapshotManifestInvariants(refStore, input.namespace.documentId);
  await assertSnapshotRefTargetsReadable(refStore.records, input.readCommit);

  return Object.freeze({
    namespace: input.namespace,
    objectRecords: input.objectStore.listObjectRecords(),
    refStore,
  });
}

export async function createInMemoryVersionGraphStorePartsFromSnapshot(
  snapshot: InMemoryVersionGraphStoreSnapshot,
): Promise<InMemoryVersionGraphStoreParts> {
  const namespace = normalizeVersionGraphNamespace(snapshot.namespace);
  assertRefStoreSnapshotManifestInvariants(snapshot.refStore, namespace.documentId);

  const objectStore = createInMemoryVersionObjectStore(namespace);
  const putResult = await objectStore.putObjects(snapshot.objectRecords);
  if (putResult.status !== 'success') {
    throw new Error('Version graph object snapshot failed validation.');
  }

  const commitStore = createInMemoryWorkbookCommitStore(objectStore);
  const refStore = createInMemoryRefStore({
    versionDocumentId: namespace.documentId,
    snapshot: snapshot.refStore,
  });
  await assertSnapshotRefTargetsReadable(snapshot.refStore.records, (commitId) =>
    commitStore.readCommit(commitId),
  );

  return {
    namespace,
    objectStore,
    commitStore,
    refStore,
  };
}
