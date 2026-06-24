import { VERSION_GRAPH_MAIN_REF } from './graph';
import type { ObjectDigest, WorkbookCommitId } from './object-digest';
import { normalizeVersionGraphNamespace, type VersionGraphNamespace } from './object-store';

export const VERSION_GRAPH_REGISTRY_SCHEMA_VERSION = 1;
export const VERSION_GRAPH_REGISTRY_CHECKSUM_DOMAIN = 'mog.version-registry-checksum.v1\n';

export type VersionDocumentScope = {
  readonly workspaceId?: string;
  readonly documentId: string;
  readonly principalScope?: string;
};

export type VersionRecordRevision = {
  readonly kind: 'counter';
  readonly value: string;
};

export type VersionGraphRegistry = {
  readonly schemaVersion: typeof VERSION_GRAPH_REGISTRY_SCHEMA_VERSION;
  readonly workspaceId?: string;
  readonly documentId: string;
  readonly principalScope?: string;
  readonly currentGraphId: string;
  readonly headRefName: typeof VERSION_GRAPH_MAIN_REF;
  readonly rootCommitId: WorkbookCommitId;
  readonly registryRevision: VersionRecordRevision;
  readonly registryChecksum: ObjectDigest;
  readonly createdAt: string;
};

export function normalizeVersionDocumentScope(
  scope: VersionDocumentScope,
  path = 'documentScope',
): VersionDocumentScope {
  if (!isPlainRecord(scope)) {
    throw new Error(`${path} must be an object.`);
  }
  assertAllowedKeys(scope, ['workspaceId', 'documentId', 'principalScope'], path);

  return Object.freeze({
    ...(scope.workspaceId === undefined
      ? {}
      : { workspaceId: normalizeVersionStoreString(scope.workspaceId, `${path}.workspaceId`) }),
    documentId: normalizeVersionStoreString(scope.documentId, `${path}.documentId`),
    ...(scope.principalScope === undefined
      ? {}
      : {
          principalScope: normalizeVersionStoreString(
            scope.principalScope,
            `${path}.principalScope`,
          ),
        }),
  });
}

export function versionDocumentScopeKey(scope: VersionDocumentScope): string {
  const normalized = normalizeVersionDocumentScope(scope);
  return canonicalJsonStringify({
    workspaceId: normalized.workspaceId ?? null,
    documentId: normalized.documentId,
    principalScope: normalized.principalScope ?? null,
  });
}

export function namespaceForDocumentScope(
  scope: VersionDocumentScope,
  graphId: string,
): VersionGraphNamespace {
  const normalizedScope = normalizeVersionDocumentScope(scope);
  return normalizeVersionGraphNamespace({
    ...(normalizedScope.workspaceId === undefined
      ? {}
      : { workspaceId: normalizedScope.workspaceId }),
    documentId: normalizedScope.documentId,
    graphId,
    ...(normalizedScope.principalScope === undefined
      ? {}
      : { principalScope: normalizedScope.principalScope }),
  });
}

export async function createVersionGraphRegistry(input: {
  readonly documentScope: VersionDocumentScope;
  readonly graphId: string;
  readonly rootCommitId: WorkbookCommitId;
  readonly createdAt: string;
}): Promise<VersionGraphRegistry> {
  const documentScope = normalizeVersionDocumentScope(input.documentScope);
  const registryRevision = Object.freeze({
    kind: 'counter',
    value: '0',
  }) satisfies VersionRecordRevision;
  const registryChecksum = await registryChecksumFor({
    schemaVersion: VERSION_GRAPH_REGISTRY_SCHEMA_VERSION,
    workspaceId: documentScope.workspaceId ?? null,
    documentId: documentScope.documentId,
    principalScope: documentScope.principalScope ?? null,
    currentGraphId: input.graphId,
    headRefName: VERSION_GRAPH_MAIN_REF,
    rootCommitId: input.rootCommitId,
    createdAt: input.createdAt,
  });

  return cloneVersionGraphRegistry({
    schemaVersion: VERSION_GRAPH_REGISTRY_SCHEMA_VERSION,
    ...(documentScope.workspaceId === undefined ? {} : { workspaceId: documentScope.workspaceId }),
    documentId: documentScope.documentId,
    ...(documentScope.principalScope === undefined
      ? {}
      : { principalScope: documentScope.principalScope }),
    currentGraphId: input.graphId,
    headRefName: VERSION_GRAPH_MAIN_REF,
    rootCommitId: input.rootCommitId,
    registryRevision,
    registryChecksum,
    createdAt: input.createdAt,
  });
}

