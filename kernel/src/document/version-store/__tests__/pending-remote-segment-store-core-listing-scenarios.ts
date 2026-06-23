import { createInMemoryVersionStoreProvider } from '../provider';
import {
  DOCUMENT_SCOPE,
  initializeProvider,
  pendingSegmentFixture,
} from './pending-remote-segment-store-fixtures';

export function registerPendingRemoteSegmentStoreCoreListingScenarios(): void {
  it('lists pending remote segments deterministically by reservation identity', async () => {
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      durability: 'memory',
    });
    const namespace = await initializeProvider(provider);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const later = await pendingSegmentFixture(namespace, {
      createdAt: '2026-06-21T00:00:02.000Z',
      payloadHash: '5'.repeat(64),
      updateId: 'remote-update-2',
    });
    const earlier = await pendingSegmentFixture(namespace, {
      createdAt: '2026-06-21T00:00:01.000Z',
      payloadHash: '6'.repeat(64),
      updateId: 'remote-update-3',
    });

    await expect(store.reserveSegment(later.input)).resolves.toMatchObject({ status: 'created' });
    await expect(store.reserveSegment(earlier.input)).resolves.toMatchObject({
      status: 'created',
    });

    const listed = await store.listByState('pending');
    expect(listed.status).toBe('success');
    if (listed.status !== 'success') throw new Error('expected pending segment list success');
    expect(listed.records.map((record) => record.pendingRemoteSegmentId)).toEqual([
      earlier.input.pendingRemoteSegmentId,
      later.input.pendingRemoteSegmentId,
    ]);
  });
}
