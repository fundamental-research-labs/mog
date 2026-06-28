import { registerVersionOperationContextFailClosedScenarios } from './version-operation-context-fail-closed-scenarios';
import { registerVersionOperationContextCellWriteFallbackScenarios } from './version-operation-context-cell-write-fallback-scenarios';
import { registerVersionOperationContextGroupedIdentityScenarios } from './version-operation-context-grouped-identity-scenarios';
import { registerVersionOperationContextSheetScenarios } from './version-operation-context-sheet-scenarios';
import { registerVersionOperationContextWorksheetScenarios } from './version-operation-context-worksheet-scenarios';

registerVersionOperationContextCellWriteFallbackScenarios();
registerVersionOperationContextWorksheetScenarios();
registerVersionOperationContextSheetScenarios();
registerVersionOperationContextGroupedIdentityScenarios();
registerVersionOperationContextFailClosedScenarios();
