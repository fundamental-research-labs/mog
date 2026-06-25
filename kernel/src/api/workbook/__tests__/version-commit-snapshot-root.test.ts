import { registerSnapshotRootMaterializationScenarios } from './version-commit-snapshot-root-materialization.scenarios';
import { registerSnapshotRootSemanticCaptureScenarios } from './version-commit-snapshot-root-semantic-capture.scenarios';
import { registerSnapshotRootValidationScenarios } from './version-commit-snapshot-root-validation.scenarios';

describe('WorkbookVersion commit snapshot-root capture', () => {
  registerSnapshotRootMaterializationScenarios();
  registerSnapshotRootValidationScenarios();
  registerSnapshotRootSemanticCaptureScenarios();
});
