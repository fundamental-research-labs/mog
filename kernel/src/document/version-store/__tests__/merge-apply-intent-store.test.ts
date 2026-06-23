import 'fake-indexeddb/auto';

import { deleteVersionStoreIndexedDbForTesting } from '../provider-indexeddb-schema';
import { registerMergeApplyIntentStoreDigestTests } from './merge-apply-intent-store-digest-scenarios';
import { registerMergeApplyIntentStoreIndexedDbTests } from './merge-apply-intent-store-indexeddb-scenarios';
import { registerMergeApplyIntentStoreMemoryTests } from './merge-apply-intent-store-memory-scenarios';

beforeEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

afterEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

describe('merge apply intent store', () => {
  registerMergeApplyIntentStoreDigestTests();
  registerMergeApplyIntentStoreMemoryTests();
  registerMergeApplyIntentStoreIndexedDbTests();
});
