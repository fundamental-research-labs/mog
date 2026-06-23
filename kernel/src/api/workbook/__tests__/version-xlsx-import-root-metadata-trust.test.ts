import 'fake-indexeddb/auto';

import { registerRootMetadataTrustValidationScenarios } from './version-xlsx-import-root-metadata-trust-validation-scenarios';
import { installMetadataTrustIndexedDbHooks } from './version-xlsx-import-root-metadata-trust-test-utils';

installMetadataTrustIndexedDbHooks();

describe('WorkbookVersion XLSX import root metadata trust', () => {
  registerRootMetadataTrustValidationScenarios();
});
