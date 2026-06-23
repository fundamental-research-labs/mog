import { registerRefStoreTombstoneConflictScenarios } from './ref-store-tombstones-lifecycle-conflict-scenarios';
import { registerRefStoreTombstoneReuseScenarios } from './ref-store-tombstones-lifecycle-reuse-scenarios';

export const registerRefStoreTombstoneLifecycleScenarios = (): void => {
  registerRefStoreTombstoneConflictScenarios();
  registerRefStoreTombstoneReuseScenarios();
};
