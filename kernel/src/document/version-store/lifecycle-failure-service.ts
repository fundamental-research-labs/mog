import {
  versionStoreDiagnostic,
  type VersionStoreDiagnostic,
  type VersionStoreProvider,
} from './provider';
import type { VersionStoreLifecycleFailureReadService } from './lifecycle-types';

export function createLifecycleFailureReadService(
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionStoreLifecycleFailureReadService {
  const frozenDiagnostics = Object.freeze([...diagnostics]);
  return {
    async readHead() {
      return { status: 'degraded', head: null, diagnostics: frozenDiagnostics };
    },
    async readRef() {
      return { status: 'degraded', ref: null, diagnostics: frozenDiagnostics };
    },
    async listCommits() {
      return { status: 'failed', diagnostics: frozenDiagnostics };
    },
    async commit() {
      return {
        status: 'failed',
        diagnostics: frozenDiagnostics,
        mutationGuarantee: 'no-write-attempted',
        retryable: false,
      };
    },
    async mergeCommit() {
      return {
        status: 'failed',
        diagnostics: frozenDiagnostics,
        mutationGuarantee: 'no-write-attempted',
        retryable: false,
      };
    },
  };
}

export function diagnosticsForProviderScopeMismatch(
  documentId: string,
  provider: VersionStoreProvider,
): readonly VersionStoreDiagnostic[] {
  if (provider.documentScope.documentId === documentId) return [];
  return [
    versionStoreDiagnostic('VERSION_WRONG_NAMESPACE', {
      operation: 'openGraph',
      documentScope: { documentId },
      safeMessage: 'Selected version store provider does not match this document scope.',
      mutationGuarantee: 'no-write-attempted',
    }),
  ];
}
