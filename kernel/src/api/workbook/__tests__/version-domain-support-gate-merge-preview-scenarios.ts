import { registerMergeGatePreviewDetectorScenarios } from './version-domain-support-gate-merge-preview-detector-scenarios';
import { registerMergeGatePreviewManifestValidationScenarios } from './version-domain-support-gate-merge-preview-manifest-validation-scenarios';
import { registerMergeGatePreviewRegistryScenarios } from './version-domain-support-gate-merge-preview-registry-scenarios';
import { registerMergeGatePreviewRoutingScenarios } from './version-domain-support-gate-merge-preview-routing-scenarios';

export function registerMergeGatePreviewScenarios(): void {
  registerMergeGatePreviewManifestValidationScenarios();
  registerMergeGatePreviewRoutingScenarios();
  registerMergeGatePreviewRegistryScenarios();
  registerMergeGatePreviewDetectorScenarios();
}
