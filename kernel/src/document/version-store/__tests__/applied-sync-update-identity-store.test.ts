import 'fake-indexeddb/auto';

import { registerAppliedSyncUpdateIdentityStoreIdentityScenarios } from './applied-sync-update-identity-store-identity-scenarios';
import { registerAppliedSyncUpdateIdentityStoreIndexedDbScenarios } from './applied-sync-update-identity-store-indexeddb-scenarios';
import { registerAppliedSyncUpdateIdentityStoreMemoryScenarios } from './applied-sync-update-identity-store-memory-scenarios';
import { registerAppliedSyncUpdateIdentityStoreTerminalScenarios } from './applied-sync-update-identity-store-terminal-scenarios';
import { installAppliedSyncUpdateIdentityStoreIndexedDbCleanup } from './applied-sync-update-identity-store-test-helpers';

installAppliedSyncUpdateIdentityStoreIndexedDbCleanup();

describe('applied sync update identity store', () => {
  registerAppliedSyncUpdateIdentityStoreIdentityScenarios();
  registerAppliedSyncUpdateIdentityStoreMemoryScenarios();
  registerAppliedSyncUpdateIdentityStoreIndexedDbScenarios();
  registerAppliedSyncUpdateIdentityStoreTerminalScenarios();
});
