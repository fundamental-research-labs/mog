import { registerSnapshotRootReloadServiceFailureScenarios } from './snapshot-root-reload-service-failure-scenarios';
import { registerSnapshotRootReloadServiceProofScenarios } from './snapshot-root-reload-service-proof-scenarios';
import { registerSnapshotRootReloadServiceSuccessScenarios } from './snapshot-root-reload-service-success-scenarios';

describe('SnapshotRootReloadService', () => {
  registerSnapshotRootReloadServiceSuccessScenarios();
  registerSnapshotRootReloadServiceProofScenarios();
  registerSnapshotRootReloadServiceFailureScenarios();
});
