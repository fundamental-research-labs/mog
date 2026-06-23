import { registerMergeServiceSemanticBlockingScenarios } from './merge-service-semantic-blocking-scenarios';
import { registerMergeServiceSemanticCleanScenarios } from './merge-service-semantic-clean-scenarios';
import { registerMergeServiceSemanticConflictScenarios } from './merge-service-semantic-conflict-scenarios';

describe('WorkbookVersionMergeService first-slice semantic records', () => {
  registerMergeServiceSemanticCleanScenarios();
  registerMergeServiceSemanticConflictScenarios();
  registerMergeServiceSemanticBlockingScenarios();
});
