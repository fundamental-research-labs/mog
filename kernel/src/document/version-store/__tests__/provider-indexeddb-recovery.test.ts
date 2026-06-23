import 'fake-indexeddb/auto';

import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  type VersionGraphCommitPageResult,
  type VersionGraphReadHeadResult,
  type VersionGraphWriteResult,
} from '../graph-store';
import {
  createVersionObjectRecord,
  versionGraphNamespaceKey,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import type { VersionObjectType } from '../object-digest';
import { createIndexedDbVersionStoreProvider } from '../provider-indexeddb-backend';
import {
  COMMIT_INDEXES_STORE,
  OBJECTS_STORE,
  PARENT_INDEXES_STORE,
  REFS_STORE,
  deleteVersionStoreIndexedDbForTesting,
  openVersionStoreIndexedDb,
} from '../provider-indexeddb-schema';
import {
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionStoreDiagnostic,
} from '../provider';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-w8-04',
  documentId: 'document-w8-04',
  principalScope: 'principal-w8-04',
};

const SECRET_DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-secret-w8-04',
  documentId: 'document-secret-w8-04',
  principalScope: 'principal-secret-w8-04',
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

describe('IndexedDB provider recovery hardening', () => {
  it('recovers from corrupt derived object sidecars by reloading canonical object rows', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('sidecar-corrupt'));
    expectInitializeSuccess(initialized);
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'sidecar-corrupt');
    const graph = await provider.openGraph(namespace);
    const committed = await graph.commit({
      ...(await rootWrite('child', namespace)),
      expectedHeadCommitId: initialized.rootCommit.id,
      expectedMainRefVersion: initialized.initialHead.revision,
      parentCommitIds: [initialized.rootCommit.id],
    });
    expectGraphWriteSuccess(committed);

    await updateFirstByNamespace(COMMIT_INDEXES_STORE, namespace, (row) => ({
      ...row,
      schemaVersion: 99,
    }));
    await updateFirstByNamespace(PARENT_INDEXES_STORE, namespace, (row) => ({
      ...row,
      schemaVersion: 99,
    }));
    await provider.close('test-teardown');

    const reloadedProvider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const reloaded = await reloadedProvider.openGraph(namespace);
    const head = await reloaded.readHead();
    expectReadHeadSuccess(head);
    expect(head.head.id).toBe(committed.commit.id);
    const listed = await reloaded.listCommits();
    expectListCommitsSuccess(listed);
    expect(listed.commits.map((commit) => commit.id)).toEqual([
      committed.commit.id,
      initialized.rootCommit.id,
    ]);
    await reloadedProvider.close('test-teardown');
  });

  it('fails closed with redacted diagnostics when canonical object sidecar metadata is corrupt', async () => {
    const provider = createIndexedDbVersionStoreProvider({
      documentScope: SECRET_DOCUMENT_SCOPE,
    });
    const initialized = await provider.initializeGraph(
      await initializeInput('corrupt-object-sidecar', SECRET_DOCUMENT_SCOPE),
    );
    expectInitializeSuccess(initialized);
    const namespace = namespaceForDocumentScope(SECRET_DOCUMENT_SCOPE, 'corrupt-object-sidecar');
    await provider.close('test-teardown');

    await updateFirstObjectByType(namespace, 'workbook.snapshotRoot.v1', (row) => {
      const record = asRecord(row.record);
      return {
        ...row,
        record: {
          ...record,
          payloadByteLength: Number(record.payloadByteLength) + 1,
        },
      };
    });

    const diagnostic = await openGraphDiagnostic(SECRET_DOCUMENT_SCOPE, namespace);
    expect(diagnostic).toMatchObject({
      code: 'VERSION_OBJECT_STORE_FAILURE',
      issueCode: 'VERSION_OBJECT_STORE_FAILURE',
      recoverability: 'repair',
      operation: 'openGraph',
      redacted: true,
      details: {
        reloadIssue: 'corrupt',
        store: OBJECTS_STORE,
        sourceIssue: 'VERSION_BYTE_LENGTH_MISMATCH',
      },
    });
    expect(diagnostic).not.toHaveProperty('namespace');
    expect(diagnostic.sourceDiagnostics?.[0]).not.toHaveProperty('namespace');
    expectNoSecretLeak(diagnostic, SECRET_DOCUMENT_SCOPE, namespace);
  });

  it('fails closed on missing dependency records across provider reopen without repair writes', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('missing-dependency'));
    expectInitializeSuccess(initialized);
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'missing-dependency');
    await provider.close('test-teardown');

    await deleteFirstObjectByType(namespace, 'workbook.semanticChangeSet.v1');
    const countsBefore = await namespaceCounts(namespace);

    const diagnostic = await openGraphDiagnostic(DOCUMENT_SCOPE, namespace);
    expect(diagnostic).toMatchObject({
      code: 'VERSION_MISSING_DEPENDENCY',
      issueCode: 'VERSION_MISSING_DEPENDENCY',
      recoverability: 'repair',
      operation: 'openGraph',
      redacted: true,
      details: {
        reloadIssue: 'missing-dependency',
        store: OBJECTS_STORE,
        sourceIssue: 'VERSION_MISSING_DEPENDENCY',
      },
    });
    expect(await namespaceCounts(namespace)).toEqual(countsBefore);
  });

  it('rejects stale expected-head commits across provider reload before object, index, or ref writes', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('stale-reload'));
    expectInitializeSuccess(initialized);
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'stale-reload');
    await provider.close('test-teardown');

    const staleProvider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const staleGraph = await staleProvider.openGraph(namespace);
    const staleHead = await staleGraph.readHead();
    expectReadHeadSuccess(staleHead);

    const freshProvider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const freshGraph = await freshProvider.openGraph(namespace);
    const freshCommit = await freshGraph.commit({
      ...(await rootWrite('fresh', namespace)),
      expectedHeadCommitId: initialized.rootCommit.id,
      expectedMainRefVersion: initialized.initialHead.revision,
      parentCommitIds: [initialized.rootCommit.id],
    });
    expectGraphWriteSuccess(freshCommit);

    const countsBefore = await namespaceCounts(namespace);
    const mainRefBefore = await storedRef(namespace, 'main');
    const staleCommit = await staleGraph.commit({
      ...(await rootWrite('stale', namespace)),
      expectedHeadCommitId: staleHead.head.id,
      expectedMainRefVersion: staleHead.main.revision,
      parentCommitIds: [staleHead.head.id],
    });

    expect(staleCommit).toMatchObject({
      status: 'failed',
      mutationGuarantee: 'no-write-attempted',
      diagnostics: [
        expect.objectContaining({
          code: 'VERSION_REF_CONFLICT',
          refName: 'refs/heads/main',
          commitId: freshCommit.commit.id,
          details: expect.objectContaining({
            expectedHead: initialized.rootCommit.id,
            actualHead: freshCommit.commit.id,
          }),
        }),
      ],
    });
    expect(await namespaceCounts(namespace)).toEqual(countsBefore);
    expect(await storedRef(namespace, 'main')).toEqual(mainRefBefore);

    await staleProvider.close('test-teardown');
    await freshProvider.close('test-teardown');
  });
});

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
  documentScope: VersionDocumentScope = DOCUMENT_SCOPE,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(documentScope, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: await rootWrite('root', namespace),
  };
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

