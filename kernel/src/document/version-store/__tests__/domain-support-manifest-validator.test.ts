import { registerCoreAssertionScenarios } from './domain-support-manifest-validator-core-assertion-scenarios';
import { registerCoreFreshnessScenarios } from './domain-support-manifest-validator-core-freshness-scenarios';
import { registerCoreMalformedScenarios } from './domain-support-manifest-validator-core-malformed-scenarios';
import { registerCoreMatrixRowCoverageScenarios } from './domain-support-manifest-validator-core-matrix-row-coverage-scenarios';
import { registerCoreMatrixRowIntegrityScenarios } from './domain-support-manifest-validator-core-matrix-row-integrity-scenarios';
import { registerCoreSchemaScenarios } from './domain-support-manifest-validator-core-schema-scenarios';
import { registerCoreValidScenarios } from './domain-support-manifest-validator-core-valid-scenarios';

describe('validateDomainSupportManifest (fail-closed)', () => {
  registerCoreValidScenarios();
  registerCoreSchemaScenarios();
  registerCoreFreshnessScenarios();
  registerCoreMatrixRowCoverageScenarios();
  registerCoreMalformedScenarios();
  registerCoreMatrixRowIntegrityScenarios();
});

describe('assertDomainSupportManifest', () => {
  registerCoreAssertionScenarios();
});
