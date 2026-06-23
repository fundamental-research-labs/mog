import { describe } from '@jest/globals';

import { describePersistedAlreadyMergedMaterializerScenarios } from './version-apply-merge-materializer-persisted-already-merged-scenarios';
import { describePersistedFastForwardMaterializerScenarios } from './version-apply-merge-materializer-persisted-fast-forward-scenarios';
import { describePersistedStaleFastForwardMaterializerScenarios } from './version-apply-merge-materializer-persisted-stale-fast-forward-scenarios';

describe('WorkbookVersion applyMerge production materializer persisted results', () => {
  describePersistedFastForwardMaterializerScenarios();
  describePersistedAlreadyMergedMaterializerScenarios();
  describePersistedStaleFastForwardMaterializerScenarios();
});
