import { registerVisibleActiveSheetMaterializationScenario } from './version-checkout-lifecycle-visible-active-sheet-scenarios';
import { registerVc06SnapshotRootMaterializationScenario } from './version-checkout-lifecycle-vc06-snapshot-root-scenarios';

describe('WorkbookVersion checkout lifecycle materialization', () => {
  registerVc06SnapshotRootMaterializationScenario();
  registerVisibleActiveSheetMaterializationScenario();
});
