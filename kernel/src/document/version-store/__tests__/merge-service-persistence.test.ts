import { registerMergeServicePersistenceCleanScenarios } from './merge-service-persistence-clean-scenarios';
import { registerMergeServicePersistenceConflictedScenarios } from './merge-service-persistence-conflicted-scenarios';

describe('WorkbookVersionMergeService persisted review artifacts', () => {
  registerMergeServicePersistenceCleanScenarios();
  registerMergeServicePersistenceConflictedScenarios();
});
