import { versionGraphNamespaceKey, type VersionGraphNamespace } from '../object-store';
import type { VersionObjectType } from '../object-digest';
import {
  COMMIT_INDEXES_STORE,
  OBJECTS_STORE,
  PARENT_INDEXES_STORE,
  REFS_STORE,
  openVersionStoreIndexedDb,
} from '../provider-indexeddb-schema';

export async function updateFirstObjectByType(
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

export async function deleteFirstObjectByType(
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

export async function updateFirstByNamespace(
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

export async function namespaceCounts(
  namespace: VersionGraphNamespace,
): Promise<Record<string, number>> {
  return {
    objects: await countByNamespace(OBJECTS_STORE, namespace),
    refs: await countByNamespace(REFS_STORE, namespace),
    commitIndexes: await countByNamespace(COMMIT_INDEXES_STORE, namespace),
    parentIndexes: await countByNamespace(PARENT_INDEXES_STORE, namespace),
  };
}

export async function storedRef(
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

export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error('IndexedDB row is not an object.');
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
