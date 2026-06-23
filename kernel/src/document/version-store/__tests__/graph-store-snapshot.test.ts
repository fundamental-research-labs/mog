import { registerGraphStoreSnapshotPersistenceScenarios } from './graph-store-snapshot-persistence-scenarios';
import { registerGraphStoreSnapshotValidationScenarios } from './graph-store-snapshot-validation-scenarios';

describe('InMemoryVersionGraphStore snapshots', () => {
  registerGraphStoreSnapshotPersistenceScenarios();
  registerGraphStoreSnapshotValidationScenarios();
});
