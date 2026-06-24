import 'fake-indexeddb/auto';

import { resetIndexedDbVersionStoreForTesting } from './provider-indexeddb-test-utils';

beforeEach(async () => {
  await resetIndexedDbVersionStoreForTesting();
});

afterEach(async () => {
  await resetIndexedDbVersionStoreForTesting();
});

export { versionGraphNamespaceKey } from '../object-store';
export {
  createVersionGraphRegistry,
  namespaceForDocumentScope,
  versionDocumentScopeKey,
} from '../provider';
export {
  createIndexedDbVersionStoreProvider,
  INDEXEDDB_VERSION_STORE_CAPABILITIES,
} from '../provider-indexeddb/backend';
export {
  COMMIT_INDEXES_STORE,
  INDEX_MANIFESTS_STORE,
  INTENTS_STORE,
  OBJECTS_STORE,
  PARENT_INDEXES_STORE,
  REFS_STORE,
  REGISTRIES_STORE,
  SYMBOLIC_REFS_STORE,
  openVersionStoreIndexedDb,
} from '../provider-indexeddb-schema';
export {
  createDefaultVersionStoreProviderRegistry,
  selectVersionStoreProvider,
} from '../provider-registry';
export {
  DOCUMENT_SCOPE,
  count,
  deleteStoreRecord,
  expectInitializeSuccess,
  expectReadHeadSuccess,
  expectRegistryOk,
  initializeInput,
  putRegistryEnvelope,
  resetIndexedDbVersionStoreForTesting,
  updateFirstByNamespace,
} from './provider-indexeddb-test-utils';
