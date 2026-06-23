import 'fake-indexeddb/auto';

import { deleteVersionStoreIndexedDbForTesting } from '../provider-indexeddb-schema';
import { registerLifecycleCoreRootInitializationScenarios } from './lifecycle-core-root-initialization-scenarios';

beforeEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

afterEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

registerLifecycleCoreRootInitializationScenarios();
