import {
  normalizeVersionGraphNamespace,
  versionGraphNamespaceKey,
  type VersionGraphNamespace,
} from '../object-store';
import {
  type VersionAccessContext,
  type VersionGraphStore,
  VersionStoreProviderError,
} from '../provider';
import { namespaceForRegistry, type VersionDocumentScope } from '../registry';
import { IndexedDbVersionGraphStore } from './backend-graph-store';
import {
  mapGraphDiagnostics,
  normalizeVersionAccessContext,
  registryRecordResult,
  versionStoreDiagnostic,
  type RegistryRecordRead,
} from './internal';
import { graphLoadDiagnostic, loadGraphSnapshot } from '../provider-indexeddb-reload';

export async function openIndexedDbBackendGraph(options: {
  readonly namespaceInput: VersionGraphNamespace;
  readonly accessContext: VersionAccessContext;
  readonly documentScope: VersionDocumentScope;
  readonly getDb: () => Promise<IDBDatabase>;
  readonly readRegistryRecord: () => Promise<RegistryRecordRead>;
}): Promise<VersionGraphStore> {
  let namespace: VersionGraphNamespace;
  try {
    namespace = normalizeVersionGraphNamespace(options.namespaceInput);
  } catch {
    throw new VersionStoreProviderError(
      versionStoreDiagnostic('VERSION_WRONG_NAMESPACE', {
        operation: 'openGraph',
        documentScope: options.documentScope,
        safeMessage: 'Requested version graph namespace is invalid.',
      }),
    );
  }

  const registryRecord = await options.readRegistryRecord();
  if (registryRecord.status === 'absent') {
    throw new VersionStoreProviderError(
      versionStoreDiagnostic('VERSION_GRAPH_UNINITIALIZED', {
        operation: 'openGraph',
        documentScope: options.documentScope,
        namespace,
        safeMessage: 'Version graph registry has not been initialized for this document.',
      }),
    );
  }
  if (registryRecord.status === 'corrupt' || registryRecord.status === 'unsupported') {
    throw new VersionStoreProviderError(
      registryRecordResult(registryRecord.status, 'openGraph', options.documentScope)
        .diagnostics[0],
    );
  }

  const expectedNamespace = namespaceForRegistry(registryRecord.registry);
  if (versionGraphNamespaceKey(namespace) !== versionGraphNamespaceKey(expectedNamespace)) {
    throw new VersionStoreProviderError(
      versionStoreDiagnostic('VERSION_WRONG_NAMESPACE', {
        operation: 'openGraph',
        documentScope: options.documentScope,
        namespace,
        safeMessage: 'Requested graph namespace does not match the visible graph registry.',
      }),
    );
  }

  try {
    await loadGraphSnapshot(await options.getDb(), namespace, options.documentScope);
  } catch (error) {
    throw new VersionStoreProviderError(
      mapGraphDiagnostics([graphLoadDiagnostic(error, namespace, 'readHead')], 'openGraph')[0],
    );
  }

  return new IndexedDbVersionGraphStore({
    namespace,
    documentScope: options.documentScope,
    accessContext: normalizeVersionAccessContext(options.accessContext),
    getDb: options.getDb,
  });
}
