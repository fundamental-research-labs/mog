import {
  createInMemoryVersionObjectStore,
  versionGraphNamespaceKey,
  type VersionGraphNamespace,
  type VersionObjectRecord,
  type VersionObjectStoreDiagnostic,
} from './object-store';
import type { StoredObjectRecord } from './provider-indexeddb/internal';
import {
  sanitizeLoadDetails,
  throwLoadError,
  type GraphSnapshotLoadIssue,
} from './provider-indexeddb-reload-errors';
import {
  normalizeGraphNamespaceForLoad,
  requirePlainRecord,
  rowLocation,
  validateStoredRowEnvelope,
} from './provider-indexeddb-reload-validation-rows';
import type { RowValidationContext } from './provider-indexeddb-reload-validation-types';
import { OBJECTS_STORE } from './provider-indexeddb-schema';

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
