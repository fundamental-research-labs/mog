import 'fake-indexeddb/auto';

import {
  expectInitializeSuccess,
  expectReadHeadSuccess,
  resetIndexedDbVersionStoreForTesting,
  rootWrite,
} from './provider-indexeddb-test-utils';

export { expectInitializeSuccess, expectReadHeadSuccess, rootWrite };
export {
  DOCUMENT_SCOPE,
  SECRET_DOCUMENT_SCOPE,
  initializeInput,
} from './provider-indexeddb-recovery-helpers-fixtures';
export {
  expectGraphWriteSuccess,
  expectListCommitsSuccess,
  expectNoSecretLeak,
} from './provider-indexeddb-recovery-helpers-expectations';
export { openGraphDiagnostic } from './provider-indexeddb-recovery-helpers-diagnostics';
export {
  asRecord,
  deleteFirstObjectByType,
  namespaceCounts,
  storedRef,
  updateFirstByNamespace,
  updateFirstObjectByType,
} from './provider-indexeddb-recovery-helpers-indexeddb';

beforeEach(async () => {
  await resetIndexedDbVersionStoreForTesting();
});

afterEach(async () => {
  await resetIndexedDbVersionStoreForTesting();
});
