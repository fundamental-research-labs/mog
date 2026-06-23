import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
} from '../provider';
import { DOCUMENT_SCOPE, OTHER_DOCUMENT_SCOPE } from './review-record-store-test-helpers';

export async function assertReviewSnapshotReloadAndDocumentIsolation(
  backend: InMemoryVersionDocumentProviderBackend,
  reviewId: string,
): Promise<void> {
  const snapshot = await backend.exportSnapshot();
  const reloadedBackend = await InMemoryVersionDocumentProviderBackend.fromSnapshot(snapshot);
  const reloadedProvider = createInMemoryVersionStoreProvider({
    documentScope: DOCUMENT_SCOPE,
    backend: reloadedBackend,
    durability: 'snapshot-test-double',
  });
  await expect(
    (await reloadedProvider.openWorkbookVersionReviewRecordStore()).getReview({ reviewId }),
  ).resolves.toMatchObject({
    ok: true,
    value: { revision: 3, status: 'changes_requested' },
  });

  const isolatedProvider = createInMemoryVersionStoreProvider({
    documentScope: OTHER_DOCUMENT_SCOPE,
    backend: reloadedBackend,
  });
  await expect(
    (await isolatedProvider.openWorkbookVersionReviewRecordStore()).listReviews({}),
  ).resolves.toMatchObject({
    ok: true,
    value: { items: [], totalEstimate: 0 },
  });
}
