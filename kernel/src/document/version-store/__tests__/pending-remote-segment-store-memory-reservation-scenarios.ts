import { reservePersistedPendingRemoteSegment } from '../pending-remote-segment-store';
import {
  expectGraphHeadUnchanged,
  expectPersistedPendingObjects,
  objectRecord,
  syncOperationContext,
} from './pending-remote-segment-store-fixtures';
import type { PendingRemoteSegmentMemoryHarness } from './pending-remote-segment-store-memory-harness';

export async function reservePendingRemoteSegmentWithIdempotencyAndConflictAssertions(
  harness: PendingRemoteSegmentMemoryHarness,
): Promise<void> {
  const { graph, headBefore, input, namespace, store } = harness;

  await expect(graph.putObjects(harness.fixture.objectRecords)).resolves.toMatchObject({
    status: 'success',
  });
  await expectGraphHeadUnchanged(graph, headBefore);
  await expectPersistedPendingObjects(graph, input);

  const created = await reservePersistedPendingRemoteSegment({ graph, store, input });
  expect(created.status).toBe('created');
  if (created.status !== 'created') throw new Error('expected pending segment creation');
  await expectGraphHeadUnchanged(graph, headBefore);
  await expect(store.listByState('pending')).resolves.toMatchObject({
    status: 'success',
    records: [{ pendingRemoteSegmentId: input.pendingRemoteSegmentId }],
  });

  await expect(
    reservePersistedPendingRemoteSegment({
      graph,
      store,
      input: {
        ...input,
        createdAt: '2026-06-21T00:00:02.000Z',
        operationContext: syncOperationContext({ createdAt: '2026-06-21T00:00:02.000Z' }),
      },
    }),
  ).resolves.toMatchObject({
    status: 'existing',
    record: { pendingRemoteSegmentId: input.pendingRemoteSegmentId },
  });
  await expect(store.readBySegmentId(input.pendingRemoteSegmentId)).resolves.toMatchObject({
    status: 'found',
    record: { idempotencyKey: input.idempotencyKey },
  });
  await expect(store.readByIdempotencyKey(input.idempotencyKey)).resolves.toMatchObject({
    status: 'found',
    record: { pendingRemoteSegmentId: input.pendingRemoteSegmentId },
  });

  const changedIdentity = await store.reserveSegment({
    ...input,
    operationContext: syncOperationContext({ updateId: 'remote-update-2' }),
  });
  expect(changedIdentity).toMatchObject({
    status: 'failed',
    diagnostics: [{ code: 'VERSION_INVALID_OPTIONS' }],
  });

  const changedMutationSegmentRecord = await objectRecord(
    'workbook.mutationSegment.v1',
    { segmentId: 'remote-segment-2' },
    namespace,
  );
  await expect(graph.putObjects([changedMutationSegmentRecord])).resolves.toMatchObject({
    status: 'success',
  });
  const changedPayload = await store.reserveSegment({
    ...input,
    mutationSegmentDigest: changedMutationSegmentRecord.digest,
  });
  expect(changedPayload).toMatchObject({
    status: 'conflict',
    diagnostics: [{ code: 'VERSION_PENDING_REMOTE_CONFLICT' }],
  });
}
