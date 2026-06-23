import 'fake-indexeddb/auto';

import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type {
  VersionGraphReadRefResult,
  VersionGraphWriteResult,
} from '../graph-store';
import type { VersionObjectType } from '../object-digest';
import {
  createVersionObjectRecord,
  versionGraphNamespaceKey,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import {
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
  workspaceId: 'workspace-snapshot-provider',
  documentId: 'document-snapshot-provider',
  principalScope: 'principal-snapshot-provider',
};

export const SECRET_DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-secret-redaction',
  documentId: 'document-secret-redaction',
  principalScope: 'principal-secret-redaction',
};

export const AUTHOR: VersionAuthor = {
  authorId: 'user-snapshot-provider',
  actorKind: 'user',
  displayName: 'Snapshot Provider User',
};

export function installGraphStoreSnapshotProviderIndexedDbCleanup(): void {
  beforeEach(async () => {
    await deleteVersionStoreIndexedDbForTesting();
  });

  afterEach(async () => {
    await deleteVersionStoreIndexedDbForTesting();
  });
}

export function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

export function expectGraphSuccess(
  result: VersionGraphWriteResult,
): asserts result is Extract<VersionGraphWriteResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected graph write success: ${result.diagnostics[0]?.code}`);
  }
}

export function expectReadRefSuccess(
  result: VersionGraphReadRefResult,
): asserts result is Extract<VersionGraphReadRefResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected readRef success: ${result.diagnostics[0]?.code}`);
  }
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
  scope: VersionDocumentScope = DOCUMENT_SCOPE,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(scope, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: await rootWrite('root', namespace),
  };
}

export async function readRecord(
  storeName: string,
  key: IDBValidKey,
): Promise<Record<string, unknown>> {
  const db = await openVersionStoreIndexedDb();
  const tx = db.transaction(storeName, 'readonly');
  const value = await requestValue(tx.objectStore(storeName).get(key));
  await transactionDone(tx, `${storeName} read transaction failed`);
  db.close();
  return asRecord(value);
}

export async function updateStoreRecord(
  storeName: string,
  key: IDBValidKey,
  mutate: (row: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const db = await openVersionStoreIndexedDb();
  const tx = db.transaction(storeName, 'readwrite');
  const done = transactionDone(tx, `${storeName} update transaction failed`);
  const store = tx.objectStore(storeName);
  const current = asRecord(await requestValue(store.get(key)));
  store.put(mutate(current), key);
  await done;
  db.close();
}

export async function deleteStoreRecord(storeName: string, key: IDBValidKey): Promise<void> {
  const db = await openVersionStoreIndexedDb();
  const tx = db.transaction(storeName, 'readwrite');
  const done = transactionDone(tx, `${storeName} delete transaction failed`);
  tx.objectStore(storeName).delete(key);
  await done;
  db.close();
}

export async function expectReloadErrorRedactsSecretScope(
  promise: Promise<unknown>,
  scope: VersionDocumentScope,
  namespace: VersionGraphNamespace,
): Promise<void> {
  try {
    await promise;
    throw new Error('expected reload failure');
  } catch (error) {
    const serialized = JSON.stringify(error);
    for (const leakedValue of [
      ...Object.values(scope),
      ...Object.values(namespace),
      versionGraphNamespaceKey(namespace),
    ]) {
      expect(serialized).not.toContain(leakedValue);
    }
  }
}

export function refKey(namespaceKey: string, name: string): string {
  return `${namespaceKey}\u0000${name}`;
}

export function objectKey(
  namespaceKey: string,
  record: VersionObjectRecord<unknown>,
): string {
  return `${namespaceKey}\u0000${record.digest.algorithm}\u0000${record.digest.digest}`;
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction, message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(message));
    tx.onabort = () => reject(tx.error ?? new Error(message));
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error('IndexedDB row is not an object.');
}
