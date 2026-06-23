import 'fake-indexeddb/auto';

import { registerCellsFormulasPersistenceCheckoutScenario } from './version-indexeddb-public-vc06-persistence-checkout-cells-formulas-scenario';
import { registerCellsValuesPersistenceCheckoutScenario } from './version-indexeddb-public-vc06-persistence-checkout-cells-values-scenario';
import { registerRowsColumnsPersistenceCheckoutScenario } from './version-indexeddb-public-vc06-persistence-checkout-rows-columns-scenario';
import { installIndexedDbPublicVc06PersistenceCheckoutLifecycle } from './version-indexeddb-public-vc06-persistence-checkout-test-utils';

installIndexedDbPublicVc06PersistenceCheckoutLifecycle();

describe('WorkbookVersion IndexedDB VC06 authored grid persistence checkout evidence', () => {
  registerCellsValuesPersistenceCheckoutScenario();
  registerCellsFormulasPersistenceCheckoutScenario();
  registerRowsColumnsPersistenceCheckoutScenario();
});
