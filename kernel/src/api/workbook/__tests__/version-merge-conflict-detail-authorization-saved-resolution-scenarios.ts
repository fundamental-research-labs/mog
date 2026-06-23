import { registerSavedResolutionDifferentPrincipalScenarios } from './version-merge-conflict-detail-authorization-saved-resolution-different-principal-scenarios';
import { registerSavedResolutionPayloadBindingScenarios } from './version-merge-conflict-detail-authorization-saved-resolution-payload-binding-scenarios';
import { registerSavedResolutionReviewOnlyApplyScenarios } from './version-merge-conflict-detail-authorization-saved-resolution-review-only-apply-scenarios';

export function registerSavedResolutionAuthorizationScenarios(): void {
  describe('saved resolution authorization', () => {
    registerSavedResolutionPayloadBindingScenarios();
    registerSavedResolutionDifferentPrincipalScenarios();
    registerSavedResolutionReviewOnlyApplyScenarios();
  });
}
