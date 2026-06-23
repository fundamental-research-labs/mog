import 'fake-indexeddb/auto';

import { registerFastForwardRecoveryScenario } from './version-indexeddb-persisted-apply-recovery-fast-forward-scenario';
import { registerMergeCommitRecoveryScenario } from './version-indexeddb-persisted-apply-recovery-merge-commit-scenario';
import { installIndexedDbPersistedApplyTestLifecycle } from './version-indexeddb-persisted-apply-recovery-test-utils';

installIndexedDbPersistedApplyTestLifecycle();

describe('WorkbookVersion IndexedDB persisted applyMerge recovery', () => {
  registerMergeCommitRecoveryScenario();
  registerFastForwardRecoveryScenario();
});
