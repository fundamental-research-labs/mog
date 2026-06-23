import { describe } from '@jest/globals';

import { describeApplyMergeConflictApplyScenarios } from './version-apply-merge-conflicts-apply-scenarios';
import { describeApplyMergeConflictPreviewScenarios } from './version-apply-merge-conflicts-preview-scenarios';
import { describeApplyMergeConflictValidationScenarios } from './version-apply-merge-conflicts-validation-scenarios';

describe('WorkbookVersion applyMerge conflict resolution', () => {
  describeApplyMergeConflictPreviewScenarios();
  describeApplyMergeConflictApplyScenarios();
  describeApplyMergeConflictValidationScenarios();
});
