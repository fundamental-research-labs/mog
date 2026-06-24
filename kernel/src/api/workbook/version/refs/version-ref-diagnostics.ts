import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

const NO_WRITE_ATTEMPTED_BRANCH_DIAGNOSTIC_CODES = new Set([
  'casConflict',
  'expectedHeadMismatch',
  'expectedRefVersionMismatch',
  'refAlreadyExists',
  'refNotFound',
  'refTombstoned',
  'invalidCommitId',
  'invalidRefName',
  'invalidRefPrefix',
  'invalidRefVersion',
  'activeRef',
  'lastLiveRef',
  'permissionDenied',
  'protectedRef',
  'reservedNamespace',
  'unsupportedDetachedHead',
  'unsupportedRefMetadataMutation',
  'unsupportedRefOption',
  'VERSION_PERMISSION_DENIED',
]);
const SAFE_BRANCH_DIAGNOSTIC_ISSUES = new Set([
  'activeBranchDelete',
  'containsControl',
  'containsDotDot',
  'containsPercent',
  'containsUppercase',
  'containsWhitespace',
  'empty',
  'emptySegment',
  'invalidFormat',
  'leadingSlash',
  'lockSegment',
  'nonAscii',
  'notString',
  'providerDenied',
  'reservedMainPrefix',
  'reservedRefsPrefix',
  'reservedSymbolicHead',
  'reservedDetached',
  'reservedSystemRef',
  'segmentEndsWithLock',
  'tooLong',
  'trailingSlash',
]);
const SAFE_BRANCH_DIAGNOSTIC_OPTIONS = new Set(['expectedOldCommitId', 'expectedRefVersion']);
const SAFE_BRANCH_DIAGNOSTIC_CONFLICTS = new Set([
  'expectedHeadMismatch',
  'expectedPreviousRefIncarnationIdMismatch',
  'expectedRefVersionMismatch',
  'refAlreadyExists',
  'refTombstoned',
]);

export type BranchDiagnosticTokenKind = 'conflict' | 'issue' | 'option';

export function branchDiagnosticMutationGuarantee(
  code: string,
  details: unknown,
): VersionStoreDiagnostic['mutationGuarantee'] | undefined {
  const explicit = isRecord(details)
    ? toPublicMutationGuarantee(details.mutationGuarantee)
    : undefined;
  if (explicit) return explicit;
  return NO_WRITE_ATTEMPTED_BRANCH_DIAGNOSTIC_CODES.has(code) ? 'no-write-attempted' : undefined;
}

export function issueCodeForBranchDiagnostic(code: string): string {
  switch (code) {
    case 'casConflict':
    case 'expectedHeadMismatch':
    case 'expectedRefVersionMismatch':
    case 'refAlreadyExists':
      return 'VERSION_REF_CONFLICT';
    case 'refNotFound':
    case 'refTombstoned':
      return 'VERSION_DANGLING_REF';
    case 'invalidCommitId':
      return 'VERSION_INVALID_COMMIT_ID';
    case 'protectedRef':
    case 'permissionDenied':
    case 'reservedNamespace':
    case 'unsupportedDetachedHead':
    case 'VERSION_PERMISSION_DENIED':
      return 'VERSION_PERMISSION_DENIED';
    case 'unsupportedRefOption':
    case 'unsupportedRefMetadataMutation':
    case 'versionCapabilityDisabled':
    case 'activeRef':
    case 'lastLiveRef':
      return 'VERSION_REF_WRITE_UNAVAILABLE';
    default:
      return 'VERSION_INVALID_OPTIONS';
  }
}

export function safeMessageForBranchIssue(issueCode: string, operation: string): string {
  switch (issueCode) {
    case 'VERSION_REF_CONFLICT':
      return 'The public ref changed while the lifecycle operation was in progress.';
    case 'VERSION_DANGLING_REF':
      return 'The requested public ref does not resolve to a live branch.';
    case 'VERSION_INVALID_OPTIONS':
      return 'The version ref lifecycle options are invalid for this method.';
    case 'VERSION_INVALID_COMMIT_ID':
      return 'The supplied commit id is invalid.';
    case 'VERSION_PERMISSION_DENIED':
      return 'The requested ref lifecycle operation is not authorized in this public slice.';
    case 'VERSION_REF_WRITE_UNAVAILABLE':
      return 'The requested ref lifecycle mutation is not supported by the attached public service.';
    default:
      return `The version ref lifecycle service could not complete ${operation}.`;
  }
}

export function recoverabilityForBranchIssue(
  issueCode: string,
): VersionStoreDiagnostic['recoverability'] {
  switch (issueCode) {
    case 'VERSION_REF_CONFLICT':
    case 'VERSION_PROVIDER_ERROR':
      return 'retry';
    case 'VERSION_DANGLING_REF':
    case 'VERSION_GRAPH_UNINITIALIZED':
    case 'VERSION_PERMISSION_DENIED':
    case 'VERSION_REF_WRITE_UNAVAILABLE':
      return 'unsupported';
    default:
      return 'none';
  }
}

export function safeBranchDiagnosticToken(kind: BranchDiagnosticTokenKind, value: string): string {
  const allowed =
    kind === 'conflict'
      ? SAFE_BRANCH_DIAGNOSTIC_CONFLICTS
      : kind === 'issue'
        ? SAFE_BRANCH_DIAGNOSTIC_ISSUES
        : SAFE_BRANCH_DIAGNOSTIC_OPTIONS;
  return allowed.has(value) ? value : 'redacted';
}

function toPublicMutationGuarantee(
  value: unknown,
): VersionStoreDiagnostic['mutationGuarantee'] | undefined {
  return value === 'ref-not-mutated' ||
    value === 'registry-not-visible' ||
    value === 'no-write-attempted' ||
    value === 'unknown-after-crash'
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
