import 'fake-indexeddb/auto';

import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { createProviderBackedBranchLifecycleService } from '../branch-provider-service';
import type { VersionObjectType } from '../object-digest';
import {
  createVersionObjectRecord,
  versionGraphNamespaceKey,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import { createIndexedDbVersionStoreProvider } from '../provider-indexeddb-backend';
import { createIndexedDbGraphBranchLifecycle } from '../provider-indexeddb-branch-lifecycle';
import {
  INDEX_MANIFESTS_STORE,
  REFS_STORE,
  deleteVersionStoreIndexedDbForTesting,
  openVersionStoreIndexedDb,
} from '../provider-indexeddb-schema';
import {
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
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

describe('IndexedDB provider-backed branch lifecycle CAS', () => {
  it('deletes branches durably through the public branch lifecycle service', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-branch-delete'));
    expectInitializeSuccess(initialized);
    const branchService = createProviderBackedBranchLifecycleService({ provider });
    const created = await branchService.createBranch({
      name: 'scenario/idb-delete',
      targetCommitId: initialized.rootCommit.id,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error('expected branch create success');

    const deleted = await branchService.deleteBranch({
      name: 'scenario/idb-delete',
      expectedHead: initialized.rootCommit.id,
      expectedRefVersion: created.branch.ref.refVersion,
      deletedBy: AUTHOR,
    });

    expect(deleted).toMatchObject({
      ok: true,
      branch: {
        name: 'scenario/idb-delete',
        ref: {
          state: 'tombstone',
          previousTargetCommitId: initialized.rootCommit.id,
          refVersion: { kind: 'counter', value: '1' },
        },
      },
    });
    const reloaded = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const reloadedBranchService = createProviderBackedBranchLifecycleService({
      provider: reloaded,
    });
    const readDeleted = await reloadedBranchService.readBranch('scenario/idb-delete');
    expect(readDeleted.ok).toBe(false);
    if (readDeleted.ok) throw new Error('expected tombstoned branch read to fail');
    expect(readDeleted.error.code).toBe('refTombstoned');
    const list = await reloadedBranchService.listBranches();
    expect(list.ok).toBe(true);
    if (!list.ok) throw new Error('expected branch list success');
    expect(list.branches.map((branch) => branch.name)).not.toContain('scenario/idb-delete');
    const row = await readRefRecord(
      namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-branch-delete'),
      'scenario/idb-delete',
    );
    expect(asRecord(row.record).state).toBe('tombstone');
  });

  it('preserves stale provider ref records when create loses durable absent-CAS', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(
      await initializeInput('graph-branch-create-race'),
    );
    expectInitializeSuccess(initialized);
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-branch-create-race');
    const graph = await provider.openGraph(namespace);
    const concurrentCommit = await graph.commit({
      ...(await rootWrite('create-race-concurrent', namespace)),
      expectedHeadCommitId: initialized.rootCommit.id,
      expectedMainRefVersion: initialized.initialHead.revision,
      parentCommitIds: [initialized.rootCommit.id],
    });
    expect(concurrentCommit.status).toBe('success');
    if (concurrentCommit.status !== 'success') throw new Error('expected concurrent commit');
    const lifecycle = lifecycleWithPersistRace(namespace, () =>
      copyMainRefToBranch(namespace, 'scenario/idb-create-race', {
        targetCommitId: concurrentCommit.commit.id,
        refVersion: { kind: 'counter', value: '9' },
      }),
    );

    const created = await lifecycle.createBranch({
      name: 'scenario/idb-create-race',
      targetCommitId: initialized.rootCommit.id,
      expectedAbsent: true,
      createdBy: AUTHOR,
    });

    expect(created.ok).toBe(false);
    if (created.ok) throw new Error('expected create conflict');
    expect(created.error.code).toBe('refAlreadyExists');
    expect(created.conflict).toMatchObject({
      code: 'refAlreadyExists',
      actualHead: concurrentCommit.commit.id,
      actualRefVersion: { kind: 'counter', value: '9' },
    });
    await expect(readRefRecord(namespace, 'scenario/idb-create-race')).resolves.toMatchObject({
      record: {
        state: 'live',
        targetCommitId: concurrentCommit.commit.id,
        refVersion: { kind: 'counter', value: '9' },
      },
    });
  });

  it('rolls back fast-forward when the provider ref row is stale at durable CAS', async () => {
    const { initialized, namespace, branch, concurrentCommitId, rollbackCommitId } =
      await createBranchFixture('graph-branch-ff-race');
    const lifecycle = lifecycleWithPersistRace(namespace, () =>
      updateRefRecord(namespace, 'scenario/idb-race', (record) => ({
        ...record,
        targetCommitId: concurrentCommitId,
        refVersion: { kind: 'counter', value: '1' },
      })),
    );

    const advanced = await lifecycle.fastForwardBranch({
      name: 'scenario/idb-race',
      nextCommitId: rollbackCommitId,
      expectedOldCommitId: initialized.rootCommit.id,
      expectedRefVersion: branch.ref.refVersion,
      updatedBy: AUTHOR,
    });

    expect(advanced.ok).toBe(false);
    if (advanced.ok) throw new Error('expected fast-forward conflict');
    expect(advanced.error.code).toBe('casConflict');
    expect(advanced.diagnostics[0]).toMatchObject({
      code: 'casConflict',
      details: { cause: 'expectedHeadMismatch' },
    });
    await expect(readRefRecord(namespace, 'scenario/idb-race')).resolves.toMatchObject({
      record: {
        state: 'live',
        targetCommitId: concurrentCommitId,
        refVersion: { kind: 'counter', value: '1' },
      },
    });
  });

  it('rolls back delete when the provider ref row is stale at durable CAS', async () => {
    const { initialized, namespace, branch, concurrentCommitId } =
      await createBranchFixture('graph-branch-delete-race');
    const lifecycle = lifecycleWithPersistRace(namespace, () =>
      updateRefRecord(namespace, 'scenario/idb-race', (record) => ({
        ...record,
        targetCommitId: concurrentCommitId,
        refVersion: { kind: 'counter', value: '1' },
      })),
    );

    const deleted = await lifecycle.deleteBranch({
      name: 'scenario/idb-race',
      expectedHead: initialized.rootCommit.id,
      expectedRefVersion: branch.ref.refVersion,
      deletedBy: AUTHOR,
    });

    expect(deleted.ok).toBe(false);
    if (deleted.ok) throw new Error('expected delete conflict');
    expect(deleted.error.code).toBe('casConflict');
    expect(deleted.diagnostics[0]).toMatchObject({
      code: 'casConflict',
      details: { cause: 'expectedHeadMismatch' },
    });
    await expect(readRefRecord(namespace, 'scenario/idb-race')).resolves.toMatchObject({
      record: {
        state: 'live',
        targetCommitId: concurrentCommitId,
        refVersion: { kind: 'counter', value: '1' },
      },
    });
  });
});

async function createBranchFixture(graphId: string) {
  const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput(graphId));
  expectInitializeSuccess(initialized);
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  const graph = await provider.openGraph(namespace);
  const concurrentCommit = await graph.commit({
    ...(await rootWrite('race-concurrent', namespace)),
    expectedHeadCommitId: initialized.rootCommit.id,
    expectedMainRefVersion: initialized.initialHead.revision,
    parentCommitIds: [initialized.rootCommit.id],
  });
  expect(concurrentCommit.status).toBe('success');
  if (concurrentCommit.status !== 'success') throw new Error('expected concurrent commit success');
  const rollbackCommit = await graph.commit({
    ...(await rootWrite('race-rollback', namespace)),
    expectedHeadCommitId: concurrentCommit.commit.id,
    expectedMainRefVersion: concurrentCommit.main.revision,
    parentCommitIds: [concurrentCommit.commit.id],
  });
  expect(rollbackCommit.status).toBe('success');
  if (rollbackCommit.status !== 'success') throw new Error('expected rollback commit success');
  const created = await graph.createBranch({
    name: 'scenario/idb-race',
    targetCommitId: initialized.rootCommit.id,
    expectedAbsent: true,
    createdBy: AUTHOR,
  });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error('expected branch create success');
  return {
    initialized,
    namespace,
    branch: created.branch,
    concurrentCommitId: concurrentCommit.commit.id,
    rollbackCommitId: rollbackCommit.commit.id,
  };
}

function lifecycleWithPersistRace(namespace: VersionGraphNamespace, race: () => Promise<void>) {
  let openCount = 0;
  return createIndexedDbGraphBranchLifecycle({
    namespace,
    documentScope: DOCUMENT_SCOPE,
    getDb: async () => {
      openCount += 1;
      if (openCount === 2) await race();
      return openVersionStoreIndexedDb();
    },
  });
}

async function initializeInput(graphId: string): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: await rootWrite('root', namespace),
  };
}

