import { registerCommitServiceNormalCaptureFailureScenarios } from './commit-service-normal-capture-failure-scenarios';
import { registerCommitServiceOptionValidationScenarios } from './commit-service-option-validation-scenarios';
import { registerCommitServiceTargetRefScenarios } from './commit-service-target-ref-scenarios';

describe('WorkbookVersionCommitService', () => {
  registerCommitServiceTargetRefScenarios();
  registerCommitServiceOptionValidationScenarios();
  registerCommitServiceNormalCaptureFailureScenarios();
});
