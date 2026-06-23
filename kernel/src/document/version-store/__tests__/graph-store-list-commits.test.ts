import { registerListCommitsCommitListingScenarios } from './graph-store-list-commits-commit-listing-scenarios';
import { registerListCommitsCompletenessScenarios } from './graph-store-list-commits-completeness-scenarios';

describe('InMemoryVersionGraphStore listCommits completeness projection', () => {
  registerListCommitsCompletenessScenarios();
});

describe('InMemoryVersionGraphStore commit listing', () => {
  registerListCommitsCommitListingScenarios();
});
