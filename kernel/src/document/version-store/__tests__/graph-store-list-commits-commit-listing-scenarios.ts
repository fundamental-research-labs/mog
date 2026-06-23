import { registerListCommitsCommitListingDiagnosticScenarios } from './graph-store-list-commits-commit-listing-diagnostic-scenarios';
import { registerListCommitsCommitListingReachabilityScenarios } from './graph-store-list-commits-commit-listing-reachability-scenarios';

export function registerListCommitsCommitListingScenarios(): void {
  registerListCommitsCommitListingReachabilityScenarios();
  registerListCommitsCommitListingDiagnosticScenarios();
}
