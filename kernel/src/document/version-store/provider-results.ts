import { VERSION_GRAPH_HEAD_REF, VERSION_GRAPH_MAIN_REF, type VersionGraphRef } from './graph';
import {
  cloneVersionGraphRegistry,
  type VersionDocumentScope,
  type VersionGraphRegistry,
} from './registry';
import type {
  VersionGraphInitializeResult,
  VersionGraphRegistryReadResult,
  VersionStoreDiagnostic,
  VersionStoreFailure,
  VersionStoreOperation,
} from './provider-types';
import { versionStoreDiagnostic } from './provider-diagnostics';

export function initializeSuccess(
  registry: VersionGraphRegistry,
  main: VersionGraphRef,
): Extract<VersionGraphInitializeResult, { status: 'success' }> {
  return {
    status: 'success',
    registry: cloneVersionGraphRegistry(registry),
    rootCommit: {
      id: registry.rootCommitId,
      refName: VERSION_GRAPH_MAIN_REF,
      resolvedFrom: VERSION_GRAPH_HEAD_REF,
      refRevision: main.revision,
    },
    initialHead: { ...main },
    symbolicHead: {
      name: VERSION_GRAPH_HEAD_REF,
      target: VERSION_GRAPH_MAIN_REF,
      revision: main.revision,
    },
    diagnostics: [],
  };
}

export function failedStoreResult(
  diagnostics: readonly VersionStoreDiagnostic[],
  mutationGuarantee: VersionStoreFailure['mutationGuarantee'],
  retryable = false,
): VersionStoreFailure {
  return {
    status: 'failed',
    diagnostics: Object.freeze([...diagnostics]),
    mutationGuarantee,
    retryable,
  };
}

export function registryRecordResult(
  kind: 'corrupt' | 'unsupported',
  operation: VersionStoreOperation,
  documentScope: VersionDocumentScope,
): Extract<VersionGraphRegistryReadResult, { status: 'corrupt' | 'unsupported' }> {
  const code = kind === 'corrupt' ? 'VERSION_CORRUPT_REGISTRY' : 'VERSION_UNSUPPORTED_REGISTRY';
  return {
    status: kind,
    registry: null,
    diagnostics: [
      versionStoreDiagnostic(code, {
        operation,
        documentScope,
        recoverability: kind === 'corrupt' ? 'repair' : 'unsupported',
        safeMessage:
          kind === 'corrupt'
            ? 'Version graph registry is corrupt and cannot be opened normally.'
            : 'Version graph registry schema is not supported by this provider.',
      }),
    ],
    mutationGuarantee: 'no-write-attempted',
  };
}
