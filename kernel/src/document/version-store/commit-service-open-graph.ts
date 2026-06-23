import {
  diagnosticsFromProviderError,
  retargetProviderDiagnostics,
} from './commit-service-diagnostics';
import type {
  VersionCommitServiceGraphOperation,
  VersionCommitServiceOpenVisibleGraphResult,
} from './commit-service-types';
import type { VersionStoreProvider } from './provider';
import { namespaceForRegistry } from './registry';

export async function openVisibleVersionGraph(
  provider: VersionStoreProvider,
  operation: VersionCommitServiceGraphOperation,
): Promise<VersionCommitServiceOpenVisibleGraphResult> {
  try {
    const registryRead = await provider.readGraphRegistry();
    if (registryRead.status !== 'ok') {
      return {
        ok: false,
        diagnostics: retargetProviderDiagnostics(registryRead.diagnostics, operation),
        retryable: registryRead.status === 'absent',
      };
    }

    const namespace = namespaceForRegistry(registryRead.registry);
    const graph = await provider.openGraph(namespace, provider.accessContext);
    return { ok: true, registry: registryRead.registry, namespace, graph };
  } catch (error) {
    return {
      ok: false,
      diagnostics: diagnosticsFromProviderError(error, operation, provider),
      retryable: true,
    };
  }
}
