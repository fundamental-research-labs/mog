import { validatePendingRemoteSegmentObjects } from '../pending-remote-segment-store';
import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
} from '../provider';
import { DOCUMENT_SCOPE, PROMOTED_COMMIT } from './pending-remote-segment-store-fixtures';
import type { PendingRemoteSegmentMemoryHarness } from './pending-remote-segment-store-memory-harness';

export async function assertPendingRemoteSegmentMemorySnapshotReload(
  harness: PendingRemoteSegmentMemoryHarness,
): Promise<void> {
  const { backend, input, namespace } = harness;

  const snapshot = await backend.exportSnapshot();
  const reloadedBackend = await InMemoryVersionDocumentProviderBackend.fromSnapshot(snapshot);
  const reloadedProvider = createInMemoryVersionStoreProvider({
    documentScope: DOCUMENT_SCOPE,
    backend: reloadedBackend,
    durability: 'snapshot-test-double',
  });
  const reloadedGraph = await reloadedProvider.openGraph(namespace);
  const reloadedStore = await reloadedProvider.openPendingRemoteSegmentStore(namespace);
  const reloadedRead = await reloadedStore.readByIdempotencyKey(input.idempotencyKey);
  expect(reloadedRead).toMatchObject({
    status: 'found',
    record: { state: 'promoted', terminal: { commitId: PROMOTED_COMMIT } },
  });
  if (reloadedRead.status !== 'found') throw new Error('expected reloaded pending remote row');
  await expect(
    validatePendingRemoteSegmentObjects(reloadedGraph, reloadedRead.record),
  ).resolves.toEqual({
    status: 'success',
    diagnostics: [],
  });
}
