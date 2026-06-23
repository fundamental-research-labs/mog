import { describe } from '@jest/globals';

import { describeCleanMaterializerMergeScenario } from './version-apply-merge-materializer-clean-scenario';
import { describeResolvedConflictMaterializerMergeScenario } from './version-apply-merge-materializer-resolved-conflict-scenario';

describe('WorkbookVersion applyMerge production materializer', () => {
  describeCleanMaterializerMergeScenario();
  describeResolvedConflictMaterializerMergeScenario();
});
