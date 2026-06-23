import {
  registerVersionReviewFacadeMissingServiceScenario,
  registerVersionReviewFacadePartialServiceScenario,
} from './version-review-facade-fail-closed-scenarios';
import { registerVersionReviewFacadeDelegationScenario } from './version-review-facade-delegation-scenarios';

export function registerVersionReviewFacadeScenarios(): void {
  registerVersionReviewFacadeMissingServiceScenario();
  registerVersionReviewFacadeDelegationScenario();
  registerVersionReviewFacadePartialServiceScenario();
}
