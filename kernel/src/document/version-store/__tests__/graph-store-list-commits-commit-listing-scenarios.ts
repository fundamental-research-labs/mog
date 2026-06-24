import { registerListCommitsCommitListingDiagnosticScenarios } from './graph-store-list-commits-commit-listing-diagnostic-scenarios';
import { registerListCommitsCommitListingReachabilityScenarios } from './graph-store-list-commits-commit-listing-reachability-scenarios';
import { registerListCommitsPaginationScenarios } from './graph-store-list-commits-pagination-scenarios';

export function registerListCommitsCommitListingScenarios(): void {
  registerListCommitsCommitListingReachabilityScenarios();
  registerListCommitsPaginationScenarios();
  registerListCommitsCommitListingDiagnosticScenarios();
}
