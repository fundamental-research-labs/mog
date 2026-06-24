import {
  VERSION_GRAPH_HEAD_REF,
  createInMemoryVersionGraphStoreFromSnapshot,
  type InMemoryVersionGraphStore,
} from './graph';
import {
  normalizeVersionGraphNamespace,
  versionGraphNamespaceKey,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from './object-store';
import {
  cloneJson,
  idbRequest,
  idbTransactionDone,
  type StoredObjectRecord,
  type StoredRefRecord,
} from './provider-indexeddb/internal';
import { throwLoadError } from './provider-indexeddb-reload-errors';
import {
  documentScopeKeyForNamespace,
  validateReloadedObjectRecords,
  validateReloadedRefSnapshotManifest,
  validateStoredIndexManifest,
  validateStoredObjectRecord,
  validateStoredRefRecord,
  validateStoredSymbolicHead,
} from './provider-indexeddb-reload-validation';
import {
  INDEX_MANIFESTS_STORE,
  OBJECTS_STORE,
  REFS_STORE,
  SYMBOLIC_REFS_STORE,
} from './provider-indexeddb-schema';
import type { RefRecord } from './refs/ref-store';
import {
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from './registry';

type IndexedDbGraphSnapshotRows = {
  readonly objectRows: readonly unknown[];
  readonly refRows: readonly unknown[];
  readonly manifestRow: unknown | undefined;
  readonly symbolicHeadRow: unknown | undefined;
};

export async function loadGraphSnapshot(
  db: IDBDatabase,
  namespace: VersionGraphNamespace,
  documentScope: VersionDocumentScope,
): Promise<InMemoryVersionGraphStore> {
  const normalized = normalizeVersionGraphNamespace(namespace);
  const namespaceKey = versionGraphNamespaceKey(normalized);
  const documentScopeKey = versionDocumentScopeKey(normalizeVersionDocumentScope(documentScope));
  const namespaceDocumentScopeKey = documentScopeKeyForNamespace(normalized);
  if (namespaceDocumentScopeKey !== documentScopeKey) {
    throwLoadError(
      'wrong-namespace',
      'IndexedDB graph namespace does not match the requested document scope.',
      {
        store: 'graph',
        expectedDocumentScopeKey: documentScopeKey,
        actualDocumentScopeKey: namespaceDocumentScopeKey,
      },
    );
  }

  const rows = await readIndexedDbGraphSnapshotRows(db, namespaceKey);
  return buildGraphSnapshotFromReloadedRows({
    namespace: normalized,
    namespaceKey,
    documentScopeKey,
    rows,
  });
}

async function buildGraphSnapshotFromReloadedRows(input: {
  readonly namespace: VersionGraphNamespace;
  readonly namespaceKey: string;
  readonly documentScopeKey: string;
  readonly rows: IndexedDbGraphSnapshotRows;
}): Promise<InMemoryVersionGraphStore> {
  const manifest = validateStoredIndexManifest(input.rows.manifestRow, {
    store: INDEX_MANIFESTS_STORE,
    namespaceKey: input.namespaceKey,
    documentScopeKey: input.documentScopeKey,
  });
  const objects = input.rows.objectRows.map((row, index) =>
    validateStoredObjectRecord(row, {
      store: OBJECTS_STORE,
      rowIndex: index,
      namespaceKey: input.namespaceKey,
      documentScopeKey: input.documentScopeKey,
    }),
  );
  await validateReloadedObjectRecords(
    input.namespace,
    objects.map((entry) => cloneJson(entry.record)),
  );
  const refs = input.rows.refRows.map((row, index) =>
    validateStoredRefRecord(row, {
      store: REFS_STORE,
      rowIndex: index,
      namespaceKey: input.namespaceKey,
      documentScopeKey: input.documentScopeKey,
      documentId: input.namespace.documentId,
    }),
  );
  const symbolicHead = validateStoredSymbolicHead(input.rows.symbolicHeadRow, {
    store: SYMBOLIC_REFS_STORE,
    namespaceKey: input.namespaceKey,
    documentScopeKey: input.documentScopeKey,
  });
  validateReloadedRefSnapshotManifest({
    manifest,
    refs: refs.map((entry) => entry.record),
    symbolicHead,
    namespace: input.namespace,
    context: {
      store: INDEX_MANIFESTS_STORE,
      namespaceKey: input.namespaceKey,
      documentScopeKey: input.documentScopeKey,
    },
  });

  return createInMemoryVersionGraphStoreFromSnapshot({
    namespace: input.namespace,
    objectRecords: cloneObjectRecords(objects),
    refStore: {
      records: cloneRefRecords(refs),
      nextGeneratedId: manifest.refStoreNextGeneratedId,
      liveRefCount:
        manifest.refStoreLiveRefCount ??
        refs.filter((entry) => entry.record.state === 'live').length,
    },
  });
}

async function readIndexedDbGraphSnapshotRows(
  db: IDBDatabase,
  namespaceKey: string,
): Promise<IndexedDbGraphSnapshotRows> {
  const tx = db.transaction(
    [OBJECTS_STORE, REFS_STORE, SYMBOLIC_REFS_STORE, INDEX_MANIFESTS_STORE],
    'readonly',
  );
  const objectRows = await readAllByIndex<unknown>(
    tx.objectStore(OBJECTS_STORE),
    'namespaceKey',
    namespaceKey,
  );
  const refRows = await readAllByIndex<unknown>(
    tx.objectStore(REFS_STORE),
    'namespaceKey',
    namespaceKey,
  );
  const manifestRow = await idbRequest<unknown | undefined>(
    tx.objectStore(INDEX_MANIFESTS_STORE).get(namespaceKey),
  );
  const symbolicHeadRow = await idbRequest<unknown | undefined>(
    tx.objectStore(SYMBOLIC_REFS_STORE).get(refKey(namespaceKey, VERSION_GRAPH_HEAD_REF)),
  );
  await idbTransactionDone(tx);

  return {
    objectRows,
    refRows,
    manifestRow,
    symbolicHeadRow,
  };
}

function cloneObjectRecords(
  objects: readonly StoredObjectRecord[],
): VersionObjectRecord<unknown>[] {
  return objects.map((entry) => cloneJson(entry.record));
}

function cloneRefRecords(refs: readonly StoredRefRecord[]): RefRecord[] {
  return refs.map((entry) => cloneJson(entry.record));
}

function readAllByIndex<T>(store: IDBObjectStore, indexName: string, key: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const out: T[] = [];
    const request = store.index(indexName).openCursor(IDBKeyRange.only(key));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve(out);
      out.push(cursor.value as T);
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error('IndexedDB cursor failed.'));
  });
}

function refKey(namespaceKey: string, name: string): string {
  return `${namespaceKey}\u0000${name}`;
}
