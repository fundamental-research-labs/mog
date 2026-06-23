import 'fake-indexeddb/auto';

import { deleteVersionStoreIndexedDbForTesting } from '../provider-indexeddb-schema';
import { registerReviewRecordStoreIndexedDbTests } from './review-record-store-indexeddb-scenarios';
import { registerReviewRecordStoreMemoryTests } from './review-record-store-memory-scenarios';

beforeEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

afterEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

describe('WorkbookVersionReviewRecordStore', () => {
  registerReviewRecordStoreMemoryTests();
  registerReviewRecordStoreIndexedDbTests();
});
