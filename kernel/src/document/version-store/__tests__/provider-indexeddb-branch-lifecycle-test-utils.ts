import 'fake-indexeddb/auto';

import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

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

export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

export const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export function installIndexedDbBranchLifecycleCleanup(): void {
  beforeEach(async () => {
    await deleteVersionStoreIndexedDbForTesting();
  });

  afterEach(async () => {
    await deleteVersionStoreIndexedDbForTesting();
  });
}

export async function createBranchFixture(graphId: string) {
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

export function lifecycleWithPersistRace(
  namespace: VersionGraphNamespace,
  race: () => Promise<void>,
) {
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

export async function initializeInput(graphId: string): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: await rootWrite('root', namespace),
  };
}

export async function rootWrite(
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

export async function copyMainRefToBranch(
  namespace: VersionGraphNamespace,
  branchName: string,
  overrides: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  const main = await readRefRecord(namespace, 'main');
  await putRefRecord(
    namespace,
    branchName,
    {
      ...main,
      record: {
        ...asRecord(main.record),
        ...overrides,
        name: branchName,
        protected: false,
        providerRefId: `test-ref-${branchName}`,
        refIncarnationId: `test-incarnation-${branchName}`,
      },
    },
    1,
  );
}

export async function updateRefRecord(
  namespace: VersionGraphNamespace,
  refName: string,
  mutate: (record: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const row = await readRefRecord(namespace, refName);
  await putRefRecord(namespace, refName, { ...row, record: mutate(asRecord(row.record)) });
}

export async function readRefRecord(
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

export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error('IndexedDB row is not an object.');
}

export function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
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
