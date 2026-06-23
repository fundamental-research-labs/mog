import 'fake-indexeddb/auto';

import { deleteVersionStoreIndexedDbForTesting } from '../../../document/version-store/provider-indexeddb-schema';
import { registerAuthorizedExportScenarios } from './version-xlsx-metadata-export-gate-authorized-scenarios';
import { registerCleanExportScenarios } from './version-xlsx-metadata-export-gate-clean-scenarios';

beforeEach(deleteVersionStoreIndexedDbForTesting);
afterEach(deleteVersionStoreIndexedDbForTesting);

describe('VC-10 XLSX metadata export gating - clean and authorized flows', () => {
  registerCleanExportScenarios();
  registerAuthorizedExportScenarios();
});
