import 'fake-indexeddb/auto';

import { describe } from '@jest/globals';

import { describeIndexedDbPersistedApplyCleanMergeScenarios } from './version-indexeddb-persisted-apply-clean-merge-scenarios';
import { describeIndexedDbPersistedApplyFastForwardScenarios } from './version-indexeddb-persisted-apply-fast-forward-scenarios';
import { installIndexedDbPersistedApplyTestLifecycle } from './version-indexeddb-persisted-apply-test-helpers';

installIndexedDbPersistedApplyTestLifecycle();

describe('WorkbookVersion IndexedDB persisted applyMerge lifecycle', () => {
  describeIndexedDbPersistedApplyCleanMergeScenarios();
  describeIndexedDbPersistedApplyFastForwardScenarios();
});
