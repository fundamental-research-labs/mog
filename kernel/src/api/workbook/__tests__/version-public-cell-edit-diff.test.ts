import { registerPublicCellEditClearReplaceReopenScenario } from './version-public-cell-edit-diff.clear-replace-reopen';
import { registerPublicPlainTextEditScenario } from './version-public-cell-edit-diff.plain-text';
import { registerPublicRowInsertionScenario } from './version-public-cell-edit-diff.row-insertion';

describe('WorkbookVersion public cell edit commit/diff vertical', () => {
  registerPublicPlainTextEditScenario();
  registerPublicCellEditClearReplaceReopenScenario();
  registerPublicRowInsertionScenario();
});
