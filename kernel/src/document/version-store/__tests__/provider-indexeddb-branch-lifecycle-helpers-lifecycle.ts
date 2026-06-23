import type { VersionGraphNamespace } from '../object-store';
import { createIndexedDbGraphBranchLifecycle } from '../provider-indexeddb-branch-lifecycle';
import {
  deleteVersionStoreIndexedDbForTesting,
  openVersionStoreIndexedDb,
} from '../provider-indexeddb-schema';
import { DOCUMENT_SCOPE } from './provider-indexeddb-branch-lifecycle-helpers-context';

export function installIndexedDbBranchLifecycleCleanup(): void {
  beforeEach(async () => {
    await deleteVersionStoreIndexedDbForTesting();
  });

  afterEach(async () => {
    await deleteVersionStoreIndexedDbForTesting();
  });
}

export function lifecycleWithPersistRace(
  namespace: VersionGraphNamespace,
  race: () => Promise<void>,
) {
  let openCount = 0;
  return createIndexedDbGraphBranchLifecycle({
    namespace,
    documentScope: DOCUMENT_SCOPE,
    getDb: async () => {
      openCount += 1;
      if (openCount === 2) await race();
      return openVersionStoreIndexedDb();
    },
  });
}
