import { canonicalJsonStringify, isPlainRecord, utf8Encode } from './object-store-canonical';
import { throwValidation } from './object-store-diagnostics';

export type VersionGraphNamespace = {
  readonly workspaceId?: string;
  readonly documentId: string;
  readonly graphId: string;
  readonly principalScope?: string;
};

export function normalizeVersionGraphNamespace(
  namespace: VersionGraphNamespace,
  path = 'namespace',
): VersionGraphNamespace {
  if (!isPlainRecord(namespace)) {
    throwValidation('VERSION_INVALID_NAMESPACE', 'Version graph namespace must be an object.', {
      path,
    });
  }

  assertAllowedKeys(namespace, ['workspaceId', 'documentId', 'graphId', 'principalScope'], path);

  return Object.freeze({
    ...(namespace.workspaceId === undefined
      ? {}
      : { workspaceId: normalizeNamespaceString(namespace.workspaceId, `${path}.workspaceId`) }),
    documentId: normalizeNamespaceString(namespace.documentId, `${path}.documentId`),
    graphId: normalizeNamespaceString(namespace.graphId, `${path}.graphId`),
    ...(namespace.principalScope === undefined
      ? {}
      : {
          principalScope: normalizeNamespaceString(
            namespace.principalScope,
            `${path}.principalScope`,
          ),
        }),
  });
}

export function versionGraphNamespaceKey(namespace: VersionGraphNamespace): string {
  const normalized = normalizeVersionGraphNamespace(namespace);
  return canonicalJsonStringify({
    workspaceId: normalized.workspaceId ?? null,
    documentId: normalized.documentId,
    graphId: normalized.graphId,
    principalScope: normalized.principalScope ?? null,
  });
}

function normalizeNamespaceString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throwValidation(
      'VERSION_INVALID_NAMESPACE',
      'Version graph namespace fields must be strings.',
      {
        path,
      },
    );
  }
  const normalized = value.normalize('NFC');
  if (normalized.length === 0 || utf8Encode(normalized).byteLength > 256) {
    throwValidation(
      'VERSION_INVALID_NAMESPACE',
      'Version graph namespace fields must be non-empty and at most 256 UTF-8 bytes.',
      { path },
    );
  }
  return normalized;
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
): void {
  const unsupportedKey = Object.keys(value).find((key) => !allowedKeys.includes(key));
  if (unsupportedKey) {
    throwValidation(
      'VERSION_INVALID_NAMESPACE',
      'Version graph namespace has an unsupported field.',
      {
        path: `${path}.${unsupportedKey}`,
        details: { field: unsupportedKey },
      },
    );
  }
}
