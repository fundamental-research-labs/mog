import { createIndexedDbVersionStoreProvider } from '../provider-indexeddb/backend';
import {
  DOCUMENT_SCOPE,
  appendDecisionInput,
  createReviewInput,
} from './review-record-store-test-helpers';

export function registerReviewRecordStoreIndexedDbTests(): void {
  it('persists IndexedDB review records across provider reloads', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const store = await provider.openWorkbookVersionReviewRecordStore();
    const created = await store.createReview(createReviewInput('indexed-create-1'));
    if (!created.ok) throw new Error(`expected create success: ${created.error.code}`);
    const reviewId = created.value.id;

    await expect(
      store.appendReviewDecision(appendDecisionInput(reviewId, 1, 'indexed-decision-1')),
    ).resolves.toMatchObject({ ok: true, value: { revision: 2 } });

    const reloadedProvider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const reloadedStore = await reloadedProvider.openWorkbookVersionReviewRecordStore();
    await expect(reloadedStore.getReview({ reviewId })).resolves.toMatchObject({
      ok: true,
      value: { id: reviewId, revision: 2, decisions: [{ decision: 'comment' }] },
    });
    await expect(
      reloadedStore.createReview(createReviewInput('indexed-create-1')),
    ).resolves.toMatchObject({
      ok: true,
      value: { id: reviewId, revision: 1 },
    });
    await expect(
      reloadedStore.appendReviewDecision(appendDecisionInput(reviewId, 1, 'indexed-decision-1')),
    ).resolves.toMatchObject({
      ok: true,
      value: { revision: 2 },
    });
  });
}
