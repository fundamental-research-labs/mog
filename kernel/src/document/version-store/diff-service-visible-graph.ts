import { diagnostic, type DiffServiceDiagnostic } from './diff-service-diagnostics';
import {
  objectStoreFromGraph,
  type VersionObjectRecordReader,
} from './diff-service-object-diagnostics';
import {
  VersionStoreProviderError,
  type VersionGraphStore,
  type VersionStoreDiagnostic,
  type VersionStoreProvider,
} from './provider';
import { namespaceForRegistry } from './registry';

export async function openVisibleDiffGraph(provider: VersionStoreProvider): Promise<
  | {
      readonly ok: true;
      readonly graph: VersionGraphStore;
      readonly objectStore: VersionObjectRecordReader;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly (VersionStoreDiagnostic | DiffServiceDiagnostic)[];
    }
> {
  try {
    const registryRead = await provider.readGraphRegistry();
    if (registryRead.status !== 'ok') {
      return { ok: false, diagnostics: registryRead.diagnostics };
    }

    const graph = await provider.openGraph(
      namespaceForRegistry(registryRead.registry),
      provider.accessContext,
    );
    const objectStore = objectStoreFromGraph(graph);
    if (!objectStore) {
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            'VERSION_UNMATERIALIZABLE_COMMIT',
            'The visible version graph does not expose object reads for semantic diff.',
          ),
        ],
      };
    }
    return { ok: true, graph, objectStore };
  } catch (error) {
    if (error instanceof VersionStoreProviderError) {
      return { ok: false, diagnostics: error.diagnostics };
    }
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'VERSION_PROVIDER_ERROR',
          'Version store provider failed before returning graph state.',
          {
            recoverability: 'retry',
          },
        ),
      ],
    };
  }
}
