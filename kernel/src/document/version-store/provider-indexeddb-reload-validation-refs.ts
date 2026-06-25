import {
  VERSION_GRAPH_HEAD_REF,
  VERSION_GRAPH_MAIN_REF,
  type VersionGraphSymbolicRef,
} from './graph';
import { maxGeneratedRefRecordId } from './graph/graph-store-snapshot';
import type { VersionGraphNamespace } from './object-store';
import {
  cloneJson,
  type StoredIndexManifest,
  type StoredRefRecord,
} from './provider-indexeddb/internal';
import { throwLoadError } from './provider-indexeddb-reload-errors';
import {
  hasOnlyKeys,
  requirePlainRecord,
  requireString,
  rowLocation,
  validateCommitId,
  validateProviderEpoch,
  validateRefName,
  validateRefVersionValue,
  validateStoredRowEnvelope,
  validateStoredSchemaVersion,
} from './provider-indexeddb-reload-validation-rows';
import type {
  RefRowValidationContext,
  RowValidationContext,
} from './provider-indexeddb-reload-validation-types';
import { REFS_STORE, SYMBOLIC_REFS_STORE } from './provider-indexeddb-schema';
import {
  parseRefVersion,
  refVersionsEqual,
  type LiveRefRecord,
  type RefRecord,
} from './refs/ref-store';

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
  validateRefVersionValue(record.refVersion, context, 'record.refVersion');
}
