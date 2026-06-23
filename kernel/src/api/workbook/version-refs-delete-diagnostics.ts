import type {
  VersionDiagnosticPublicPayload,
  VersionRecordRevision,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import {
  recoverabilityForBranchIssue,
  safeBranchDiagnosticToken,
  safeMessageForBranchIssue,
} from './version-ref-diagnostics';
import {
  mapVersionRefLifecycleDiagnostic,
  mapVersionRefProviderExceptionDiagnostics,
} from './version-refs-diagnostics';
import {
  isDeleteOperation,
  isRecord,
  publicRevisionToken,
  VERSION_MAIN_REF,
  type DeleteRefOperation,
} from './version-refs-delete-types';

export { safeBranchDiagnosticToken };

export function mapBranchFailureDiagnostics(
  value: unknown,
  operation: DeleteRefOperation,
): readonly VersionStoreDiagnostic[] {
  const diagnostics = diagnosticsFromLifecycleFailure(value);
  if (diagnostics.length === 0) return [providerErrorDiagnostic(operation)];
  return diagnostics.map((item) => mapBranchDiagnostic(item, operation));
}

export function providerExceptionDiagnostics(
  error: unknown,
  operation: DeleteRefOperation,
): readonly VersionStoreDiagnostic[] {
  return (
    mapVersionRefProviderExceptionDiagnostics(
      error,
      operation,
      providerErrorDiagnostic(operation),
    ) ?? [providerErrorDiagnostic(operation)]
  );
}

export function mapPreflightBranchFailureDiagnostics(
  value: unknown,
  operation: DeleteRefOperation,
): readonly VersionStoreDiagnostic[] {
  return mapBranchFailureDiagnostics(value, operation).map(withNoWriteGuarantee);
}

export function mapGraphFailureDiagnostics(
  value: unknown,
  operation: DeleteRefOperation,
): readonly VersionStoreDiagnostic[] {
  const diagnostics = diagnosticsFromLifecycleFailure(value);
  if (diagnostics.length === 0) return [preflightReadFailedDiagnostic(operation, 'ref')];
  return diagnostics.map((item) => mapGraphDiagnostic(item, operation));
}

export function deleteUnsupportedDiagnostic(operation: DeleteRefOperation): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_REF_WRITE_UNAVAILABLE',
    operation,
    'Public ref deletion is unsupported until a document-scoped tombstone-safe branch service is attached.',
    {
      severity: 'warning',
      recoverability: 'unsupported',
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

export function activeRefDeleteDiagnostic(operation: DeleteRefOperation): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_REF_WRITE_UNAVAILABLE',
    operation,
    'The active public ref cannot be deleted before switching the workbook to another ref.',
    {
      severity: 'error',
      recoverability: 'unsupported',
      payload: { operation, issue: safeBranchDiagnosticToken('issue', 'activeBranchDelete') },
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

export function lastLiveRefDiagnostic(operation: DeleteRefOperation): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_REF_WRITE_UNAVAILABLE',
    operation,
    'The last live public ref cannot be deleted through this public lifecycle facade.',
    {
      severity: 'error',
      recoverability: 'unsupported',
      payload: { operation, issue: 'lastLiveRef' },
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

export function staleDeleteRefDiagnostic(
  operation: DeleteRefOperation,
  conflict: 'expectedHeadMismatch' | 'expectedRefVersionMismatch',
  actual: {
    readonly commitId: WorkbookCommitId;
    readonly revision: VersionRecordRevision;
  },
): VersionStoreDiagnostic {
  const payload: Record<string, string | number | boolean | null> = {
    operation,
    actualHead: actual.commitId,
    conflict: safeBranchDiagnosticToken('conflict', conflict),
  };
  const actualRefRevision = publicRevisionToken(actual.revision);
  if (actualRefRevision) payload.actualRefRevision = actualRefRevision;
  return publicDiagnostic(
    'VERSION_REF_CONFLICT',
    operation,
    safeMessageForBranchIssue('VERSION_REF_CONFLICT', operation),
    {
      severity: 'error',
      recoverability: 'retry',
      payload,
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

export function danglingRefDiagnostic(operation: DeleteRefOperation): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_DANGLING_REF',
    operation,
    safeMessageForBranchIssue('VERSION_DANGLING_REF', operation),
    {
      severity: 'error',
      recoverability: 'unsupported',
      payload: { operation },
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

export function preflightReadFailedDiagnostic(
  operation: DeleteRefOperation,
  phase: string,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_PROVIDER_ERROR',
    operation,
    'The version ref lifecycle service failed during delete preflight.',
    {
      severity: 'error',
      recoverability: 'retry',
      payload: { operation, phase },
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

export function preflightInvalidPayloadDiagnostic(
  operation: DeleteRefOperation,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_INVALID_COMMIT_PAYLOAD',
    operation,
    'The version ref lifecycle service returned an invalid public ref payload.',
    {
      severity: 'error',
      recoverability: 'repair',
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

export function protectedMainDiagnostic(operation: DeleteRefOperation): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_PERMISSION_DENIED',
    operation,
    'The protected main branch cannot be mutated through this public lifecycle facade.',
    {
      severity: 'error',
      recoverability: 'unsupported',
      payload: { refName: VERSION_MAIN_REF },
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

export function protectedRefDiagnostic(operation: DeleteRefOperation): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_PERMISSION_DENIED',
    operation,
    'The requested public ref is protected and cannot be deleted.',
    {
      severity: 'error',
      recoverability: 'unsupported',
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

export function invalidRefNameDiagnostic(
  operation: DeleteRefOperation | 'readRef',
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_INVALID_OPTIONS',
    operation,
    'The supplied VC-05 ref name is not public-safe.',
    {
      severity: 'error',
      recoverability: 'none',
      payload: { refName: 'redacted' },
      ...(isDeleteOperation(operation) ? { mutationGuarantee: 'no-write-attempted' as const } : {}),
    },
  );
}

export function invalidCommitDiagnostic(
  operation: DeleteRefOperation,
  option: string,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_INVALID_COMMIT_ID',
    operation,
    'The supplied commit id is invalid.',
    {
      severity: 'error',
      recoverability: 'none',
      payload: { option },
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

export function invalidOptionsDiagnostic(
  operation: DeleteRefOperation,
  option: string,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_INVALID_OPTIONS',
    operation,
    'The version ref lifecycle options are invalid for this method.',
    {
      severity: 'error',
      recoverability: 'none',
      payload: { option },
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

export function invalidPayloadDiagnostic(operation: DeleteRefOperation): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_INVALID_COMMIT_PAYLOAD',
    operation,
    'The version ref lifecycle service returned an invalid public ref payload.',
    { severity: 'error', recoverability: 'repair' },
  );
}

export function providerErrorDiagnostic(operation: DeleteRefOperation): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_PROVIDER_ERROR',
    operation,
    'The version ref lifecycle service failed before returning a usable public result.',
    { severity: 'error', recoverability: 'retry' },
  );
}

export function publicDiagnostic(
  issueCode: string,
  operation: DeleteRefOperation | 'readRef',
  safeMessage: string,
  options: {
    readonly severity?: VersionStoreDiagnostic['severity'];
    readonly recoverability?: VersionStoreDiagnostic['recoverability'];
    readonly payload?: VersionDiagnosticPublicPayload;
    readonly mutationGuarantee?: VersionStoreDiagnostic['mutationGuarantee'];
  } = {},
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity: options.severity ?? 'error',
    recoverability: options.recoverability ?? recoverabilityForBranchIssue(issueCode),
    messageTemplateId: `version.${operation}.${issueCode}`,
    safeMessage,
    ...(options.payload ? { payload: options.payload } : {}),
    redacted: true,
    ...(options.mutationGuarantee ? { mutationGuarantee: options.mutationGuarantee } : {}),
  };
}

function mapBranchDiagnostic(
  value: unknown,
  operation: DeleteRefOperation,
): VersionStoreDiagnostic {
  return mapVersionRefLifecycleDiagnostic(value, operation, providerErrorDiagnostic(operation));
}

function mapGraphDiagnostic(value: unknown, operation: DeleteRefOperation): VersionStoreDiagnostic {
  if (!isRecord(value)) return preflightReadFailedDiagnostic(operation, 'ref');
  const rawCode =
    typeof value.issueCode === 'string'
      ? value.issueCode
      : typeof value.code === 'string'
        ? value.code
        : 'VERSION_PROVIDER_ERROR';
  const issueCode =
    rawCode === 'VERSION_PERMISSION_DENIED'
      ? 'VERSION_PERMISSION_DENIED'
      : rawCode === 'VERSION_REF_CONFLICT'
        ? 'VERSION_REF_CONFLICT'
        : rawCode === 'VERSION_INVALID_COMMIT_ID'
          ? 'VERSION_INVALID_COMMIT_ID'
          : rawCode === 'VERSION_INVALID_OPTIONS' || rawCode === 'VERSION_DANGLING_REF'
            ? 'VERSION_DANGLING_REF'
            : 'VERSION_PROVIDER_ERROR';
  return publicDiagnostic(issueCode, operation, safeMessageForBranchIssue(issueCode, operation), {
    severity: value.severity === 'warning' || value.severity === 'info' ? value.severity : 'error',
    recoverability: recoverabilityForBranchIssue(issueCode),
    payload: { operation },
    mutationGuarantee: 'no-write-attempted',
  });
}

function withNoWriteGuarantee(diagnostic: VersionStoreDiagnostic): VersionStoreDiagnostic {
  return diagnostic.mutationGuarantee
    ? diagnostic
    : { ...diagnostic, mutationGuarantee: 'no-write-attempted' as const };
}

function diagnosticsFromLifecycleFailure(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  if (Array.isArray(value.diagnostics) && value.diagnostics.length > 0) return value.diagnostics;
  if (
    isRecord(value.error) &&
    Array.isArray(value.error.diagnostics) &&
    value.error.diagnostics.length > 0
  ) {
    return value.error.diagnostics;
  }
  if (Array.isArray(value.diagnostics)) return value.diagnostics;
  if (isRecord(value.error) && Array.isArray(value.error.diagnostics))
    return value.error.diagnostics;
  return typeof value.code === 'string' || typeof value.issueCode === 'string' ? [value] : [];
}
