import { describe } from '@jest/globals';

import { describeApplyMergeAlreadyMergedAncestryScenarios } from './version-apply-merge-ancestry-already-merged-scenarios';
import { describeApplyMergeFastForwardApplyAncestryScenarios } from './version-apply-merge-ancestry-fast-forward-apply-scenarios';
import { describeApplyMergeFastForwardPreviewAncestryScenarios } from './version-apply-merge-ancestry-fast-forward-preview-scenarios';

describe('WorkbookVersion applyMerge ancestry fast paths', () => {
  describeApplyMergeFastForwardApplyAncestryScenarios();
  describeApplyMergeFastForwardPreviewAncestryScenarios();
  describeApplyMergeAlreadyMergedAncestryScenarios();
});
