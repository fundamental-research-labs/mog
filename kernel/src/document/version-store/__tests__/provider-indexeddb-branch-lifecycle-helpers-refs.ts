import { versionGraphNamespaceKey, type VersionGraphNamespace } from '../object-store';
import {
  INDEX_MANIFESTS_STORE,
  REFS_STORE,
  openVersionStoreIndexedDb,
} from '../provider-indexeddb-schema';

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
