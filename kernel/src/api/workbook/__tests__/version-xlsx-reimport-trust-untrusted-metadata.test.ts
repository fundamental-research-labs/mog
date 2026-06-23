import 'fake-indexeddb/auto';

import { describe } from '@jest/globals';

import { installXlsxReimportTrustVersionStoreHooks } from './version-xlsx-reimport-trust-setup';
import { registerUntrustedMetadataReimportScenarios } from './version-xlsx-reimport-trust-untrusted-metadata-scenarios';

installXlsxReimportTrustVersionStoreHooks();

describe('VC-10 XLSX trusted reimport untrusted metadata', () => {
  registerUntrustedMetadataReimportScenarios();
});
