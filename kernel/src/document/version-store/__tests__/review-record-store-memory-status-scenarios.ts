import type { WorkbookVersionReviewRecordStore } from '../review-service-record-store';
import { updateStatusInput } from './review-record-store-test-helpers';

export async function updateReviewStatusAssertions(
  store: WorkbookVersionReviewRecordStore,
  reviewId: string,
): Promise<void> {
  const statusInput = updateStatusInput(reviewId, 2, 'status-1');
  const statusUpdated = await store.updateReviewStatus(statusInput);
  expect(statusUpdated).toMatchObject({
    ok: true,
    value: { revision: 3, status: 'changes_requested' },
  });
  await expect(store.updateReviewStatus(statusInput)).resolves.toEqual(statusUpdated);
  await expect(
    store.updateReviewStatus({
      ...updateStatusInput(reviewId, 3, 'status-2'),
      status: 'approved',
    }),
  ).resolves.toMatchObject({
    ok: false,
    error: { code: 'invalid_state', state: 'approval_requires_review_diff' },
  });
  for (const status of ['applied', 'superseded', 'stale'] as const) {
    await expect(
      store.updateReviewStatus({
        ...updateStatusInput(reviewId, 3, `status-flow-owned-${status}`),
        status,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'flow_owned_review_status' },
    });
  }
}
