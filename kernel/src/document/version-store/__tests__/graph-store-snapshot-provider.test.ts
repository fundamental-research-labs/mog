import 'fake-indexeddb/auto';

import { registerGraphStoreSnapshotProviderPersistenceScenarios } from './graph-store-snapshot-provider-persistence-scenarios';
import { registerGraphStoreSnapshotProviderReloadFailureScenarios } from './graph-store-snapshot-provider-reload-failure-scenarios';
import { installGraphStoreSnapshotProviderIndexedDbCleanup } from './graph-store-snapshot-provider-test-utils';

installGraphStoreSnapshotProviderIndexedDbCleanup();

describe('IndexedDB graph snapshot reload invariants', () => {
  registerGraphStoreSnapshotProviderPersistenceScenarios();
  registerGraphStoreSnapshotProviderReloadFailureScenarios();
});