function expectGraphWriteSuccess(
  result: VersionGraphWriteResult,
): asserts result is Extract<VersionGraphWriteResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected graph write success: ${result.diagnostics[0]?.code}`);
  }
}

function expectReadHeadSuccess(
  result: VersionGraphReadHeadResult,
): asserts result is Extract<VersionGraphReadHeadResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') throw new Error('expected readHead success');
}

function expectListCommitsSuccess(
  result: VersionGraphCommitPageResult,
): asserts result is Extract<VersionGraphCommitPageResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') throw new Error('expected listCommits success');
}

async function openGraphDiagnostic(
  documentScope: VersionDocumentScope,
  namespace: VersionGraphNamespace,
): Promise<VersionStoreDiagnostic> {
  const provider = createIndexedDbVersionStoreProvider({ documentScope });
  try {
    await provider.openGraph(namespace);
  } catch (error) {
    await provider.close('test-teardown');
    const diagnostic = (error as { readonly diagnostic?: VersionStoreDiagnostic }).diagnostic;
    if (diagnostic) return diagnostic;
    throw error;
  }
  await provider.close('test-teardown');
  throw new Error('expected openGraph to fail');
}

async function updateFirstObjectByType(
  namespace: VersionGraphNamespace,
  objectType: VersionObjectType,
  mutate: (row: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  await updateFirstByNamespace(
    OBJECTS_STORE,
    namespace,
    (row) => {
      const record = asRecord(row.record);
      const preimage = asRecord(record.preimage);
      if (preimage.objectType !== objectType) return row;
      return mutate(row);
    },
    objectType,
  );
}

async function deleteFirstObjectByType(
  namespace: VersionGraphNamespace,
  objectType: VersionObjectType,
): Promise<void> {
  const db = await openVersionStoreIndexedDb();
  const tx = db.transaction(OBJECTS_STORE, 'readwrite');
  const done = transactionDone(tx, `${OBJECTS_STORE} delete transaction failed`);
  const request = tx
    .objectStore(OBJECTS_STORE)
    .index('namespaceKey')
    .openCursor(IDBKeyRange.only(versionGraphNamespaceKey(namespace)));
  await new Promise<void>((resolve, reject) => {
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        reject(new Error(`No ${objectType} row found for namespace.`));
        return;
      }
      const record = asRecord(asRecord(cursor.value).record);
      const preimage = asRecord(record.preimage);
      if (preimage.objectType !== objectType) {
        cursor.continue();
        return;
      }
      const deleted = cursor.delete();
      deleted.onsuccess = () => resolve();
      deleted.onerror = () => reject(deleted.error ?? new Error(`${OBJECTS_STORE} delete failed`));
    };
    request.onerror = () => reject(request.error ?? new Error(`${OBJECTS_STORE} cursor failed`));
  });
  await done;
  db.close();
}

async function updateFirstByNamespace(
  storeName: string,
  namespace: VersionGraphNamespace,
  mutate: (row: Record<string, unknown>) => Record<string, unknown>,
  requiredObjectType?: VersionObjectType,
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
      const row = asRecord(cursor.value);
      if (requiredObjectType !== undefined) {
        const preimage = asRecord(asRecord(row.record).preimage);
        if (preimage.objectType !== requiredObjectType) {
          cursor.continue();
          return;
        }
      }
      const update = cursor.update(mutate(row));
      update.onsuccess = () => resolve();
      update.onerror = () => reject(update.error ?? new Error(`${storeName} update failed`));
    };
    request.onerror = () => reject(request.error ?? new Error(`${storeName} cursor failed`));
  });
  await done;
  db.close();
}

async function namespaceCounts(namespace: VersionGraphNamespace): Promise<Record<string, number>> {
  return {
    objects: await countByNamespace(OBJECTS_STORE, namespace),
    refs: await countByNamespace(REFS_STORE, namespace),
    commitIndexes: await countByNamespace(COMMIT_INDEXES_STORE, namespace),
    parentIndexes: await countByNamespace(PARENT_INDEXES_STORE, namespace),
  };
}

async function countByNamespace(
  storeName: string,
  namespace: VersionGraphNamespace,
): Promise<number> {
  const db = await openVersionStoreIndexedDb();
  const tx = db.transaction(storeName, 'readonly');
  const request = tx
    .objectStore(storeName)
    .index('namespaceKey')
    .count(IDBKeyRange.only(versionGraphNamespaceKey(namespace)));
  const count = await requestValue(request);
  await transactionDone(tx, `${storeName} count transaction failed`);
  db.close();
  return count;
}

async function storedRef(
  namespace: VersionGraphNamespace,
  name: string,
): Promise<Record<string, unknown> | undefined> {
  const db = await openVersionStoreIndexedDb();
  const tx = db.transaction(REFS_STORE, 'readonly');
  const row = await requestValue<Record<string, unknown> | undefined>(
    tx.objectStore(REFS_STORE).get(`${versionGraphNamespaceKey(namespace)}\u0000${name}`),
  );
  await transactionDone(tx, `${REFS_STORE} read transaction failed`);
  db.close();
  return row === undefined ? undefined : JSON.parse(JSON.stringify(row));
}

function expectNoSecretLeak(
  diagnostic: VersionStoreDiagnostic,
  documentScope: VersionDocumentScope,
  namespace: VersionGraphNamespace,
): void {
  const serialized = JSON.stringify(diagnostic);
  for (const secret of [
    documentScope.workspaceId,
    documentScope.documentId,
    documentScope.principalScope,
    namespace.graphId,
    versionGraphNamespaceKey(namespace),
  ]) {
    if (secret !== undefined) expect(serialized).not.toContain(secret);
  }
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
