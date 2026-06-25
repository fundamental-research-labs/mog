import {
  VERSION_GRAPH_REGISTRY_SCHEMA_VERSION,
  cloneVersionGraphRegistry,
  createVersionGraphRegistry,
  normalizeVersionDocumentScope,
  normalizeVersionStoreString,
  versionDocumentScopeKey,
  type VersionDocumentScope,
  type VersionGraphRegistry,
} from '../registry';
import { parseWorkbookCommitId } from '../object-digest';
import { hasOnlyKeys, isPlainRecord } from './internal-json';
import type { RegistryRecordRead, StoredRegistryEnvelope } from './internal-records';

export async function decodeRegistryEnvelope(
  value: unknown,
  expectedScope: VersionDocumentScope,
): Promise<Exclude<RegistryRecordRead, { status: 'absent' }>> {
  if (!isPlainRecord(value)) return { status: 'corrupt' };
  if (value.schemaVersion !== 1) {
    return typeof value.schemaVersion === 'number'
      ? { status: 'unsupported' }
      : { status: 'corrupt' };
  }
  if (!hasOnlyKeys(value, ['schemaVersion', 'registry'])) return { status: 'corrupt' };

  const registry = value.registry;
  if (!isPlainRecord(registry)) return { status: 'corrupt' };
  if (registry.schemaVersion !== VERSION_GRAPH_REGISTRY_SCHEMA_VERSION) {
    return typeof registry.schemaVersion === 'number'
      ? { status: 'unsupported' }
      : { status: 'corrupt' };
  }
  if (
    !hasOnlyKeys(registry, [
      'schemaVersion',
      'workspaceId',
      'documentId',
      'principalScope',
      'currentGraphId',
      'headRefName',
      'rootCommitId',
      'registryRevision',
      'registryChecksum',
      'createdAt',
    ])
  ) {
    return { status: 'corrupt' };
  }

  try {
    const documentScope = normalizeVersionDocumentScope({
      ...(registry.workspaceId === undefined
        ? {}
        : { workspaceId: registry.workspaceId as string }),
      documentId: registry.documentId as string,
      ...(registry.principalScope === undefined
        ? {}
        : { principalScope: registry.principalScope as string }),
    });
    if (versionDocumentScopeKey(documentScope) !== versionDocumentScopeKey(expectedScope)) {
      return { status: 'corrupt' };
    }
    const expected = await createVersionGraphRegistry({
      documentScope,
      graphId: normalizeVersionStoreString(registry.currentGraphId, 'registry.currentGraphId'),
      rootCommitId: parseWorkbookCommitId(registry.rootCommitId),
      createdAt: normalizeVersionStoreString(registry.createdAt, 'registry.createdAt'),
    });
    const candidate = cloneVersionGraphRegistry(registry as unknown as VersionGraphRegistry);
    return registriesEqual(candidate, expected)
      ? { status: 'valid', registry: candidate }
      : { status: 'corrupt' };
  } catch {
    return { status: 'corrupt' };
  }
}

export function registryEnvelope(registry: VersionGraphRegistry): StoredRegistryEnvelope {
  return { schemaVersion: 1, registry: cloneVersionGraphRegistry(registry) };
}

function registriesEqual(left: VersionGraphRegistry, right: VersionGraphRegistry): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.workspaceId === right.workspaceId &&
    left.documentId === right.documentId &&
    left.principalScope === right.principalScope &&
    left.currentGraphId === right.currentGraphId &&
    left.headRefName === right.headRefName &&
    left.rootCommitId === right.rootCommitId &&
    left.registryRevision.kind === right.registryRevision.kind &&
    left.registryRevision.value === right.registryRevision.value &&
    left.registryChecksum.algorithm === right.registryChecksum.algorithm &&
    left.registryChecksum.digest === right.registryChecksum.digest &&
    left.createdAt === right.createdAt
  );
}
