import type { WorkbookCommitId as PublicWorkbookCommitId } from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { VersionGraphReadHeadResult } from '../graph-store';
import {
  createVersionObjectRecord,
  versionGraphNamespaceKey,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import type { VersionObjectType } from '../object-digest';
import type {
  VersionDocumentScope,
  VersionGraphInitializeInput,
  VersionGraphInitializeResult,
  VersionGraphRegistryReadResult,
} from '../provider';
import { namespaceForDocumentScope, versionDocumentScopeKey } from '../provider';
import {
  INDEX_MANIFESTS_STORE,
  REFS_STORE,
  REGISTRIES_STORE,
  deleteVersionStoreIndexedDbForTesting,
  openVersionStoreIndexedDb,
} from '../provider-indexeddb-schema';

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

export const MISSING_COMMIT_ID =
  'commit:sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' as PublicWorkbookCommitId;

export async function resetIndexedDbVersionStoreForTesting(): Promise<void> {
  await deleteVersionStoreIndexedDbForTesting();
}

export function expectRegistryOk(
  result: VersionGraphRegistryReadResult,
): asserts result is Extract<VersionGraphRegistryReadResult, { status: 'ok' }> {
  expect(result.status).toBe('ok');
  if (result.status !== 'ok')
    throw new Error(`expected registry ok: ${result.diagnostics[0]?.code}`);
}

export function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

export function expectReadHeadSuccess(
  result: VersionGraphReadHeadResult,
): asserts result is Extract<VersionGraphReadHeadResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') throw new Error(`expected readHead success`);
}

export async function objectRecord(
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

export async function initializeInput(
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

export function count(store: IDBObjectStore): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('count failed'));
  });
}

export async function putRegistryEnvelope(value: unknown): Promise<void> {
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

export async function copyMainRefToBranch(
  namespace: VersionGraphNamespace,
  branchName: string,
): Promise<void> {
  const db = await openVersionStoreIndexedDb();
  const tx = db.transaction([REFS_STORE, INDEX_MANIFESTS_STORE], 'readwrite');
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
  const manifestStore = tx.objectStore(INDEX_MANIFESTS_STORE);
  const manifest = asRecord(await requestValue(manifestStore.get(namespaceKey)));
  const liveRefCount =
    typeof manifest.refStoreLiveRefCount === 'number' ? manifest.refStoreLiveRefCount : 0;
  manifestStore.put(
    {
      ...manifest,
      refStoreLiveRefCount: liveRefCount + 1,
    },
    namespaceKey,
  );
  await done;
  db.close();
}

export async function updateFirstByNamespace(
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

export async function deleteStoreRecord(storeName: string, key: IDBValidKey): Promise<void> {
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
