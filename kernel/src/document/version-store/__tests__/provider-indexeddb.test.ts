import 'fake-indexeddb/auto';

import { versionGraphNamespaceKey } from '../object-store';
import {
  createIndexedDbVersionStoreProvider,
  INDEXEDDB_VERSION_STORE_CAPABILITIES,
} from '../provider-indexeddb-backend';
import {
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
import {
  createDefaultVersionStoreProviderRegistry,
  selectVersionStoreProvider,
} from '../provider-registry';
import {
  createVersionGraphRegistry,
  namespaceForDocumentScope,
  versionDocumentScopeKey,
} from '../provider';
import {
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

beforeEach(async () => {
  await resetIndexedDbVersionStoreForTesting();
});

afterEach(async () => {
  await resetIndexedDbVersionStoreForTesting();
});

describe('IndexedDbVersionStoreProvider', () => {
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

  it('fails closed on corrupt and unsupported visible registries', async () => {
    const corrupt = await createVersionGraphRegistry({
      documentScope: DOCUMENT_SCOPE,
      graphId: 'graph-corrupt',
      rootCommitId:
        'commit:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      createdAt: '2026-06-20T00:00:00.000Z',
    });
    await putRegistryEnvelope({
      schemaVersion: 1,
      registry: {
        ...corrupt,
        registryChecksum: { ...corrupt.registryChecksum, digest: '0'.repeat(64) },
      },
    });

    const corruptProvider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    await expect(
      corruptProvider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-corrupt')),
    ).rejects.toMatchObject({
      diagnostic: expect.objectContaining({ code: 'VERSION_CORRUPT_REGISTRY' }),
    });
    expect(await corruptProvider.readGraphRegistry()).toMatchObject({
      status: 'corrupt',
      mutationGuarantee: 'no-write-attempted',
    });
    expect(
      await corruptProvider.initializeGraph(await initializeInput('replacement')),
    ).toMatchObject({
      status: 'failed',
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [expect.objectContaining({ code: 'VERSION_CORRUPT_REGISTRY' })],
    });

    await corruptProvider.close('test-teardown');
    await resetIndexedDbVersionStoreForTesting();
    await putRegistryEnvelope({ schemaVersion: 99, registry: null });
    const unsupportedProvider = createIndexedDbVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
    });
    expect(await unsupportedProvider.readGraphRegistry()).toMatchObject({
      status: 'unsupported',
      diagnostics: [expect.objectContaining({ code: 'VERSION_UNSUPPORTED_REGISTRY' })],
    });
  });
});

describe('VersionStoreProviderRegistry IndexedDB registration', () => {
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
});
