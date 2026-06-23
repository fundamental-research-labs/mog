import { registerApplyMergeValidationInputTests } from './version-apply-merge-validation-scenarios-input';
import { registerApplyMergeValidationPersistedResultTests } from './version-apply-merge-validation-scenarios-persisted-result';
import { registerApplyMergeValidationTargetOptionsTests } from './version-apply-merge-validation-scenarios-target-options';

export function registerApplyMergeValidationTests(): void {
  registerApplyMergeValidationTargetOptionsTests();
  registerApplyMergeValidationInputTests();
  registerApplyMergeValidationPersistedResultTests();
}
