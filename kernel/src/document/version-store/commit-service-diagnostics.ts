import {
  VersionStoreProviderError,
  mapGraphDiagnostics,
  versionStoreDiagnostic,
  type VersionStoreDiagnostic,
  type VersionStoreProvider,
} from './provider';
import type { VersionCommitServiceGraphOperation } from './commit-service-types';

export function diagnosticsForGraphRead(
  diagnostics: readonly unknown[],
  operation: 'commitGraphWrite',
): readonly VersionStoreDiagnostic[] {
  if (diagnostics.length === 0) {
    return [
      versionStoreDiagnostic('VERSION_PROVIDER_FAILED', {
        operation,
        safeMessage: 'Version graph read failed before commit.',
        recoverability: 'retry',
        mutationGuarantee: 'no-write-attempted',
      }),
    ];
  }
  return mapCommitGraphDiagnostics(diagnostics as Parameters<typeof mapGraphDiagnostics>[0]);
}

export function mapCommitGraphDiagnostics(
  diagnostics: Parameters<typeof mapGraphDiagnostics>[0],
): readonly VersionStoreDiagnostic[] {
  return mapGraphDiagnostics(diagnostics, 'commitGraphWrite').map((diagnostic) =>
    diagnostic.code === 'VERSION_MISSING_DEPENDENCY'
      ? { ...diagnostic, recoverability: 'repair' as const }
      : diagnostic,
  );
}

export function isRetryableGraphWriteFailure(
  diagnostics: readonly Parameters<typeof mapGraphDiagnostics>[0][number][],
): boolean {
  return diagnostics.some(
    (diagnostic) =>
      diagnostic.code === 'VERSION_REF_CONFLICT' ||
      diagnostic.code === 'VERSION_GRAPH_CONFLICT' ||
      diagnostic.code === 'VERSION_OBJECT_STORE_FAILURE',
  );
}

export function diagnosticsFromProviderError(
  error: unknown,
  operation: VersionCommitServiceGraphOperation,
  provider: VersionStoreProvider,
): readonly VersionStoreDiagnostic[] {
  if (error instanceof VersionStoreProviderError) {
    return retargetProviderDiagnostics(error.diagnostics, operation);
  }
  if (operation === 'commitGraphWrite') {
    return [
      versionStoreDiagnostic('VERSION_PROVIDER_FAILED', {
        operation,
        documentScope: provider.documentScope,
        safeMessage: 'Version store provider failed before returning graph state.',
        recoverability: 'retry',
        mutationGuarantee: 'no-write-attempted',
      }),
    ];
  }
  return [
    versionStoreDiagnostic('VERSION_PROVIDER_FAILED', {
      operation: 'openGraph',
      documentScope: provider.documentScope,
      safeMessage: 'Version store provider failed before returning graph state.',
      recoverability: 'retry',
    }),
  ];
}

export function retargetProviderDiagnostics(
  diagnostics: readonly VersionStoreDiagnostic[],
  operation: VersionCommitServiceGraphOperation,
): readonly VersionStoreDiagnostic[] {
  if (operation !== 'commitGraphWrite') return diagnostics;
  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    operation,
    mutationGuarantee: diagnostic.mutationGuarantee ?? 'no-write-attempted',
  }));
}
