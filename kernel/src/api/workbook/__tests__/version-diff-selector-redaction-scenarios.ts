import { registerSelectorRedactionCellCoordinateScenarios } from './version-diff-selector-redaction-cell-coordinate-scenarios';
import { registerSelectorRedactionCompletenessDiagnosticScenarios } from './version-diff-selector-redaction-completeness-diagnostic-scenarios';
import { registerSelectorRedactionDiffEntryScenarios } from './version-diff-selector-redaction-diff-entry-scenarios';

export function registerSelectorRedactionScenarios(): void {
  registerSelectorRedactionCompletenessDiagnosticScenarios();
  registerSelectorRedactionDiffEntryScenarios();
  registerSelectorRedactionCellCoordinateScenarios();
}