export function namespaceForRegistry(registry: VersionGraphRegistry): VersionGraphNamespace {
  return normalizeVersionGraphNamespace({
    ...(registry.workspaceId === undefined ? {} : { workspaceId: registry.workspaceId }),
    documentId: registry.documentId,
    graphId: registry.currentGraphId,
    ...(registry.principalScope === undefined ? {} : { principalScope: registry.principalScope }),
  });
}

export function cloneVersionGraphRegistry(registry: VersionGraphRegistry): VersionGraphRegistry {
  return Object.freeze({
    schemaVersion: registry.schemaVersion,
    ...(registry.workspaceId === undefined ? {} : { workspaceId: registry.workspaceId }),
    documentId: registry.documentId,
    ...(registry.principalScope === undefined ? {} : { principalScope: registry.principalScope }),
    currentGraphId: registry.currentGraphId,
    headRefName: registry.headRefName,
    rootCommitId: registry.rootCommitId,
    registryRevision: Object.freeze({ ...registry.registryRevision }),
    registryChecksum: Object.freeze({ ...registry.registryChecksum }),
    createdAt: registry.createdAt,
  });
}

export function normalizeVersionStoreString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${path} must be a string.`);
  }
  const normalized = value.normalize('NFC');
  if (normalized.length === 0 || utf8Encode(normalized).byteLength > 256) {
    throw new Error(`${path} must be non-empty and at most 256 UTF-8 bytes.`);
  }
  return normalized;
}

async function registryChecksumFor(payload: RegistryChecksumPayload): Promise<ObjectDigest> {
  const encoded = utf8Encode(
    `${VERSION_GRAPH_REGISTRY_CHECKSUM_DOMAIN}${canonicalJsonStringify(payload)}`,
  );
  return sha256Digest(encoded);
}

async function sha256Digest(bytes: Uint8Array): Promise<ObjectDigest> {
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    throw new Error('SHA-256 Web Crypto support is unavailable.');
  }
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', digestInput);
  return Object.freeze({ algorithm: 'sha256', digest: bytesToHex(new Uint8Array(digest)) });
}

type RegistryChecksumPayload = {
  readonly schemaVersion: typeof VERSION_GRAPH_REGISTRY_SCHEMA_VERSION;
  readonly workspaceId: string | null;
  readonly documentId: string;
  readonly principalScope: string | null;
  readonly currentGraphId: string;
  readonly headRefName: typeof VERSION_GRAPH_MAIN_REF;
  readonly rootCommitId: WorkbookCommitId;
  readonly createdAt: string;
};

type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

function canonicalJsonStringify(value: CanonicalJsonValue | unknown): string {
  const canonicalValue = normalizeCanonicalJsonValue(value, 'value');
  if (canonicalValue === null || typeof canonicalValue !== 'object') {
    return JSON.stringify(canonicalValue);
  }
  if (Array.isArray(canonicalValue)) {
    return `[${canonicalValue.map((item) => canonicalJsonStringify(item)).join(',')}]`;
  }
  return `{${Object.entries(canonicalValue)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, childValue]) => `${JSON.stringify(key)}:${canonicalJsonStringify(childValue)}`)
    .join(',')}}`;
}

function normalizeCanonicalJsonValue(value: unknown, path: string): CanonicalJsonValue {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} must be finite.`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((item, index) => normalizeCanonicalJsonValue(item, `${path}[${index}]`)),
    );
  }
  if (isPlainRecord(value)) {
    const normalized: Record<string, CanonicalJsonValue> = {};
    for (const [key, childValue] of Object.entries(value)) {
      if (childValue === undefined) continue;
      normalized[key] = normalizeCanonicalJsonValue(childValue, `${path}.${key}`);
    }
    return Object.freeze(normalized);
  }
  throw new Error(`${path} must be canonical JSON.`);
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string,
): void {
  const unsupportedKey = Object.keys(value).find((key) => !allowedKeys.includes(key));
  if (unsupportedKey) {
    throw new Error(`${path}.${unsupportedKey} is not supported.`);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

const textEncoder = new TextEncoder();

function utf8Encode(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
