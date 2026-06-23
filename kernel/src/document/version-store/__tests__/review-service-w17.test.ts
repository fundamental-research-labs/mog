import { registerReviewServiceW17AccessProjectionScenarios } from './review-service-w17-access-projection-scenarios';
import { registerReviewServiceW17ApprovalScenarios } from './review-service-w17-approval-scenarios';
import { registerReviewServiceW17DecisionScenarios } from './review-service-w17-decision-scenarios';

describe('review service W17 hardening', () => {
  registerReviewServiceW17AccessProjectionScenarios();
  registerReviewServiceW17DecisionScenarios();
  registerReviewServiceW17ApprovalScenarios();
});
