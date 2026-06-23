import 'fake-indexeddb/auto';

import { registerDefaultRootPublicCellEditDiffScenario } from './version-indexeddb-public-cell-edit-diff-default-root-scenario';
import { registerProviderReopenPublicCellEditDiffScenario } from './version-indexeddb-public-cell-edit-diff-provider-reopen-scenario';
import { installIndexedDbPublicCellEditDiffLifecycle } from './version-indexeddb-public-cell-edit-diff-test-utils';

installIndexedDbPublicCellEditDiffLifecycle();

describe('WorkbookVersion IndexedDB public cell edit commit/diff vertical', () => {
  registerDefaultRootPublicCellEditDiffScenario();
  registerProviderReopenPublicCellEditDiffScenario();
});
