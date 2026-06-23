import { registerSemanticMutationCaptureDirectCellClearFormatScenarios } from './semantic-mutation-capture-formats-direct-cell-clear-scenarios';
import { registerSemanticMutationCaptureDirectCellSetFormatScenarios } from './semantic-mutation-capture-formats-direct-cell-set-scenarios';

export function registerSemanticMutationCaptureDirectCellFormatTests(): void {
  registerSemanticMutationCaptureDirectCellSetFormatScenarios();
  registerSemanticMutationCaptureDirectCellClearFormatScenarios();
}
