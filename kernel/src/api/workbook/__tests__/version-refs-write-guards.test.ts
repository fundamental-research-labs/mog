import { describe } from '@jest/globals';

import { registerWriteGuardBranchPolicyScenarios } from './version-refs-write-guards-branch-policy-scenarios';
import { registerWriteGuardRefShapeScenarios } from './version-refs-write-guards-ref-shape-scenarios';
import { registerWriteGuardRevisionScenarios } from './version-refs-write-guards-revision-scenarios';

describe('WorkbookVersion public ref write guards', () => {
  registerWriteGuardBranchPolicyScenarios();
  registerWriteGuardRefShapeScenarios();
  registerWriteGuardRevisionScenarios();
});
