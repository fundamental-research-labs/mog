import 'fake-indexeddb/auto';

import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { VERSION_GRAPH_MAIN_REF, type VersionGraphReadHeadResult } from '../graph-store';
import {
  createVersionObjectRecord,
  versionGraphNamespaceKey,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import type { VersionObjectType } from '../object-digest';
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
  deleteVersionStoreIndexedDbForTesting,
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
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionGraphRegistryReadResult,
} from '../provider';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

beforeEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

afterEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

function expectRegistryOk(
  result: VersionGraphRegistryReadResult,
): asserts result is Extract<VersionGraphRegistryReadResult, { status: 'ok' }> {
  expect(result.status).toBe('ok');
  if (result.status !== 'ok')
    throw new Error(`expected registry ok: ${result.diagnostics[0]?.code}`);
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

function expectReadHeadSuccess(
  result: VersionGraphReadHeadResult,
): asserts result is Extract<VersionGraphReadHeadResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') throw new Error(`expected readHead success`);
}

async function objectRecord(
  objectType: VersionObjectType,
  payload: unknown,
  namespace: VersionGraphNamespace,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}

async function rootWrite(
  label: string,
  namespace: VersionGraphNamespace,
): Promise<VersionGraphInitializeInput['rootWrite']> {
  return {
    snapshotRootRecord: await objectRecord(
      'workbook.snapshotRoot.v1',
      { label, sheets: [] },
      namespace,
    ),
    semanticChangeSetRecord: await objectRecord(
      'workbook.semanticChangeSet.v1',
      { label, changes: [] },
      namespace,
    ),
    author: AUTHOR,
    createdAt: '2026-06-20T00:00:00.000Z',
    completenessDiagnostics: [],
  };
}

