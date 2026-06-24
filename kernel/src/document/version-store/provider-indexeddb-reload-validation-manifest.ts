import {
  normalizeVersionGraphNamespace,
  versionGraphNamespaceKey,
  type VersionGraphNamespace,
} from './object-store';
import type { StoredIndexManifest } from './provider-indexeddb/internal';
import { throwLoadError } from './provider-indexeddb-reload-errors';
import {
  normalizeGraphNamespaceForLoad,
  rowLocation,
  validateStoredRowEnvelope,
} from './provider-indexeddb-reload-validation-rows';
import type { RowValidationContext } from './provider-indexeddb-reload-validation-types';
import { normalizeVersionDocumentScope, versionDocumentScopeKey } from './registry';

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
