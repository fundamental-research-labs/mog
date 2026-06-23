import { registerMergeServiceFormatsCleanScenarios } from './merge-service-formats-clean-scenarios';
import { registerMergeServiceFormatsConflictScenarios } from './merge-service-formats-conflict-scenarios';

describe('WorkbookVersionMergeService direct cell formats', () => {
  registerMergeServiceFormatsCleanScenarios();
  registerMergeServiceFormatsConflictScenarios();
});
