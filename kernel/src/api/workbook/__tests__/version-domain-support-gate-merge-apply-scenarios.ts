import { registerMergeGateApplyAdmissionScenarios } from './version-domain-support-gate-merge-apply-admission-scenarios';
import { registerMergeGateApplyDetectorScenarios } from './version-domain-support-gate-merge-apply-detector-scenarios';
import { registerMergeGateApplyPreviewScenarios } from './version-domain-support-gate-merge-apply-preview-scenarios';
import { registerMergeGateApplyRegistryScenarios } from './version-domain-support-gate-merge-apply-registry-scenarios';

export function registerMergeGateApplyScenarios(): void {
  registerMergeGateApplyAdmissionScenarios();
  registerMergeGateApplyDetectorScenarios();
  registerMergeGateApplyPreviewScenarios();
  registerMergeGateApplyRegistryScenarios();
}
