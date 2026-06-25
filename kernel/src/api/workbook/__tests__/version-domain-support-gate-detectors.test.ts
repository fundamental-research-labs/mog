import { registerMutableDetectorFailClosedScenarios } from './version-domain-support-gate-detectors-fail-closed-scenarios';
import { registerMutableDetectorManifestRowScenarios } from './version-domain-support-gate-detectors-manifest-row-scenarios';

describe('WorkbookVersion domain support mutable detector gate', () => {
  registerMutableDetectorFailClosedScenarios();
  registerMutableDetectorManifestRowScenarios();
});
