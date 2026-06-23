import {
  DOCUMENT_SCOPE,
  INDEX_MANIFESTS_STORE,
  OBJECTS_STORE,
  REFS_STORE,
  createIndexedDbVersionStoreProvider,
  deleteStoreRecord,
  expectRegistryOk,
  initializeInput,
  namespaceForDocumentScope,
  updateFirstByNamespace,
  versionDocumentScopeKey,
  versionGraphNamespaceKey,
} from './provider-indexeddb-core-test-utils';

export function registerIndexedDbDurableReloadFailureScenarios(): void {
  it('fails closed on unsupported persisted object rows during durable reload', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    await expect(
      provider.initializeGraph(await initializeInput('graph-unsupported-row')),
    ).resolves.toMatchObject({ status: 'success' });
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-unsupported-row');
    await updateFirstByNamespace(OBJECTS_STORE, namespace, (row) => ({
      ...row,
      schemaVersion: 99,
    }));

    const reloaded = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    expectRegistryOk(await reloaded.readGraphRegistry());
    await expect(reloaded.openGraph(namespace)).rejects.toMatchObject({
      diagnostic: expect.objectContaining({
        code: 'VERSION_OBJECT_STORE_FAILURE',
        operation: 'openGraph',
        details: expect.objectContaining({
          reloadIssue: 'unsupported',
          store: OBJECTS_STORE,
        }),
      }),
    });
  });

  it('fails closed on wrong-scope persisted ref rows during durable reload', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    await expect(
      provider.initializeGraph(await initializeInput('graph-wrong-ref-scope')),
    ).resolves.toMatchObject({ status: 'success' });
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-wrong-ref-scope');
    await updateFirstByNamespace(REFS_STORE, namespace, (row) => ({
      ...row,
      documentScopeKey: versionDocumentScopeKey({ documentId: 'other-document' }),
    }));

    const reloaded = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    expectRegistryOk(await reloaded.readGraphRegistry());
    await expect(reloaded.openGraph(namespace)).rejects.toMatchObject({
      diagnostic: expect.objectContaining({
        code: 'VERSION_WRONG_NAMESPACE',
        operation: 'openGraph',
        details: expect.objectContaining({
          reloadIssue: 'wrong-namespace',
          store: REFS_STORE,
          path: 'documentScopeKey',
        }),
      }),
    });
  });

  it('fails closed when the visible registry points at a graph without a reload manifest', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    await expect(
      provider.initializeGraph(await initializeInput('graph-missing-manifest')),
    ).resolves.toMatchObject({ status: 'success' });
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-missing-manifest');
    await deleteStoreRecord(INDEX_MANIFESTS_STORE, versionGraphNamespaceKey(namespace));

    const reloaded = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    expectRegistryOk(await reloaded.readGraphRegistry());
    await expect(reloaded.openGraph(namespace)).rejects.toMatchObject({
      diagnostic: expect.objectContaining({
        code: 'VERSION_OBJECT_STORE_FAILURE',
        operation: 'openGraph',
        details: expect.objectContaining({
          reloadIssue: 'corrupt',
          store: INDEX_MANIFESTS_STORE,
        }),
      }),
    });
  });
}
