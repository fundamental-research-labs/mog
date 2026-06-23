import { PROMOTED_COMMIT } from './pending-remote-segment-store-fixtures';
import type { PendingRemoteSegmentMemoryHarness } from './pending-remote-segment-store-memory-harness';

export async function completePendingRemoteSegmentWithIdempotencyAssertions(
  harness: PendingRemoteSegmentMemoryHarness,
): Promise<void> {
  const { input, store } = harness;

  const completed = await store.completeSegment({
    pendingRemoteSegmentId: input.pendingRemoteSegmentId,
    mutationSegmentDigest: input.mutationSegmentDigest,
    completedAt: '2026-06-21T00:00:03.000Z',
    terminal: { status: 'promoted', commitId: PROMOTED_COMMIT },
  });
  expect(completed).toMatchObject({
    status: 'completed',
    record: { state: 'promoted', terminal: { status: 'promoted' } },
  });
  await expect(store.listByState('pending')).resolves.toMatchObject({
    status: 'success',
    records: [],
  });
  await expect(store.listByState('promoted')).resolves.toMatchObject({
    status: 'success',
    records: [{ pendingRemoteSegmentId: input.pendingRemoteSegmentId }],
  });
  await expect(
    store.completeSegment({
      pendingRemoteSegmentId: input.pendingRemoteSegmentId,
      mutationSegmentDigest: input.mutationSegmentDigest,
      completedAt: '2026-06-21T00:00:04.000Z',
      terminal: { status: 'promoted', commitId: PROMOTED_COMMIT },
    }),
  ).resolves.toMatchObject({
    status: 'completed',
    record: {
      state: 'promoted',
      updatedAt: '2026-06-21T00:00:03.000Z',
    },
  });
  await expect(
    store.completeSegment({
      pendingRemoteSegmentId: input.pendingRemoteSegmentId,
      mutationSegmentDigest: input.mutationSegmentDigest,
      completedAt: '2026-06-21T00:00:05.000Z',
      terminal: { status: 'dropped', reason: 'duplicate' },
    }),
  ).resolves.toMatchObject({
    status: 'conflict',
    diagnostics: [{ code: 'VERSION_PENDING_REMOTE_CONFLICT' }],
  });
}
