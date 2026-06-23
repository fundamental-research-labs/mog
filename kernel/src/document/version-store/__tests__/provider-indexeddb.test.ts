import './provider-indexeddb-core-test-utils';

import { registerIndexedDbDurableReloadFailureScenarios } from './provider-indexeddb-durable-reload-failure-scenarios';
import { registerIndexedDbProviderRegistrySelectionScenarios } from './provider-indexeddb-provider-registry-selection-scenarios';
import { registerIndexedDbRegistryFailureScenarios } from './provider-indexeddb-registry-failure-scenarios';
import { registerIndexedDbSchemaAndInitializationScenarios } from './provider-indexeddb-schema-initialization-scenarios';

describe('IndexedDbVersionStoreProvider', () => {
  registerIndexedDbSchemaAndInitializationScenarios();
  registerIndexedDbDurableReloadFailureScenarios();
  registerIndexedDbRegistryFailureScenarios();
});

describe('VersionStoreProviderRegistry IndexedDB registration', () => {
  registerIndexedDbProviderRegistrySelectionScenarios();
});
