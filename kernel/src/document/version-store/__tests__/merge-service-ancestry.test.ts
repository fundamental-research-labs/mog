import { registerMergeServiceAncestryBlockingScenarios } from './merge-service-ancestry-blocking-scenarios';
import { registerMergeServiceAncestryFastForwardScenarios } from './merge-service-ancestry-fast-forward-scenarios';
import { registerMergeServiceAncestryPersistenceScenarios } from './merge-service-ancestry-persistence-scenarios';

describe('WorkbookVersionMergeService ancestry and fast-forward previews', () => {
  registerMergeServiceAncestryFastForwardScenarios();
  registerMergeServiceAncestryPersistenceScenarios();
  registerMergeServiceAncestryBlockingScenarios();
});
