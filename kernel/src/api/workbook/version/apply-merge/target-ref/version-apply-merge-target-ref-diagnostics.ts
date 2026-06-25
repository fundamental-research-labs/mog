import type {
  VersionMainRefName,
  VersionRefName,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import { mapPublicApplyTargetRef } from './version-apply-merge-target-ref-names';
import { isRecord } from './version-apply-merge-target-ref-utils';
import { mapPublicVersionDiagnosticRefName } from '../../version-public-ref-selectors';

type MissingRevisionReason =
  | 'missingExpectedTargetRefRevision'
  | 'missingExpectedSymbolicHeadRevision'
  | 'missingTargetRefRevision'
  | 'missingSymbolicHeadRevision';

export function mapProviderDiagnostics(
  diagnostics: readonly unknown[],
): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) return [providerErrorDiagnostic()];
  return diagnostics.map((diagnostic) => {
    if (!isRecord(diagnostic)) return providerErrorDiagnostic();
    return publicDiagnostic(
      safeProviderIssueCode(diagnostic.issueCode ?? diagnostic.code),
      'Version applyMerge target-ref CAS validation failed.',
      {
        recoverability: isRecoverability(diagnostic.recoverability)
          ? diagnostic.recoverability
          : 'retry',
        mutationGuarantee: 'no-write-attempted',
      },
    );
  });
}

export function missingRefRevisionDiagnostic(
  reason: MissingRevisionReason,
  targetRef?: VersionMainRefName | VersionRefName,
): VersionStoreDiagnostic {
  const expectedProofMissing =
    reason === 'missingExpectedTargetRefRevision' ||
    reason === 'missingExpectedSymbolicHeadRevision';
  return publicDiagnostic(
    expectedProofMissing ? 'VERSION_INVALID_OPTIONS' : 'VERSION_PROVIDER_FAILED',
    safeMissingRevisionMessage(reason),
    {
      recoverability: expectedProofMissing ? 'none' : 'retry',
      payload: {
        reason,
        ...(targetRef ? { targetRef: safePublicRefPayload(targetRef) } : {}),
      },
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

export function refConflictDiagnostic(
  safeMessage: string,
  payload: VersionStoreDiagnostic['payload'],
  mutationGuarantee: NonNullable<VersionStoreDiagnostic['mutationGuarantee']>,
): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_REF_CONFLICT', safeMessage, {
    recoverability: 'retry',
    payload,
    mutationGuarantee,
  });
}

export function providerErrorDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_PROVIDER_FAILED',
    'Version applyMerge target-ref CAS validation failed.',
    { recoverability: 'retry', mutationGuarantee: 'no-write-attempted' },
  );
}

export function safePublicRefPayload(value: unknown): string {
  return safePublicRefName(value) ?? 'redacted';
}

export function redactedRefPayload(_value: unknown): string {
  return 'redacted';
}

function safeMissingRevisionMessage(reason: MissingRevisionReason): string {
  switch (reason) {
    case 'missingExpectedTargetRefRevision':
      return 'expectedTargetHead.revision is required for applyMerge CAS validation.';
    case 'missingExpectedSymbolicHeadRevision':
      return 'expectedTargetHead.symbolicHeadRevision is invalid for applyMerge CAS validation.';
    case 'missingTargetRefRevision':
      return 'The target ref revision is unavailable for applyMerge CAS validation.';
    case 'missingSymbolicHeadRevision':
      return 'The symbolic HEAD revision is unavailable for applyMerge CAS validation.';
  }
}

function publicDiagnostic(
  issueCode: string,
  safeMessage: string,
  options: {
    readonly recoverability?: VersionStoreDiagnostic['recoverability'];
    readonly payload?: VersionStoreDiagnostic['payload'];
    readonly mutationGuarantee?: VersionStoreDiagnostic['mutationGuarantee'];
  } = {},
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity: 'error',
    recoverability: options.recoverability ?? 'none',
    messageTemplateId: `version.applyMerge.${issueCode}`,
    safeMessage,
    ...(options.payload ? { payload: { operation: 'applyMerge', ...options.payload } } : {}),
    redacted: true,
    mutationGuarantee: options.mutationGuarantee ?? 'no-write-attempted',
  };
}

function safePublicRefName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return mapPublicVersionDiagnosticRefName(value);
}

function isRecoverability(value: unknown): value is VersionStoreDiagnostic['recoverability'] {
  return value === 'retry' || value === 'repair' || value === 'unsupported' || value === 'none';
}

function safeProviderIssueCode(value: unknown): string {
  return typeof value === 'string' && /^VERSION_[A-Z0-9_]+$/.test(value)
    ? value
    : 'VERSION_PROVIDER_FAILED';
}
