import 'fake-indexeddb/auto';

import { registerAuthoredEditAfterImportRootScenario } from './version-xlsx-import-root-authored-edit-scenario';
import { registerCleanExportScenario } from './version-xlsx-import-root-clean-export-scenario';
import { registerDurableImportRootScenario } from './version-xlsx-import-root-durable-import-root-scenario';
import { registerNewSheetEditAfterImportRootScenario } from './version-xlsx-import-root-new-sheet-edit-scenario';
import { registerSelfPromotedExportSupportScenario } from './version-xlsx-import-root-self-promoted-export-support-scenario';
import { resetVersionStoreIndexedDbForXlsxImportRootTests } from './version-xlsx-import-root-test-utils';
import { registerTrustedMetadataRoundTripScenario } from './version-xlsx-import-root-trusted-roundtrip-scenario';

beforeEach(resetVersionStoreIndexedDbForXlsxImportRootTests);
afterEach(resetVersionStoreIndexedDbForXlsxImportRootTests);

describe('WorkbookVersion XLSX import root', () => {
  registerDurableImportRootScenario();
  registerAuthoredEditAfterImportRootScenario();
  registerNewSheetEditAfterImportRootScenario();
  registerCleanExportScenario();
  registerSelfPromotedExportSupportScenario();
  registerTrustedMetadataRoundTripScenario();
});
