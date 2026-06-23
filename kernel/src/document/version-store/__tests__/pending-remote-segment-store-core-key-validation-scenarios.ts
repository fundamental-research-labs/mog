import type {
  PendingRemoteSegmentId,
  PendingRemoteSegmentIdempotencyKey,
} from '../pending-remote-segment-store';
import { createInMemoryVersionStoreProvider } from '../provider';
import {
  DOCUMENT_SCOPE,
  initializeProvider,
  pendingSegmentFixture,
} from './pending-remote-segment-store-fixtures';

export function registerPendingRemoteSegmentStoreCoreKeyValidationScenarios(): void {
  it('rejects pending remote reservations with mismatched durable key material', async () => {
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      durability: 'memory',
    });
    const namespace = await initializeProvider(provider);
    const store = await provider.openPendingRemoteSegmentStore(namespace);
    const fixture = await pendingSegmentFixture(namespace);
    const mismatchedIdempotencyKey =
      `pending-remote:sha256:${'9'.repeat(64)}` as PendingRemoteSegmentIdempotencyKey;
    const mismatchedSegmentId =
      `pending-remote-segment:sha256:${'8'.repeat(64)}` as PendingRemoteSegmentId;

    await expect(
      store.reserveSegment({
        ...fixture.input,
        idempotencyKey: mismatchedIdempotencyKey,
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      record: null,
      diagnostics: [{ code: 'VERSION_INVALID_OPTIONS' }],
    });
    await expect(store.readByIdempotencyKey(mismatchedIdempotencyKey)).resolves.toMatchObject({
      status: 'missing',
    });

    await expect(
      store.reserveSegment({
        ...fixture.input,
        pendingRemoteSegmentId: mismatchedSegmentId,
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      record: null,
      diagnostics: [{ code: 'VERSION_INVALID_OPTIONS' }],
    });
    await expect(store.readBySegmentId(mismatchedSegmentId)).resolves.toMatchObject({
      status: 'missing',
    });
  });
}
