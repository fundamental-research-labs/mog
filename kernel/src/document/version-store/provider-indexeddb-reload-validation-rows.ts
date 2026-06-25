import { parseWorkbookCommitId } from './object-digest';
import { normalizeVersionGraphNamespace, type VersionGraphNamespace } from './object-store';
import { cloneJson } from './provider-indexeddb/internal';
import { throwLoadError, type GraphSnapshotLoadDetails } from './provider-indexeddb-reload-errors';
import type { RowValidationContext } from './provider-indexeddb-reload-validation-types';
import { parseRefName } from './refs/ref-name';
import { parseRefVersion } from './refs/ref-store';

export function validateStoredRowEnvelope(
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

export function validateStoredSchemaVersion(
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

export function validateProviderEpoch(
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

export function validateCommitId(
  value: unknown,
  context: RowValidationContext,
  path: string,
): void {
  try {
    parseWorkbookCommitId(value, path);
  } catch {
    throwLoadError('corrupt', 'IndexedDB ref row references an invalid commit id.', {
      ...rowLocation(context),
      path,
    });
  }
}

export function validateRefName(value: unknown, context: RowValidationContext, path: string): void {
  try {
    parseRefName(value, path);
  } catch {
    throwLoadError('corrupt', 'IndexedDB ref row has an invalid ref name.', {
      ...rowLocation(context),
      path,
    });
  }
}

export function validateRefVersionValue(
  value: unknown,
  context: RowValidationContext,
  path: string,
): void {
  try {
    parseRefVersion(cloneJson(value), path);
  } catch {
    throwLoadError('corrupt', 'IndexedDB ref row has an invalid ref version.', {
      ...rowLocation(context),
      path,
    });
  }
}

export function normalizeGraphNamespaceForLoad(
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

export function requirePlainRecord(
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

export function requireString(value: unknown, context: RowValidationContext, path: string): string {
  if (typeof value === 'string') return value;
  throwLoadError('corrupt', 'IndexedDB version store row field is not a string.', {
    ...rowLocation(context),
    path,
  });
}

export function rowLocation(context: RowValidationContext): GraphSnapshotLoadDetails {
  return {
    store: context.store,
    ...(context.rowIndex === undefined ? {} : { rowIndex: context.rowIndex }),
  };
}

export function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    prototype === Object.prototype ||
    prototype === null ||
    Object.prototype.toString.call(value) === '[object Object]'
  );
}
