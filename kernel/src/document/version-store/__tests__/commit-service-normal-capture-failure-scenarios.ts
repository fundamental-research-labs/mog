import { registerCommitServiceNormalCaptureFailureEmptyCaptureScenarios } from './commit-service-normal-capture-failure-empty-capture-scenarios';
import { registerCommitServiceNormalCaptureFailureGraphWriteScenarios } from './commit-service-normal-capture-failure-graph-write-scenarios';
import { registerCommitServiceNormalCaptureFailureSnapshotMaterializationScenarios } from './commit-service-normal-capture-failure-snapshot-materialization-scenarios';
import { registerCommitServiceNormalCaptureFailureThrownCaptureScenarios } from './commit-service-normal-capture-failure-thrown-capture-scenarios';

export function registerCommitServiceNormalCaptureFailureScenarios(): void {
  registerCommitServiceNormalCaptureFailureGraphWriteScenarios();
  registerCommitServiceNormalCaptureFailureSnapshotMaterializationScenarios();
  registerCommitServiceNormalCaptureFailureThrownCaptureScenarios();
  registerCommitServiceNormalCaptureFailureEmptyCaptureScenarios();
}
