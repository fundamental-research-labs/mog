import { registerMergeServiceInvalidPayloadBlockingScenarios } from './merge-service-blocking-invalid-payload-scenarios';
import { registerMergeServiceUnsupportedDomainBlockingScenarios } from './merge-service-blocking-unsupported-domain-scenarios';

describe('WorkbookVersionMergeService', () => {
  registerMergeServiceUnsupportedDomainBlockingScenarios();
  registerMergeServiceInvalidPayloadBlockingScenarios();
});
