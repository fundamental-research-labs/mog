import {
  deleteVersionStoreIndexedDbForTesting,
  openVersionStoreIndexedDb,
} from '../provider-indexeddb-schema';

export function installGraphStoreSnapshotProviderIndexedDbCleanup(): void {
  beforeEach(async () => {
    await deleteVersionStoreIndexedDbForTesting();
  });

  afterEach(async () => {
    await deleteVersionStoreIndexedDbForTesting();
  });
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
