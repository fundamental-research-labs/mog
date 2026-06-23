import 'fake-indexeddb/auto';

import { deleteVersionStoreIndexedDbForTesting } from '../../../document/version-store/provider-indexeddb-schema';
import { registerAuthorityIdentityScenarios } from './version-xlsx-metadata-export-gate-authority-identity-scenarios';
import { registerAuthorityProofScenarios } from './version-xlsx-metadata-export-gate-authority-proof-scenarios';
import { registerAuthorityRedactionScenarios } from './version-xlsx-metadata-export-gate-authority-redaction-scenarios';
import { registerAuthorityStaleScenarios } from './version-xlsx-metadata-export-gate-authority-stale-scenarios';

beforeEach(deleteVersionStoreIndexedDbForTesting);
afterEach(deleteVersionStoreIndexedDbForTesting);

describe('VC-10 XLSX metadata export gating - authority rejection', () => {
  registerAuthorityStaleScenarios();
  registerAuthorityIdentityScenarios();
  registerAuthorityProofScenarios();
  registerAuthorityRedactionScenarios();
});
