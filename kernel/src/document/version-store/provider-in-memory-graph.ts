import type { InMemoryVersionGraphStore } from './graph';
import {
  normalizeVersionGraphNamespace,
  versionGraphNamespaceKey,
  type VersionGraphNamespace,
} from './object-store';
import { versionStoreDiagnostic } from './provider-diagnostics';
import { VersionStoreProviderError } from './provider-error';
import { registryRecordResult } from './provider-results';
import type { VersionAccessContext } from './provider-types';
import { namespaceForRegistry } from './registry';
import { assertInMemoryProviderAvailable } from './provider-in-memory-availability';
import type { InMemoryVersionStoreProviderState } from './provider-in-memory-types';

export async function openInMemoryGraph(
  state: InMemoryVersionStoreProviderState,
  namespaceInput: VersionGraphNamespace,
  _accessContext: VersionAccessContext = state.accessContext,
): Promise<InMemoryVersionGraphStore> {
  assertInMemoryProviderAvailable(state, 'openGraph');

  let namespace: VersionGraphNamespace;
  try {
    namespace = normalizeVersionGraphNamespace(namespaceInput);
  } catch {
    throw new VersionStoreProviderError(
      versionStoreDiagnostic('VERSION_WRONG_NAMESPACE', {
        operation: 'openGraph',
        documentScope: state.documentScope,
        safeMessage: 'Requested version graph namespace is invalid.',
      }),
    );
  }

  const registryRecord = state.backend.readRegistryRecord(state.documentScope);
  if (!registryRecord) {
    throw new VersionStoreProviderError(
      versionStoreDiagnostic('VERSION_GRAPH_UNINITIALIZED', {
        operation: 'openGraph',
        documentScope: state.documentScope,
        namespace,
        safeMessage: 'Version graph registry has not been initialized for this document.',
      }),
    );
  }
  if (registryRecord.kind !== 'valid') {
    throw new VersionStoreProviderError(
      registryRecordResult(registryRecord.kind, 'openGraph', state.documentScope).diagnostics[0],
    );
  }

  const expectedNamespace = namespaceForRegistry(registryRecord.registry);
  if (versionGraphNamespaceKey(namespace) !== versionGraphNamespaceKey(expectedNamespace)) {
    throw new VersionStoreProviderError(
      versionStoreDiagnostic('VERSION_WRONG_NAMESPACE', {
        operation: 'openGraph',
        documentScope: state.documentScope,
        namespace,
        safeMessage: 'Requested graph namespace does not match the visible graph registry.',
      }),
    );
  }

  const graph = state.backend.getGraph(namespace);
  if (!graph) {
    throw new VersionStoreProviderError(
      versionStoreDiagnostic('VERSION_STORE_UNAVAILABLE', {
        operation: 'openGraph',
        documentScope: state.documentScope,
        namespace,
        recoverability: 'retry',
        safeMessage: 'Visible graph registry could not be opened by this provider.',
      }),
    );
  }

  return graph;
}
