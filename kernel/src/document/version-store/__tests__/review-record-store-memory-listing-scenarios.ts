import type { WorkbookVersionReviewRecordStore } from '../review-service-record-store';
import {
  HEAD_COMMIT_ID,
  OTHER_COMMIT_ID,
  createReviewInput,
} from './review-record-store-test-helpers';

export async function assertReviewListingAndPaging(
  store: WorkbookVersionReviewRecordStore,
  reviewId: string,
): Promise<void> {
  await expect(store.getReview({ reviewId })).resolves.toMatchObject({
    ok: true,
    value: { revision: 3, status: 'changes_requested' },
  });
  await expect(
    store.listReviews({ status: 'changes_requested', commitId: HEAD_COMMIT_ID }),
  ).resolves.toMatchObject({
    ok: true,
    value: { items: [{ id: reviewId }], limit: 50, totalEstimate: 1 },
  });

  const second = await store.createReview(
    createReviewInput('create-2', {
      kind: 'commit',
      commitId: OTHER_COMMIT_ID,
    }),
  );
  expect(second.ok).toBe(true);
  const firstPage = await store.listReviews({ limit: 1 });
  expect(firstPage).toMatchObject({ ok: true, value: { items: [expect.any(Object)], limit: 1 } });
  if (!firstPage.ok || !firstPage.value.nextCursor) {
    throw new Error('expected review list cursor');
  }
  await expect(
    store.listReviews({ limit: 1, cursor: firstPage.value.nextCursor }),
  ).resolves.toMatchObject({
    ok: true,
    value: { items: [expect.any(Object)], limit: 1 },
  });
}
