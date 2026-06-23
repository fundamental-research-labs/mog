import type { WorkbookVersionReviewRecordStore } from '../review-service-record-store';
import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
} from '../provider';
import { DOCUMENT_SCOPE } from './review-record-store-test-helpers';

export type ReviewRecordStoreMemoryHarness = {
  readonly backend: InMemoryVersionDocumentProviderBackend;
  readonly store: WorkbookVersionReviewRecordStore;
};

export async function createReviewRecordStoreMemoryHarness(): Promise<ReviewRecordStoreMemoryHarness> {
  const backend = new InMemoryVersionDocumentProviderBackend();
  const provider = createInMemoryVersionStoreProvider({
    documentScope: DOCUMENT_SCOPE,
    backend,
    durability: 'snapshot-test-double',
  });
  const store = await provider.openWorkbookVersionReviewRecordStore();

  return { backend, store };
}
