import { describe } from '@jest/globals';

import { registerPublicBranchRefLifecycleScenario } from './version-refs-core-branch-lifecycle-scenario';
import { registerPublicRefListFilterScenario } from './version-refs-core-list-filter-scenario';
import { registerPublicRefSymbolicHeadScenario } from './version-refs-core-symbolic-head-scenario';
import { registerPublicRefUnavailableScenarios } from './version-refs-core-unavailable-scenarios';

describe('WorkbookVersion public ref lifecycle facade', () => {
  registerPublicRefUnavailableScenarios();
  registerPublicBranchRefLifecycleScenario();
  registerPublicRefSymbolicHeadScenario();
  registerPublicRefListFilterScenario();
});
