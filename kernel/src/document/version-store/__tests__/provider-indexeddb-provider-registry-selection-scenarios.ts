import {
  DOCUMENT_SCOPE,
  createDefaultVersionStoreProviderRegistry,
  selectVersionStoreProvider,
} from './provider-indexeddb-core-test-utils';

export function registerIndexedDbProviderRegistrySelectionScenarios(): void {
  it('selects the explicit IndexedDB provider when durable persistence is required', () => {
    const registry = createDefaultVersionStoreProviderRegistry();
    expect(registry.capabilities('indexeddb')).toMatchObject({
      durableGraphRegistry: true,
      durableObjects: true,
      multiProcessCasGraphRegistry: false,
      multiProcessCasRefs: false,
    });

    const provider = selectVersionStoreProvider({
      kind: 'indexeddb',
      documentScope: DOCUMENT_SCOPE,
      requireDurablePersistence: true,
    });
    expect(provider.capabilities.durableGraphRegistry).toBe(true);
    expect(provider.capabilities.durableObjects).toBe(true);
  });
}
