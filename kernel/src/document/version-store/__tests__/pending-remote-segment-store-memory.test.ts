import 'fake-indexeddb/auto';

import { deleteVersionStoreIndexedDbForTesting } from '../provider-indexeddb-schema';
import { registerPendingRemoteSegmentStoreMemoryPersistenceScenarios } from './pending-remote-segment-store-memory-scenarios';

beforeEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

afterEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

describe('pending remote segment store in-memory persistence', () => {
  registerPendingRemoteSegmentStoreMemoryPersistenceScenarios();
});