async function rootWrite(
  label: string,
  namespace: VersionGraphNamespace,
): Promise<VersionGraphInitializeInput['rootWrite']> {
  return {
    snapshotRootRecord: await objectRecord('workbook.snapshotRoot.v1', { label, sheets: [] }, namespace),
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

async function copyMainRefToBranch(
  namespace: VersionGraphNamespace,
  branchName: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  const main = await readRefRecord(namespace, 'main');
  await putRefRecord(namespace, branchName, {
    ...main,
    record: {
      ...asRecord(main.record),
      ...overrides,
      name: branchName,
      protected: false,
      providerRefId: `test-ref-${branchName}`,
      refIncarnationId: `test-incarnation-${branchName}`,
    },
  }, 1);
}

async function updateRefRecord(
  namespace: VersionGraphNamespace,
  refName: string,
  mutate: (record: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const row = await readRefRecord(namespace, refName);
  await putRefRecord(namespace, refName, { ...row, record: mutate(asRecord(row.record)) });
}

async function readRefRecord(
  namespace: VersionGraphNamespace,
  refName: string,
): Promise<Record<string, unknown>> {
  const db = await openVersionStoreIndexedDb();
  const namespaceKey = versionGraphNamespaceKey(namespace);
  const tx = db.transaction(REFS_STORE, 'readonly');
  const row = await requestValue(tx.objectStore(REFS_STORE).get(`${namespaceKey}\u0000${refName}`));
  await transactionDone(tx, 'ref read transaction failed');
  db.close();
  return asRecord(row);
}

async function putRefRecord(
  namespace: VersionGraphNamespace,
  refName: string,
  row: Record<string, unknown>,
  liveRefCountDelta = 0,
): Promise<void> {
  const db = await openVersionStoreIndexedDb();
  const namespaceKey = versionGraphNamespaceKey(namespace);
  const tx = db.transaction([REFS_STORE, INDEX_MANIFESTS_STORE], 'readwrite');
  const done = transactionDone(tx, 'ref write transaction failed');
  tx.objectStore(REFS_STORE).put(row, `${namespaceKey}\u0000${refName}`);
  if (liveRefCountDelta !== 0) {
    const manifestStore = tx.objectStore(INDEX_MANIFESTS_STORE);
    const manifest = asRecord(await requestValue(manifestStore.get(namespaceKey)));
    const liveRefCount =
      typeof manifest.refStoreLiveRefCount === 'number' ? manifest.refStoreLiveRefCount : 0;
    manifestStore.put(
      {
        ...manifest,
        refStoreLiveRefCount: liveRefCount + liveRefCountDelta,
      },
      namespaceKey,
    );
  }
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

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}
