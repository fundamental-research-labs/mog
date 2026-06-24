import { registerDiffServiceProjectionDomainScenarios } from './diff-service-projection-domain-scenarios';
import { registerDiffServiceProjectionMergeScenarios } from './diff-service-projection-merge-scenarios';
import { registerDiffServiceProjectionPaginationScenarios } from './diff-service-projection-pagination-scenarios';
import { registerDiffServiceProjectionRustScenarios } from './diff-service-projection-rust-scenarios';

describe('WorkbookVersionDiffService projection', () => {
  registerDiffServiceProjectionPaginationScenarios();
  registerDiffServiceProjectionDomainScenarios();
  registerDiffServiceProjectionMergeScenarios();
  registerDiffServiceProjectionRustScenarios();
});
