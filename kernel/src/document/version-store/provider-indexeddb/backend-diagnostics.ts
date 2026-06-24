import type { VersionGraphStoreDiagnostic, VersionGraphWriteResult } from '../graph';
import type { VersionGraphNamespace, VersionObjectPutBatchResult } from '../object-store';
import type {
  VersionStoreDiagnostic,
  VersionStoreFailure,
  VersionStoreLifecycleState,
  VersionStoreOperation,
} from '../provider';
import {
  RefCasConflictError,
  failedGraphWrite,
  failedStoreResult,
  graphDiagnostic,
  versionStoreDiagnostic,
} from './internal';
import type { VersionDocumentScope } from '../registry';

export function indexedDbBackendLifecycleUnavailableDiagnostic(options: {
  readonly operation: VersionStoreOperation;
  readonly documentScope: VersionDocumentScope;
  readonly lifecycleState: VersionStoreLifecycleState;
}): VersionStoreDiagnostic {
  return versionStoreDiagnostic('VERSION_STORE_UNAVAILABLE', {
    operation: options.operation,
    documentScope: options.documentScope,
    recoverability: 'retry',
    lifecycleState: options.lifecycleState,
    safeMessage: 'Version store provider is closed or disposing.',
  });
}

export function indexedDbBackendLifecycleUnavailableFailure(options: {
  readonly operation: VersionStoreOperation;
  readonly documentScope: VersionDocumentScope;
  readonly lifecycleState: VersionStoreLifecycleState;
}): VersionStoreFailure {
  return failedStoreResult(
    [indexedDbBackendLifecycleUnavailableDiagnostic(options)],
    'no-write-attempted',
    true,
  );
}

export function indexedDbBackendReadOnlyFailure(options: {
  readonly operation: VersionStoreOperation;
  readonly documentScope: VersionDocumentScope;
}): VersionStoreFailure {
  return failedStoreResult(
    [
      versionStoreDiagnostic('VERSION_STORE_READ_ONLY', {
        operation: options.operation,
        documentScope: options.documentScope,
        safeMessage: 'Version store provider is opened read-only.',
      }),
    ],
    'no-write-attempted',
  );
}

export function failedIndexedDbBackendObjectBatch(
  message: string,
  details: Readonly<Record<string, string | number | boolean | null>>,
): VersionObjectPutBatchResult {
  return {
    status: 'failed',
    diagnostics: [
      {
        code: 'VERSION_STORE_UNAVAILABLE',
        severity: 'error',
        message,
        details,
      },
    ],
    mutationGuarantee: 'no-objects-written',
  };
}

export function failedIndexedDbBackendMissingRefCasMetadata(options: {
  readonly operation: 'commit' | 'mergeCommit' | 'fastForwardRef';
  readonly namespace: VersionGraphNamespace;
  readonly refName: string;
}): VersionGraphWriteResult {
  return failedGraphWrite(
    [
      graphDiagnostic(
        'VERSION_INVALID_OPTIONS',
        'IndexedDB graph commit is missing target ref CAS metadata.',
        {
          refName: options.refName,
          operation: options.operation,
          namespace: options.namespace,
          details: { missingField: 'expectedTargetRefVersion' },
        },
      ),
    ],
    'no-write-attempted',
  );
}

export function failedIndexedDbBackendRefCasConflict(options: {
  readonly error: RefCasConflictError;
  readonly operation: 'commit' | 'mergeCommit' | 'fastForwardRef';
  readonly namespace: VersionGraphNamespace;
  readonly refName: string;
}): VersionGraphWriteResult {
  return failedGraphWrite(
    [
      graphDiagnostic('VERSION_REF_CONFLICT', 'Graph ref no longer matches expected head.', {
        refName: options.refName,
        operation: options.operation,
        namespace: options.namespace,
        ...(options.error.actualHead ? { commitId: options.error.actualHead } : {}),
        details: {
          expectedHead: options.error.expectedHead ?? null,
          actualHead: options.error.actualHead ?? null,
          expectedRefVersion: options.error.expectedRefVersion.value,
          actualRefVersion: options.error.actualRefVersion?.value ?? null,
          actualRefState: options.error.actualRefState,
        },
      }),
    ],
    'no-write-attempted',
  );
}

export function failedIndexedDbBackendGraphCommit(options: {
  readonly operation: VersionGraphStoreDiagnostic['operation'];
  readonly namespace: VersionGraphNamespace;
  readonly cause: string;
}): VersionGraphWriteResult {
  return failedGraphWrite(
    [
      graphDiagnostic('VERSION_OBJECT_STORE_FAILURE', 'IndexedDB graph commit failed.', {
        operation: options.operation,
        namespace: options.namespace,
        details: { cause: options.cause },
      }),
    ],
    'ref-not-mutated',
  );
}
