import { appendReviewDecisionAssertions } from './review-record-store-memory-decision-scenarios';
import { createReviewWithIdempotencyAssertions } from './review-record-store-memory-create-scenarios';
import { createReviewRecordStoreMemoryHarness } from './review-record-store-memory-helpers';
import { assertReviewListingAndPaging } from './review-record-store-memory-listing-scenarios';
import { assertReviewSnapshotReloadAndDocumentIsolation } from './review-record-store-memory-snapshot-scenarios';
import { updateReviewStatusAssertions } from './review-record-store-memory-status-scenarios';

export function registerReviewRecordStoreMemoryTests(): void {
  it('persists in-memory review records with idempotent mutations, CAS, paging, and snapshots', async () => {
    const harness = await createReviewRecordStoreMemoryHarness();
    const reviewId = await createReviewWithIdempotencyAssertions(harness.store);

    await appendReviewDecisionAssertions(harness.store, reviewId);
    await updateReviewStatusAssertions(harness.store, reviewId);
    await assertReviewListingAndPaging(harness.store, reviewId);
    await assertReviewSnapshotReloadAndDocumentIsolation(harness.backend, reviewId);
  });
}
