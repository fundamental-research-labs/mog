import {
  VERSION_GRAPH_HEAD_REF,
  VERSION_GRAPH_MAIN_REF,
  type VersionGraphSymbolicRef,
} from './graph-store';
import { maxGeneratedRefRecordId } from './graph-store-snapshot';
import { parseWorkbookCommitId } from './object-digest';
import {
  createInMemoryVersionObjectStore,
  normalizeVersionGraphNamespace,
  versionGraphNamespaceKey,
  type VersionGraphNamespace,
  type VersionObjectRecord,
  type VersionObjectStoreDiagnostic,
} from './object-store';
import {
  cloneJson,
  type StoredIndexManifest,
  type StoredObjectRecord,
  type StoredRefRecord,
} from './provider-indexeddb-internal';
import {
  sanitizeLoadDetails,
  throwLoadError,
  type GraphSnapshotLoadDetails,
  type GraphSnapshotLoadIssue,
} from './provider-indexeddb-reload-errors';
import {
  INDEX_MANIFESTS_STORE,
  OBJECTS_STORE,
  REFS_STORE,
  SYMBOLIC_REFS_STORE,
} from './provider-indexeddb-schema';
import { parseRefName } from './ref-name';
import { parseRefVersion, refVersionsEqual, type LiveRefRecord, type RefRecord } from './ref-store';
import {
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from './registry';

type RowValidationContext = {
  readonly store: string;
  readonly namespaceKey: string;
  readonly documentScopeKey: string;
  readonly rowIndex?: number;
};

type RefRowValidationContext = RowValidationContext & {
  readonly documentId: string;
};

export async function validateReloadedObjectRecords(
  namespace: VersionGraphNamespace,
  records: readonly VersionObjectRecord<unknown>[],
): Promise<void> {
  const objectStore = createInMemoryVersionObjectStore(namespace);
  const put = await objectStore.putObjects(records);
  if (put.status === 'success') return;

  const first = put.diagnostics[0];
  throwLoadError(
    loadIssueForObjectDiagnostic(first),
    'IndexedDB graph object records failed recovery validation.',
    {
      store: OBJECTS_STORE,
      sourceIssue: first.code,
      sourceSeverity: first.severity,
      diagnosticCount: put.diagnostics.length,
      ...(first.objectType === undefined ? {} : { objectType: first.objectType }),
      ...(first.details === undefined ? {} : sanitizeLoadDetails(first.details)),
    },
  );
}

export function validateStoredObjectRecord(
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

export function validateStoredRefRecord(
  value: unknown,
  context: RefRowValidationContext,
): StoredRefRecord {
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

export function validateStoredIndexManifest(
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

export function validateStoredSymbolicHead(
  value: unknown,
  context: RowValidationContext,
): VersionGraphSymbolicRef {
  if (value === undefined) {
    throwLoadError(
      'corrupt',
      'IndexedDB graph snapshot symbolic HEAD is missing for a visible graph registry.',
      rowLocation(context),
    );
  }

  const row = validateStoredRowEnvelope(value, context, [
    'schemaVersion',
    'namespaceKey',
    'documentScopeKey',
    'ref',
  ]);
  const ref = requirePlainRecord(row.ref, context, 'ref');
  if (!hasOnlyKeys(ref, ['name', 'target', 'revision'])) {
    throwLoadError(
      'corrupt',
      'IndexedDB symbolic ref row has unsupported fields for its schema version.',
      rowLocation(context),
    );
  }
  if (ref.name !== VERSION_GRAPH_HEAD_REF || ref.target !== VERSION_GRAPH_MAIN_REF) {
    throwLoadError('corrupt', 'IndexedDB symbolic ref row does not describe HEAD -> main.', {
      ...rowLocation(context),
      path: 'ref',
    });
  }

  try {
    return {
      name: VERSION_GRAPH_HEAD_REF,
      target: VERSION_GRAPH_MAIN_REF,
      revision: parseRefVersion(cloneJson(ref.revision), 'ref.revision'),
    };
  } catch {
    throwLoadError('corrupt', 'IndexedDB symbolic HEAD row has an invalid revision.', {
      ...rowLocation(context),
      path: 'ref.revision',
    });
  }
}

export function validateReloadedRefSnapshotManifest(input: {
  readonly manifest: StoredIndexManifest;
  readonly refs: readonly RefRecord[];
  readonly symbolicHead: VersionGraphSymbolicRef;
  readonly namespace: VersionGraphNamespace;
  readonly context: RowValidationContext;
}): void {
  const liveRefs = input.refs.filter((record): record is LiveRefRecord => record.state === 'live');
  const liveRefCount = liveRefs.length;
  if (
    input.manifest.refStoreLiveRefCount !== undefined &&
    input.manifest.refStoreLiveRefCount !== liveRefCount
  ) {
    throwLoadError('corrupt', 'IndexedDB graph snapshot manifest live ref count is stale.', {
      ...rowLocation(input.context),
      path: 'refStoreLiveRefCount',
      expectedLiveRefCount: liveRefCount,
      actualLiveRefCount: input.manifest.refStoreLiveRefCount,
    });
  }

  const maxGeneratedId = maxGeneratedRefRecordId(input.refs, input.namespace.documentId);
  if (input.manifest.refStoreNextGeneratedId < maxGeneratedId) {
    throwLoadError('corrupt', 'IndexedDB graph snapshot manifest generated id counter is stale.', {
      ...rowLocation(input.context),
      path: 'refStoreNextGeneratedId',
      expectedNextGeneratedIdAtLeast: maxGeneratedId,
      actualNextGeneratedId: input.manifest.refStoreNextGeneratedId,
    });
  }

  const main = liveRefs.find((record) => record.name === 'main');
  if (main === undefined) {
    throwLoadError(
      'corrupt',
      'IndexedDB graph snapshot is missing the live main ref required by symbolic HEAD.',
      {
        store: REFS_STORE,
        path: 'record.name',
      },
    );
  }
  if (!refVersionsEqual(main.refVersion, input.symbolicHead.revision)) {
    throwLoadError(
      'corrupt',
      'IndexedDB symbolic HEAD revision does not match the live main ref.',
      {
        store: SYMBOLIC_REFS_STORE,
        path: 'ref.revision',
      },
    );
  }
}

export function documentScopeKeyForNamespace(namespace: VersionGraphNamespace): string {
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

function loadIssueForObjectDiagnostic(
  diagnostic: VersionObjectStoreDiagnostic,
): GraphSnapshotLoadIssue {
  if (diagnostic.code === 'VERSION_MISSING_DEPENDENCY') return 'missing-dependency';
  if (
    diagnostic.code === 'VERSION_UNSUPPORTED_SCHEMA' ||
    diagnostic.code === 'VERSION_UNSUPPORTED_PAYLOAD_ENCODING' ||
    diagnostic.code === 'VERSION_UNSUPPORTED_DIGEST_ALGORITHM' ||
    diagnostic.code === 'VERSION_UNSUPPORTED_OBJECT_TYPE'
  ) {
    return 'unsupported';
  }
  return 'corrupt';
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

function validateProviderEpoch(value: unknown, context: RowValidationContext, path: string): void {
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

function rowLocation(context: RowValidationContext): GraphSnapshotLoadDetails {
  return {
    store: context.store,
    ...(context.rowIndex === undefined ? {} : { rowIndex: context.rowIndex }),
  };
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
