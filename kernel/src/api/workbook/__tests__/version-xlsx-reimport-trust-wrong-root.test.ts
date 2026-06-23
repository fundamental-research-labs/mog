import { describe } from '@jest/globals';

import { registerWrongRootTrustDenialScenarios } from './version-xlsx-reimport-trust-wrong-root-scenarios';

describe('VC-10 XLSX reimport wrong-root trust denial', () => {
  registerWrongRootTrustDenialScenarios();
});
