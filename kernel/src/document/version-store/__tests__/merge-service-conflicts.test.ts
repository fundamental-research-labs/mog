import { registerMergeServiceConflictCellValueScenarios } from './merge-service-conflicts-cell-value-scenarios';
import { registerMergeServiceConflictValueFormulaScenarios } from './merge-service-conflicts-value-formula-scenarios';

describe('WorkbookVersionMergeService', () => {
  registerMergeServiceConflictCellValueScenarios();
  registerMergeServiceConflictValueFormulaScenarios();
});