async function initializeInput(
  graphId: string,
  label = 'root',
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: await rootWrite(label, namespace),
  };
}

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
    await expect(provider.initializeGraph(await initializeInput('graph-unsupported-row'))).resolves
      .toMatchObject({ status: 'success' });
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
    await expect(provider.initializeGraph(await initializeInput('graph-wrong-ref-scope'))).resolves
      .toMatchObject({ status: 'success' });
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
    await expect(provider.initializeGraph(await initializeInput('graph-missing-manifest'))).resolves
      .toMatchObject({ status: 'success' });
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
    await deleteVersionStoreIndexedDbForTesting();
    await putRegistryEnvelope({ schemaVersion: 99, registry: null });
    const unsupportedProvider = createIndexedDbVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
    });
    expect(await unsupportedProvider.readGraphRegistry()).toMatchObject({
      status: 'unsupported',
      diagnostics: [expect.objectContaining({ code: 'VERSION_UNSUPPORTED_REGISTRY' })],
    });
  });

  it('enforces single-process ref CAS for stale graph commits', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-cas'));
    expectInitializeSuccess(initialized);

    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-cas');
    const left = await provider.openGraph(namespace);
    const right = await provider.openGraph(namespace);
    const leftHead = await left.readHead();
    const rightHead = await right.readHead();
    expectReadHeadSuccess(leftHead);
    expectReadHeadSuccess(rightHead);

    const leftCommit = await left.commit({
      ...(await rootWrite('left', namespace)),
      expectedHeadCommitId: leftHead.head.id,
      expectedMainRefVersion: leftHead.main.revision,
      parentCommitIds: [leftHead.head.id],
    });
    expect(leftCommit.status).toBe('success');

    const staleCommit = await right.commit({
      ...(await rootWrite('right', namespace)),
      expectedHeadCommitId: rightHead.head.id,
      expectedMainRefVersion: rightHead.main.revision,
      parentCommitIds: [rightHead.head.id],
    });
    expect(staleCommit).toMatchObject({
      status: 'failed',
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [expect.objectContaining({ code: 'VERSION_REF_CONFLICT' })],
    });
  });

  it('persists target branch commits with branch-scoped CAS', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-branch-cas'));
    expectInitializeSuccess(initialized);

    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-branch-cas');
    await copyMainRefToBranch(namespace, 'scenario/idb-branch');
    const left = await provider.openGraph(namespace);
    const right = await provider.openGraph(namespace);
    const leftBranch = await left.readRef('refs/heads/scenario/idb-branch');
    expect(leftBranch.status).toBe('success');
    if (leftBranch.status !== 'success' || !('commitId' in leftBranch.ref)) {
      throw new Error('expected readable branch ref');
    }

    const leftCommit = await left.commit({
      ...(await rootWrite('left-branch', namespace)),
      targetRef: 'refs/heads/scenario/idb-branch',
      expectedHeadCommitId: leftBranch.ref.commitId,
      expectedTargetRefVersion: leftBranch.ref.revision,
      parentCommitIds: [leftBranch.ref.commitId],
    });
    expect(leftCommit.status).toBe('success');

    const staleCommit = await right.commit({
      ...(await rootWrite('right-branch', namespace)),
      targetRef: 'refs/heads/scenario/idb-branch',
      expectedHeadCommitId: leftBranch.ref.commitId,
      expectedTargetRefVersion: leftBranch.ref.revision,
      parentCommitIds: [leftBranch.ref.commitId],
    });
    expect(staleCommit).toMatchObject({
      status: 'failed',
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [
        expect.objectContaining({
          code: 'VERSION_REF_CONFLICT',
          refName: 'refs/heads/scenario/idb-branch',
        }),
      ],
    });

    const reloaded = await provider.openGraph(namespace);
    await expect(reloaded.readRef(VERSION_GRAPH_MAIN_REF)).resolves.toMatchObject({
      status: 'success',
      ref: {
        commitId: initialized.rootCommit.id,
        revision: initialized.initialHead.revision,
      },
    });
    await expect(reloaded.readRef('refs/heads/scenario/idb-branch')).resolves.toMatchObject({
      status: 'success',
      ref: {
        commitId: leftCommit.status === 'success' ? leftCommit.commit.id : undefined,
        revision: { kind: 'counter', value: '1' },
      },
    });
  });

  it('persists explicit two-parent merge commits with main-ref CAS', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-merge-cas'));
    expectInitializeSuccess(initialized);

    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-merge-cas');
    await copyMainRefToBranch(namespace, 'scenario/idb-merge-parent');
    const graph = await provider.openGraph(namespace);
    const head = await graph.readHead();
    const branch = await graph.readRef('refs/heads/scenario/idb-merge-parent');
    expectReadHeadSuccess(head);
    expect(branch.status).toBe('success');
    if (branch.status !== 'success' || !('commitId' in branch.ref)) {
      throw new Error('expected readable branch ref');
    }

    const ours = await graph.commit({
      ...(await rootWrite('merge-ours', namespace)),
      expectedHeadCommitId: head.head.id,
      expectedMainRefVersion: head.main.revision,
      parentCommitIds: [head.head.id],
    });
    expect(ours.status).toBe('success');
    if (ours.status !== 'success') throw new Error('expected ours commit success');

    const theirs = await graph.commit({
      ...(await rootWrite('merge-theirs', namespace)),
      targetRef: 'refs/heads/scenario/idb-merge-parent',
      expectedHeadCommitId: branch.ref.commitId,
      expectedTargetRefVersion: branch.ref.revision,
      parentCommitIds: [branch.ref.commitId],
    });
    expect(theirs.status).toBe('success');
    if (theirs.status !== 'success') throw new Error('expected theirs commit success');

    const merge = await graph.mergeCommit({
      ...(await rootWrite('merge-result', namespace)),
      expectedHeadCommitId: ours.commit.id,
      expectedMainRefVersion: ours.main.revision,
      mergeParentCommitId: theirs.commit.id,
    });
    expect(merge.status).toBe('success');
    if (merge.status !== 'success') throw new Error('expected merge commit success');
    expect(merge.commit.payload.parentCommitIds).toEqual([ours.commit.id, theirs.commit.id]);

    const stale = await graph.mergeCommit({
      ...(await rootWrite('merge-stale', namespace)),
      expectedHeadCommitId: ours.commit.id,
      expectedMainRefVersion: ours.main.revision,
      mergeParentCommitId: theirs.commit.id,
    });
    expect(stale).toMatchObject({
      status: 'failed',
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [expect.objectContaining({ code: 'VERSION_REF_CONFLICT' })],
    });

    const reloaded = await provider.openGraph(namespace);
    const reloadedMerge = await reloaded.readCommit(merge.commit.id);
    expect(reloadedMerge).toMatchObject({
      status: 'success',
      commit: {
        payload: {
          parentCommitIds: [ours.commit.id, theirs.commit.id],
        },
      },
    });
    await expect(reloaded.readRef(VERSION_GRAPH_MAIN_REF)).resolves.toMatchObject({
      status: 'success',
      ref: {
        commitId: merge.commit.id,
        revision: { kind: 'counter', value: '2' },
      },
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

function count(store: IDBObjectStore): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('count failed'));
  });
}

