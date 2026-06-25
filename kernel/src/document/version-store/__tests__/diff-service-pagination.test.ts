import { registerDiffServicePaginationStableOrderScenarios } from './diff-service-pagination-stable-order-scenarios';
import { registerDiffServicePaginationTokenValidationScenarios } from './diff-service-pagination-token-validation-scenarios';

describe('WorkbookVersionDiffService pagination', () => {
  registerDiffServicePaginationStableOrderScenarios();
  registerDiffServicePaginationTokenValidationScenarios();
});
