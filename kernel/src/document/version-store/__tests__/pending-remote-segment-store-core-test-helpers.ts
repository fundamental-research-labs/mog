import { deleteVersionStoreIndexedDbForTesting } from '../provider-indexeddb-schema';

export function installPendingRemoteSegmentStoreCoreCleanup(): void {
  beforeEach(async () => {
    await deleteVersionStoreIndexedDbForTesting();
  });

  afterEach(async () => {
    await deleteVersionStoreIndexedDbForTesting();
  });
}
