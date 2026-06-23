import {
  createInMemoryVersionGraphStoreFromSnapshot,
  type InMemoryVersionGraphStore,
  type VersionGraphStoreDiagnostic,
} from './graph-store';
import { parseWorkbookCommitId } from './object-digest';
import {
  normalizeVersionGraphNamespace,
  versionGraphNamespaceKey,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from './object-store';
import {
  cloneJson,
  errorMessage,
  graphDiagnostic,
  idbRequest,
  idbTransactionDone,
  type StoredIndexManifest,
  type StoredObjectRecord,
  type StoredRefRecord,
} from './provider-indexeddb-internal';
import {
  INDEX_MANIFESTS_STORE,
  OBJECTS_STORE,
  REFS_STORE,
} from './provider-indexeddb-schema';
import { parseRefVersion, type RefRecord } from './ref-store';
import { parseRefName } from './ref-name';
import {
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from './registry';

type GraphSnapshotLoadIssue = 'corrupt' | 'unsupported' | 'wrong-namespace';
type GraphSnapshotLoadDetails = Readonly<Record<string, string | number | boolean | null>>;

class IndexedDbGraphSnapshotLoadError extends Error {
  readonly issue: GraphSnapshotLoadIssue;
  readonly details: GraphSnapshotLoadDetails;

  constructor(issue: GraphSnapshotLoadIssue, message: string, details: GraphSnapshotLoadDetails) {
    super(message);
    this.name = 'IndexedDbGraphSnapshotLoadError';
    this.issue = issue;
    this.details = details;
  }
}

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

  const tx = db.transaction([OBJECTS_STORE, REFS_STORE, INDEX_MANIFESTS_STORE], 'readonly');
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
  await idbTransactionDone(tx);

  const manifest = validateStoredIndexManifest(manifestRow, {
    store: INDEX_MANIFESTS_STORE,
    namespaceKey,
    documentScopeKey,
  });
  const objects = objectRows.map((row, index) =>
    validateStoredObjectRecord(row, {
      store: OBJECTS_STORE,
      rowIndex: index,
      namespaceKey,
      documentScopeKey,
    }),
  );
  const refs = refRows.map((row, index) =>
    validateStoredRefRecord(row, {
      store: REFS_STORE,
      rowIndex: index,
      namespaceKey,
      documentScopeKey,
      documentId: normalized.documentId,
    }),
  );

  return createInMemoryVersionGraphStoreFromSnapshot({
    namespace: normalized,
    objectRecords: objects.map((entry) => cloneJson(entry.record)),
    refStore: {
      records: refs.map((entry) => cloneJson(entry.record)),
      nextGeneratedId: manifest.refStoreNextGeneratedId,
      liveRefCount:
        manifest.refStoreLiveRefCount ??
        refs.filter((entry) => entry.record.state === 'live').length,
    },
  });
}

export function graphLoadDiagnostic(
  error: unknown,
  namespace: VersionGraphNamespace,
  operation: VersionGraphStoreDiagnostic['operation'],
): VersionGraphStoreDiagnostic {
  const loadError = error instanceof IndexedDbGraphSnapshotLoadError ? error : null;
  const details = {
    cause: errorMessage(error),
    ...(loadError ? { reloadIssue: loadError.issue, ...loadError.details } : {}),
  };
  return graphDiagnostic(
    loadError?.issue === 'wrong-namespace'
      ? 'VERSION_WRONG_NAMESPACE'
      : 'VERSION_OBJECT_STORE_FAILURE',
    loadError?.message ?? 'IndexedDB graph snapshot could not be loaded.',
    {
      namespace,
      operation,
      details,
    },
  );
}

type RowValidationContext = {
  readonly store: string;
  readonly namespaceKey: string;
  readonly documentScopeKey: string;
  readonly rowIndex?: number;
};

type RefRowValidationContext = RowValidationContext & {
  readonly documentId: string;
};

function validateStoredObjectRecord(
  value: unknown,
  context: RowValidationContext,
): StoredObjectRecord {
  const row = validateStoredRowEnvelope(value, context, [
    'schemaVersion',
    'namespaceKey',
    'documentScopeKey',
    'record',
  ]);
  const record = requirePlainRecord(row.record, context, 'record');
  const recordNamespace = normalizeGraphNamespaceForLoad(
    record.namespace,
    context,
    'record.namespace',
  );
  const actualNamespaceKey = versionGraphNamespaceKey(recordNamespace);
  if (actualNamespaceKey !== context.namespaceKey) {
    throwLoadError(
      'wrong-namespace',
      'IndexedDB object record namespace does not match its durable graph namespace.',
      {
        ...rowLocation(context),
        path: 'record.namespace',
        expectedNamespaceKey: context.namespaceKey,
        actualNamespaceKey,
      },
    );
  }

  return {
    schemaVersion: 1,
    namespaceKey: context.namespaceKey,
    documentScopeKey: context.documentScopeKey,
    record: row.record as VersionObjectRecord<unknown>,
  };
}

function validateStoredRefRecord(value: unknown, context: RefRowValidationContext): StoredRefRecord {
  const row = validateStoredRowEnvelope(value, context, [
    'schemaVersion',
    'namespaceKey',
    'documentScopeKey',
    'record',
  ]);
  return {
    schemaVersion: 1,
    namespaceKey: context.namespaceKey,
    documentScopeKey: context.documentScopeKey,
    record: validatePersistedRefRecord(row.record, context),
  };
}

function validateStoredIndexManifest(
  value: unknown,
  context: RowValidationContext,
): StoredIndexManifest {
  if (value === undefined) {
    throwLoadError(
      'corrupt',
      'IndexedDB graph snapshot manifest is missing for a visible graph registry.',
      rowLocation(context),
    );
  }

  const row = validateStoredRowEnvelope(value, context, [
    'schemaVersion',
    'namespaceKey',
    'documentScopeKey',
    'namespace',
    'refStoreNextGeneratedId',
    'refStoreLiveRefCount',
    'updatedAt',
  ]);
  const manifestNamespace = normalizeGraphNamespaceForLoad(row.namespace, context, 'namespace');
  const manifestNamespaceKey = versionGraphNamespaceKey(manifestNamespace);
  if (manifestNamespaceKey !== context.namespaceKey) {
    throwLoadError(
      'wrong-namespace',
      'IndexedDB graph snapshot manifest namespace does not match its durable graph key.',
      {
        ...rowLocation(context),
        path: 'namespace',
        expectedNamespaceKey: context.namespaceKey,
        actualNamespaceKey: manifestNamespaceKey,
      },
    );
  }
  const manifestDocumentScopeKey = documentScopeKeyForNamespace(manifestNamespace);
  if (manifestDocumentScopeKey !== context.documentScopeKey) {
    throwLoadError(
      'wrong-namespace',
      'IndexedDB graph snapshot manifest document scope does not match the selected provider.',
      {
        ...rowLocation(context),
        path: 'namespace',
        expectedDocumentScopeKey: context.documentScopeKey,
        actualDocumentScopeKey: manifestDocumentScopeKey,
      },
    );
  }
  const refStoreNextGeneratedId = row.refStoreNextGeneratedId;
  if (
    typeof refStoreNextGeneratedId !== 'number' ||
    !Number.isSafeInteger(refStoreNextGeneratedId) ||
    refStoreNextGeneratedId < 0
  ) {
    throwLoadError('corrupt', 'IndexedDB graph snapshot manifest has an invalid ref id counter.', {
      ...rowLocation(context),
      path: 'refStoreNextGeneratedId',
    });
  }
  if (typeof row.updatedAt !== 'string') {
    throwLoadError('corrupt', 'IndexedDB graph snapshot manifest has an invalid timestamp.', {
      ...rowLocation(context),
      path: 'updatedAt',
    });
  }
  const refStoreLiveRefCount = row.refStoreLiveRefCount;
  if (
    refStoreLiveRefCount !== undefined &&
    (typeof refStoreLiveRefCount !== 'number' ||
      !Number.isSafeInteger(refStoreLiveRefCount) ||
      refStoreLiveRefCount < 0)
  ) {
    throwLoadError('corrupt', 'IndexedDB graph snapshot manifest has an invalid live ref count.', {
      ...rowLocation(context),
      path: 'refStoreLiveRefCount',
    });
  }

  return {
    schemaVersion: 1,
    namespaceKey: context.namespaceKey,
    documentScopeKey: context.documentScopeKey,
    namespace: manifestNamespace,
    refStoreNextGeneratedId,
    ...(refStoreLiveRefCount === undefined ? {} : { refStoreLiveRefCount }),
    updatedAt: row.updatedAt,
  };
}

function validateStoredRowEnvelope(
  value: unknown,
  context: RowValidationContext,
  keys: readonly string[],
): Record<string, unknown> {
  const row = requirePlainRecord(value, context, 'row');
  validateStoredSchemaVersion(row.schemaVersion, context, 'schemaVersion');
  if (!hasOnlyKeys(row, keys)) {
    throwLoadError(
      'corrupt',
      'IndexedDB version store row has unsupported fields for its schema version.',
      rowLocation(context),
    );
  }
  validateStoredKey(row.namespaceKey, context.namespaceKey, context, 'namespaceKey');
  validateStoredKey(row.documentScopeKey, context.documentScopeKey, context, 'documentScopeKey');
  return row;
}

function validateStoredSchemaVersion(
  value: unknown,
  context: RowValidationContext,
  path: string,
): void {
  if (value === 1) return;
  throwLoadError(
    typeof value === 'number' ? 'unsupported' : 'corrupt',
    'IndexedDB version store row schema version is not supported.',
    {
      ...rowLocation(context),
      path,
      expectedSchemaVersion: 1,
      actualSchemaVersion: typeof value === 'number' ? value : String(value),
    },
  );
}

function validateStoredKey(
  value: unknown,
  expected: string,
  context: RowValidationContext,
  path: 'namespaceKey' | 'documentScopeKey',
): void {
  if (typeof value !== 'string') {
    throwLoadError('corrupt', 'IndexedDB version store row key is not a string.', {
      ...rowLocation(context),
      path,
    });
  }
  if (value !== expected) {
    throwLoadError(
      'wrong-namespace',
      'IndexedDB version store row key does not match the requested reload scope.',
      {
        ...rowLocation(context),
        path,
        expectedKey: expected,
        actualKey: value,
      },
    );
  }
}

function validatePersistedRefRecord(value: unknown, context: RefRowValidationContext): RefRecord {
  const record = requirePlainRecord(value, context, 'record');
  if (record.state === 'live') {
    validateLiveRefRecord(record, context);
    return record as unknown as RefRecord;
  }
  if (record.state === 'tombstone') {
    validateTombstoneRefRecord(record, context);
    return record as unknown as RefRecord;
  }

  throwLoadError('corrupt', 'IndexedDB ref row has an unsupported ref state.', {
    ...rowLocation(context),
    path: 'record.state',
  });
}

function validateLiveRefRecord(
  record: Record<string, unknown>,
  context: RefRowValidationContext,
): void {
  validateRefRecordEnvelope(record, context, [
    'state',
    'schemaVersion',
    'versionDocumentId',
    'name',
    'kind',
    'targetCommitId',
    'baseCommitId',
    'providerRefId',
    'providerEpoch',
    'refIncarnationId',
    'protected',
    'createdAt',
    'createdBy',
    'updatedAt',
    'updatedBy',
    'refVersion',
  ]);
  if (record.kind !== 'branch') {
    throwLoadError('corrupt', 'IndexedDB live ref row kind is invalid.', {
      ...rowLocation(context),
      path: 'record.kind',
    });
  }
  validateCommitId(record.targetCommitId, context, 'record.targetCommitId');
  if (record.baseCommitId !== undefined) {
    validateCommitId(record.baseCommitId, context, 'record.baseCommitId');
  }
  requireString(record.providerRefId, context, 'record.providerRefId');
  validateProviderEpoch(record.providerEpoch, context, 'record.providerEpoch');
  requireString(record.refIncarnationId, context, 'record.refIncarnationId');
  if (typeof record.protected !== 'boolean') {
    throwLoadError('corrupt', 'IndexedDB live ref protection flag is invalid.', {
      ...rowLocation(context),
      path: 'record.protected',
    });
  }
  requireString(record.createdAt, context, 'record.createdAt');
  requireString(record.updatedAt, context, 'record.updatedAt');
  requirePlainRecord(record.createdBy, context, 'record.createdBy');
  requirePlainRecord(record.updatedBy, context, 'record.updatedBy');
}

function validateTombstoneRefRecord(
  record: Record<string, unknown>,
  context: RefRowValidationContext,
): void {
  validateRefRecordEnvelope(record, context, [
    'state',
    'schemaVersion',
    'versionDocumentId',
    'name',
    'previousTargetCommitId',
    'previousProviderRefId',
    'previousProviderEpoch',
    'previousRefIncarnationId',
    'deletedAt',
    'deletedBy',
    'deleteReason',
    'deleteDiagnostics',
    'refVersion',
  ]);
  validateCommitId(record.previousTargetCommitId, context, 'record.previousTargetCommitId');
  requireString(record.previousProviderRefId, context, 'record.previousProviderRefId');
  validateProviderEpoch(record.previousProviderEpoch, context, 'record.previousProviderEpoch');
  requireString(record.previousRefIncarnationId, context, 'record.previousRefIncarnationId');
  requireString(record.deletedAt, context, 'record.deletedAt');
  requirePlainRecord(record.deletedBy, context, 'record.deletedBy');
  if (record.deleteReason !== undefined) {
    requireString(record.deleteReason, context, 'record.deleteReason');
  }
  if (record.deleteDiagnostics !== undefined && !Array.isArray(record.deleteDiagnostics)) {
    throwLoadError('corrupt', 'IndexedDB tombstone ref diagnostics are invalid.', {
      ...rowLocation(context),
      path: 'record.deleteDiagnostics',
    });
  }
}

function validateRefRecordEnvelope(
  record: Record<string, unknown>,
  context: RefRowValidationContext,
  keys: readonly string[],
): void {
  validateStoredSchemaVersion(record.schemaVersion, context, 'record.schemaVersion');
  if (!hasOnlyKeys(record, keys)) {
    throwLoadError(
      'corrupt',
      'IndexedDB ref record has unsupported fields for its schema version.',
      rowLocation(context),
    );
  }
  if (record.versionDocumentId !== context.documentId) {
    throwLoadError(
      'wrong-namespace',
      'IndexedDB ref record document id does not match the selected provider.',
      {
        ...rowLocation(context),
        path: 'record.versionDocumentId',
        expectedDocumentId: context.documentId,
        actualDocumentId:
          typeof record.versionDocumentId === 'string' ? record.versionDocumentId : null,
      },
    );
  }
  validateRefName(record.name, context, 'record.name');
  validateRefVersion(record.refVersion, context, 'record.refVersion');
}

function validateProviderEpoch(
  value: unknown,
  context: RowValidationContext,
  path: string,
): void {
  const epoch = requirePlainRecord(value, context, path);
  if (!hasOnlyKeys(epoch, ['kind', 'value'])) {
    throwLoadError('corrupt', 'IndexedDB ref provider epoch has unsupported fields.', {
      ...rowLocation(context),
      path,
    });
  }
  if ((epoch.kind !== 'counter' && epoch.kind !== 'opaque') || typeof epoch.value !== 'string') {
    throwLoadError('corrupt', 'IndexedDB ref provider epoch is invalid.', {
      ...rowLocation(context),
      path,
    });
  }
}

function validateCommitId(value: unknown, context: RowValidationContext, path: string): void {
  try {
    parseWorkbookCommitId(value, path);
  } catch {
    throwLoadError('corrupt', 'IndexedDB ref row references an invalid commit id.', {
      ...rowLocation(context),
      path,
    });
  }
}

function validateRefName(value: unknown, context: RowValidationContext, path: string): void {
  try {
    parseRefName(value, path);
  } catch {
    throwLoadError('corrupt', 'IndexedDB ref row has an invalid ref name.', {
      ...rowLocation(context),
      path,
    });
  }
}

function validateRefVersion(value: unknown, context: RowValidationContext, path: string): void {
  try {
    parseRefVersion(cloneJson(value), path);
  } catch {
    throwLoadError('corrupt', 'IndexedDB ref row has an invalid ref version.', {
      ...rowLocation(context),
      path,
    });
  }
}

function normalizeGraphNamespaceForLoad(
  value: unknown,
  context: RowValidationContext,
  path: string,
): VersionGraphNamespace {
  try {
    return normalizeVersionGraphNamespace(cloneJson(value) as VersionGraphNamespace, path);
  } catch {
    throwLoadError('corrupt', 'IndexedDB version store row has an invalid graph namespace.', {
      ...rowLocation(context),
      path,
    });
  }
}

function requirePlainRecord(
  value: unknown,
  context: RowValidationContext,
  path: string,
): Record<string, unknown> {
  if (isPlainRecord(value)) return value;
  throwLoadError('corrupt', 'IndexedDB version store row field is not a plain object.', {
    ...rowLocation(context),
    path,
  });
}

function requireString(value: unknown, context: RowValidationContext, path: string): string {
  if (typeof value === 'string') return value;
  throwLoadError('corrupt', 'IndexedDB version store row field is not a string.', {
    ...rowLocation(context),
    path,
  });
}

function documentScopeKeyForNamespace(namespace: VersionGraphNamespace): string {
  const normalized = normalizeVersionGraphNamespace(namespace);
  return versionDocumentScopeKey(
    normalizeVersionDocumentScope({
      ...(normalized.workspaceId === undefined ? {} : { workspaceId: normalized.workspaceId }),
      documentId: normalized.documentId,
      ...(normalized.principalScope === undefined
        ? {}
        : { principalScope: normalized.principalScope }),
    }),
  );
}

function rowLocation(context: RowValidationContext): GraphSnapshotLoadDetails {
  return {
    store: context.store,
    ...(context.rowIndex === undefined ? {} : { rowIndex: context.rowIndex }),
  };
}

function throwLoadError(
  issue: GraphSnapshotLoadIssue,
  message: string,
  details: GraphSnapshotLoadDetails,
): never {
  throw new IndexedDbGraphSnapshotLoadError(issue, message, details);
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    prototype === Object.prototype ||
    prototype === null ||
    Object.prototype.toString.call(value) === '[object Object]'
  );
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
