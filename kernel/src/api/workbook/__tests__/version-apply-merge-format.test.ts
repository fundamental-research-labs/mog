import { registerCleanSameCellFormatScenario } from './version-apply-merge-format-clean-scenario';
import { registerExpandedDomainFormatScenario } from './version-apply-merge-format-expanded-domain-scenario';

describe('WorkbookVersion applyMerge direct formats and expanded domains', () => {
  registerCleanSameCellFormatScenario();
  registerExpandedDomainFormatScenario();
});
