import {
  INDEX_MANIFESTS_STORE,
  REFS_STORE,
  REGISTRIES_STORE,
  deleteVersionStoreIndexedDbForTesting,
  openVersionStoreIndexedDb,
} from '../provider-indexeddb-schema';
import { versionGraphNamespaceKey, type VersionGraphNamespace } from '../object-store';
import { versionDocumentScopeKey } from '../provider';
import { DOCUMENT_SCOPE } from './provider-indexeddb-test-utils-fixtures';

export async function resetIndexedDbVersionStoreForTesting(): Promise<void> {
  await deleteVersionStoreIndexedDbForTesting();
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
