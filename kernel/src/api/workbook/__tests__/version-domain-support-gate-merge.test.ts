import { registerMergeGateApplyScenarios } from './version-domain-support-gate-merge-apply-scenarios';
import { registerMergeGatePreservationScenarios } from './version-domain-support-gate-merge-preservation-scenarios';
import { registerMergeGatePreviewScenarios } from './version-domain-support-gate-merge-preview-scenarios';

describe('WorkbookVersion domain support manifest merge gate', () => {
  registerMergeGatePreservationScenarios();
  registerMergeGatePreviewScenarios();
  registerMergeGateApplyScenarios();
});
