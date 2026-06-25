import { describeSheetStructuralInvalidEvidenceScenarios } from './semantic-mutation-capture-sheets-structural-invalid-evidence-scenarios';
import { describeSheetStructuralLifecycleScenarios } from './semantic-mutation-capture-sheets-structural-lifecycle-scenarios';

export { describeSheetStructuralInvalidEvidenceScenarios } from './semantic-mutation-capture-sheets-structural-invalid-evidence-scenarios';
export { describeSheetStructuralLifecycleScenarios } from './semantic-mutation-capture-sheets-structural-lifecycle-scenarios';

export function describeSheetStructuralScenarios(): void {
  describeSheetStructuralLifecycleScenarios();
  describeSheetStructuralInvalidEvidenceScenarios();
}
