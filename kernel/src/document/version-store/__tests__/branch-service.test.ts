import { registerBranchCasTests } from './branch-service-cas-scenarios';
import { registerBranchDeleteTests } from './branch-service-delete-scenarios';
import { registerBranchHeadTests } from './branch-service-head-scenarios';
import { registerBranchLifecycleTests } from './branch-service-lifecycle-scenarios';
import { registerBranchPreconditionTests } from './branch-service-precondition-scenarios';
import { registerBranchValidationTests } from './branch-service-validation-scenarios';

describe('InMemoryBranchService branch lifecycle', () => {
  registerBranchLifecycleTests();
  registerBranchCasTests();
  registerBranchDeleteTests();
  registerBranchPreconditionTests();
  registerBranchValidationTests();
  registerBranchHeadTests();
});
