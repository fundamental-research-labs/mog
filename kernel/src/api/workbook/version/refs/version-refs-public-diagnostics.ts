import type {
  VersionRef,
  VersionRefListResult,
  VersionRefMutationResult,
  VersionRefReadResult,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import { recoverabilityForBranchIssue } from './version-ref-diagnostics';
import { VERSION_MAIN_REF } from './version-refs-constants';
import {
  mapVersionRefLifecycleDiagnostic,
  mapVersionRefProviderExceptionDiagnostics,
  type VersionRefLifecycleOperation,
} from './version-refs-diagnostics';

export type VersionRefOperation = VersionRefLifecycleOperation;

export function mapBranchFailureDiagnostics(
  value: unknown,
  operation: VersionRefOperation,
): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [providerErrorDiagnostic(operation)];
  }
  return value.map((item) =>
    mapVersionRefLifecycleDiagnostic(item, operation, providerErrorDiagnostic(operation)),
  );
}

export function mapOptionalBranchDiagnostics(
  value: unknown,
  operation: VersionRefOperation,
): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) =>
    mapVersionRefLifecycleDiagnostic(item, operation, providerErrorDiagnostic(operation)),
  );
}

export function providerExceptionDiagnostics(
  error: unknown,
  operation: VersionRefOperation,
): readonly VersionStoreDiagnostic[] {
  return (
    mapVersionRefProviderExceptionDiagnostics(
      error,
      operation,
      providerErrorDiagnostic(operation),
    ) ?? [providerErrorDiagnostic(operation)]
  );
}

export function serviceUnavailableDiagnostic(
  operation: VersionRefOperation,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_GRAPH_UNINITIALIZED',
    operation,
    'No document-scoped version ref lifecycle service is attached; no ref state is fabricated.',
    { severity: 'warning', recoverability: 'unsupported' },
  );
}

export function writeUnavailableDiagnostic(operation: VersionRefOperation): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_REF_WRITE_UNAVAILABLE',
    operation,
    'No document-scoped public ref mutation service is attached; no ref was mutated.',
    {
      severity: 'warning',
      recoverability: 'unsupported',
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

export function protectedMainDiagnostic(operation: VersionRefOperation): VersionStoreDiagnostic {
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

export function invalidRefNameDiagnostic(operation: VersionRefOperation): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_INVALID_OPTIONS',
    operation,
    'The supplied VC-05 ref name is not public-safe.',
    {
      severity: 'error',
      recoverability: 'none',
      payload: { refName: 'redacted' },
      ...noWriteAttemptedForMutation(operation),
    },
  );
}

export function invalidCommitDiagnostic(
  operation: VersionRefOperation,
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
      ...noWriteAttemptedForMutation(operation),
    },
  );
}

export function invalidOptionsDiagnostic(
  operation: VersionRefOperation,
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
      ...noWriteAttemptedForMutation(operation),
    },
  );
}

export function danglingRefDiagnostic(operation: VersionRefOperation): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_DANGLING_REF',
    operation,
    'The requested public ref does not resolve to a live branch.',
    { severity: 'warning', recoverability: 'unsupported' },
  );
}

export function invalidPayloadDiagnostic(operation: VersionRefOperation): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_INVALID_COMMIT_PAYLOAD',
    operation,
    'The version ref lifecycle service returned an invalid public ref payload.',
    { severity: 'error', recoverability: 'repair' },
  );
}

export function providerErrorDiagnostic(operation: VersionRefOperation): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_PROVIDER_ERROR',
    operation,
    'The version ref lifecycle service failed before returning a usable public result.',
    { severity: 'error', recoverability: 'retry' },
  );
}

export function publicDiagnostic(
  issueCode: string,
  operation: VersionRefOperation,
  safeMessage: string,
  options: {
    readonly severity?: VersionStoreDiagnostic['severity'];
    readonly recoverability?: VersionStoreDiagnostic['recoverability'];
    readonly payload?: Readonly<Record<string, string | number | boolean | null>>;
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

export function noWriteAttemptedForMutation(
  operation: VersionRefOperation,
): { readonly mutationGuarantee: 'no-write-attempted' } | Record<string, never> {
  return isRefMutationOperation(operation) ? { mutationGuarantee: 'no-write-attempted' } : {};
}

export function degradedList(
  items: readonly VersionRef[],
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionRefListResult {
  return { status: 'degraded', items, diagnostics };
}

export function degradedMutation(
  ref: VersionRef | null,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionRefMutationResult {
  return { status: 'degraded', ref, diagnostics };
}

export function degradedRef(
  ref: VersionRef | null,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionRefReadResult {
  return { status: 'degraded', ref, diagnostics };
}

function isRefMutationOperation(operation: VersionRefOperation): boolean {
  return (
    operation === 'createBranch' ||
    operation === 'fastForwardBranch' ||
    operation === 'updateBranch' ||
    operation === 'deleteBranch' ||
    operation === 'deleteRef'
  );
}