async function putRegistryEnvelope(value: unknown): Promise<void> {
  const db = await openVersionStoreIndexedDb();
  const tx = db.transaction(REGISTRIES_STORE, 'readwrite');
  tx.objectStore(REGISTRIES_STORE).put(value, versionDocumentScopeKey(DOCUMENT_SCOPE));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('registry put failed'));
    tx.onabort = () => reject(tx.error ?? new Error('registry put aborted'));
  });
  db.close();
}

async function copyMainRefToBranch(
  namespace: VersionGraphNamespace,
  branchName: string,
): Promise<void> {
  const db = await openVersionStoreIndexedDb();
  const tx = db.transaction(REFS_STORE, 'readwrite');
  const done = transactionDone(tx, 'branch ref seed transaction failed');
  const namespaceKey = versionGraphNamespaceKey(namespace);
  const mainRow = asRecord(
    await requestValue(tx.objectStore(REFS_STORE).get(`${namespaceKey}\u0000main`)),
  );
  const branchRow = JSON.parse(JSON.stringify(mainRow)) as Record<string, unknown>;
  const record = asRecord(branchRow.record);
  branchRow.record = {
    ...record,
    name: branchName,
    protected: false,
    providerRefId: `test-ref-${branchName}`,
    refIncarnationId: `test-incarnation-${branchName}`,
  };
  tx.objectStore(REFS_STORE).put(branchRow, `${namespaceKey}\u0000${branchName}`);
  await done;
  db.close();
}

async function updateFirstByNamespace(
  storeName: string,
  namespace: VersionGraphNamespace,
  mutate: (row: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const db = await openVersionStoreIndexedDb();
  const tx = db.transaction(storeName, 'readwrite');
  const done = transactionDone(tx, `${storeName} update transaction failed`);
  const request = tx
    .objectStore(storeName)
    .index('namespaceKey')
    .openCursor(IDBKeyRange.only(versionGraphNamespaceKey(namespace)));
  await new Promise<void>((resolve, reject) => {
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        reject(new Error(`No ${storeName} row found for namespace.`));
        return;
      }
      const update = cursor.update(mutate(asRecord(cursor.value)));
      update.onsuccess = () => resolve();
      update.onerror = () => reject(update.error ?? new Error(`${storeName} update failed`));
    };
    request.onerror = () => reject(request.error ?? new Error(`${storeName} cursor failed`));
  });
  await done;
  db.close();
}

async function deleteStoreRecord(storeName: string, key: IDBValidKey): Promise<void> {
  const db = await openVersionStoreIndexedDb();
  const tx = db.transaction(storeName, 'readwrite');
  const done = transactionDone(tx, `${storeName} delete transaction failed`);
  const request = tx.objectStore(storeName).delete(key);
  await new Promise<void>((resolve, reject) => {
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error(`${storeName} delete failed`));
  });
  await done;
  db.close();
}

function transactionDone(tx: IDBTransaction, message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(message));
    tx.onabort = () => reject(tx.error ?? new Error(message));
  });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error('IndexedDB row is not an object.');
}
