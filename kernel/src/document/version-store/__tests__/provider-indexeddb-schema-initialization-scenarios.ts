import {
  COMMIT_INDEXES_STORE,
  DOCUMENT_SCOPE,
  INDEXEDDB_VERSION_STORE_CAPABILITIES,
  INDEX_MANIFESTS_STORE,
  INTENTS_STORE,
  OBJECTS_STORE,
  PARENT_INDEXES_STORE,
  REFS_STORE,
  REGISTRIES_STORE,
  SYMBOLIC_REFS_STORE,
  count,
  createIndexedDbVersionStoreProvider,
  expectInitializeSuccess,
  expectReadHeadSuccess,
  expectRegistryOk,
  initializeInput,
  namespaceForDocumentScope,
  openVersionStoreIndexedDb,
} from './provider-indexeddb-core-test-utils';

export function registerIndexedDbSchemaAndInitializationScenarios(): void {
  it('creates separate VC stores and reports truthful browser capabilities', async () => {
    const db = await openVersionStoreIndexedDb();
    for (const store of [
      REGISTRIES_STORE,
      OBJECTS_STORE,
      REFS_STORE,
      SYMBOLIC_REFS_STORE,
      COMMIT_INDEXES_STORE,
      PARENT_INDEXES_STORE,
      INDEX_MANIFESTS_STORE,
      INTENTS_STORE,
    ]) {
      expect(db.objectStoreNames.contains(store)).toBe(true);
    }
    db.close();

    expect(INDEXEDDB_VERSION_STORE_CAPABILITIES).toMatchObject({
      durableGraphRegistry: true,
      durableObjects: true,
      casGraphRegistry: true,
      casRefs: true,
      multiProcessCasGraphRegistry: false,
      multiProcessCasRefs: false,
      reads: { graphRegistry: true, objects: true, refs: true, commits: true },
      writes: { initializeGraph: true, putObjects: true, commitGraphWrite: true },
    });
  });

  it('initializes object-first, publishes registry last, and reloads from IndexedDB', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1'));
    expectInitializeSuccess(initialized);

    const registryRead = await provider.readGraphRegistry();
    expectRegistryOk(registryRead);
    expect(registryRead.registry).toEqual(initialized.registry);

    const db = await openVersionStoreIndexedDb();
    const tx = db.transaction(
      [
        OBJECTS_STORE,
        REFS_STORE,
        SYMBOLIC_REFS_STORE,
        COMMIT_INDEXES_STORE,
        INDEX_MANIFESTS_STORE,
        INTENTS_STORE,
      ],
      'readonly',
    );
    const objectCount = count(tx.objectStore(OBJECTS_STORE));
    const refCount = count(tx.objectStore(REFS_STORE));
    const symbolicRefCount = count(tx.objectStore(SYMBOLIC_REFS_STORE));
    const commitIndexCount = count(tx.objectStore(COMMIT_INDEXES_STORE));
    const manifestCount = count(tx.objectStore(INDEX_MANIFESTS_STORE));
    const intentCount = count(tx.objectStore(INTENTS_STORE));
    await expect(objectCount).resolves.toBeGreaterThan(0);
    await expect(refCount).resolves.toBeGreaterThan(0);
    await expect(symbolicRefCount).resolves.toBeGreaterThan(0);
    await expect(commitIndexCount).resolves.toBeGreaterThan(0);
    await expect(manifestCount).resolves.toBeGreaterThan(0);
    await expect(intentCount).resolves.toBeGreaterThan(0);
    db.close();

    await provider.close('test-teardown');
    const reloaded = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const reloadedRegistry = await reloaded.readGraphRegistry();
    expectRegistryOk(reloadedRegistry);
    expect(reloadedRegistry.registry).toEqual(initialized.registry);

    const graph = await reloaded.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
    const head = await graph.readHead();
    expectReadHeadSuccess(head);
    expect(head.head.id).toBe(initialized.rootCommit.id);
  });
}
