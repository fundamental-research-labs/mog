import { registerIndexedDbBranchLifecycleCreateRaceScenarios } from './provider-indexeddb-branch-lifecycle-create-race-scenarios';
import { registerIndexedDbBranchLifecycleDeleteDurabilityScenarios } from './provider-indexeddb-branch-lifecycle-delete-durability-scenarios';
import { registerIndexedDbBranchLifecycleDeleteRollbackScenarios } from './provider-indexeddb-branch-lifecycle-delete-rollback-scenarios';
import { registerIndexedDbBranchLifecycleFastForwardRollbackScenarios } from './provider-indexeddb-branch-lifecycle-fast-forward-rollback-scenarios';
import { installIndexedDbBranchLifecycleCleanup } from './provider-indexeddb-branch-lifecycle-test-utils';

installIndexedDbBranchLifecycleCleanup();

describe('IndexedDB provider-backed branch lifecycle CAS', () => {
  registerIndexedDbBranchLifecycleDeleteDurabilityScenarios();
  registerIndexedDbBranchLifecycleCreateRaceScenarios();
  registerIndexedDbBranchLifecycleFastForwardRollbackScenarios();
  registerIndexedDbBranchLifecycleDeleteRollbackScenarios();
});
