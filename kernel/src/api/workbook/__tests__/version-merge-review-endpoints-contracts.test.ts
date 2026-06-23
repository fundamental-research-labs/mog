import { registerMergeReviewEndpointContractsAncestryArtifactScenarios } from './version-merge-review-endpoints-contracts-ancestry-artifact-scenarios';
import { registerMergeReviewEndpointContractsNormalizationAliasScenarios } from './version-merge-review-endpoints-contracts-normalization-alias-scenarios';
import { registerMergeReviewEndpointContractsNormalizationTargetDigestScenarios } from './version-merge-review-endpoints-contracts-normalization-target-digest-scenarios';
import { registerMergeReviewEndpointContractsResultIdDigestMismatchScenarios } from './version-merge-review-endpoints-contracts-result-id-digest-mismatch-scenarios';

describe('WorkbookVersion merge review endpoint request contracts', () => {
  registerMergeReviewEndpointContractsResultIdDigestMismatchScenarios();
  registerMergeReviewEndpointContractsNormalizationTargetDigestScenarios();
  registerMergeReviewEndpointContractsNormalizationAliasScenarios();
  registerMergeReviewEndpointContractsAncestryArtifactScenarios();
});
