import type {
  VersionDiagnosticPublicPayload,
  VersionRevertInput,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import { isPayloadPrimitive, isRecord } from './version-revert-provider-shape';

export const VERSION_REVERT_PROVIDER_ERROR_DIAGNOSTIC_CODE = 'VERSION_REVERT_PROVIDER_ERROR';
export const VERSION_REVERT_INVALID_PROVIDER_PAYLOAD_DIAGNOSTIC_CODE =
  'VERSION_INVALID_COMMIT_PAYLOAD';

const PROVIDER_DIAGNOSTIC_PAYLOAD_KEYS = new Set([
  'actualCommitId',
  'actualHead',
  'actualRevision',
  'baseCommitId',
  'conflictCount',
  'conflictId',
  'conflictKind',
  'domain',
  'expectedCommitId',
  'expectedHead',
  'expectedRevision',
  'headCommitId',
  'mainlineParent',
  'matrixRowId',
  'rangeConflictCount',
  'reason',
  'refName',
  'selector',
  'targetRef',
]);

export function providerErrorDiagnostic(): VersionStoreDiagnostic {
  return revertProviderDiagnostic(
    VERSION_REVERT_PROVIDER_ERROR_DIAGNOSTIC_CODE,
    'The version revert service failed before returning a usable public result.',
    { recoverability: 'retry' },
  );
}

export function invalidProviderPayloadDiagnostic(): VersionStoreDiagnostic {
  return revertProviderDiagnostic(
    VERSION_REVERT_INVALID_PROVIDER_PAYLOAD_DIAGNOSTIC_CODE,
    'The version revert service did not return a valid public revert result.',
    { recoverability: 'repair' },
  );
}

export function mapProviderFailureDiagnostics(
  value: Readonly<Record<string, unknown>>,
  input: VersionRevertInput,
): readonly VersionStoreDiagnostic[] {
  const diagnostics = isRecord(value.error) ? value.error.diagnostics : value.diagnostics;
  const mapped = Array.isArray(diagnostics)
    ? mapProviderDiagnostics(diagnostics, input)
    : [providerErrorDiagnostic()];
  const mutationGuarantee = toDiagnosticMutationGuarantee(value.mutationGuarantee);
  return mutationGuarantee
    ? mapped.map((diagnostic) => ({ ...diagnostic, mutationGuarantee }))
    : mapped;
}

export function mapProviderDiagnostics(
  value: readonly unknown[],
  input: VersionRevertInput,
): readonly VersionStoreDiagnostic[] {
  if (value.length === 0) return [];
  return value.map((entry) => mapProviderDiagnostic(entry, input));
}

export function toDiagnosticMutationGuarantee(
  value: unknown,
): VersionStoreDiagnostic['mutationGuarantee'] | undefined {
  return value === 'no-write-attempted' ||
    value === 'ref-not-mutated' ||
    value === 'unknown-after-crash'
    ? value
    : undefined;
}

function mapProviderDiagnostic(value: unknown, input: VersionRevertInput): VersionStoreDiagnostic {
  if (!isRecord(value)) return providerErrorDiagnostic();

  const issueCode =
    typeof value.issueCode === 'string'
      ? value.issueCode
      : typeof value.code === 'string'
        ? value.code
        : VERSION_REVERT_PROVIDER_ERROR_DIAGNOSTIC_CODE;
  return {
    issueCode,
    severity: toDiagnosticSeverity(value.severity),
    recoverability:
      toRecoverability(value.recoverability) ?? recoverabilityForRevertIssue(issueCode),
    messageTemplateId:
      typeof value.messageTemplateId === 'string'
        ? value.messageTemplateId
        : `version.revert.${issueCode}`,
    safeMessage:
      typeof value.safeMessage === 'string'
        ? value.safeMessage
        : typeof value.message === 'string'
          ? value.message
          : safeMessageForRevertIssue(issueCode),
    payload: sanitizeProviderDiagnosticPayload(value, input),
    redacted: true,
    ...(toDiagnosticMutationGuarantee(value.mutationGuarantee)
      ? { mutationGuarantee: toDiagnosticMutationGuarantee(value.mutationGuarantee) }
      : {}),
  };
}

function sanitizeProviderDiagnosticPayload(
  value: Readonly<Record<string, unknown>>,
  input: VersionRevertInput,
): VersionDiagnosticPublicPayload {
  const payload: Record<string, string | number | boolean | null> = {
    operation: 'revert',
    targetKind: input.target.kind,
  };

  copyKnownPayloadValues(payload, value);
  if (isRecord(value.details)) copyKnownPayloadValues(payload, value.details);
  if (isRecord(value.payload)) copyKnownPayloadValues(payload, value.payload);

  payload.operation = 'revert';
  return payload;
}

function copyKnownPayloadValues(
  target: Record<string, string | number | boolean | null>,
  source: Readonly<Record<string, unknown>>,
): void {
  for (const [key, value] of Object.entries(source)) {
    if (!PROVIDER_DIAGNOSTIC_PAYLOAD_KEYS.has(key) || !isPayloadPrimitive(value)) continue;
    target[key] = value;
  }
}

function revertProviderDiagnostic(
  issueCode: string,
  safeMessage: string,
  options: {
    readonly recoverability?: VersionStoreDiagnostic['recoverability'];
    readonly mutationGuarantee?: VersionStoreDiagnostic['mutationGuarantee'];
    readonly payload?: VersionDiagnosticPublicPayload;
  } = {},
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity: 'error',
    recoverability: options.recoverability ?? recoverabilityForRevertIssue(issueCode),
    messageTemplateId: `version.revert.${issueCode}`,
    safeMessage,
    payload: { operation: 'revert', ...(options.payload ?? {}) },
    redacted: true,
    ...(options.mutationGuarantee ? { mutationGuarantee: options.mutationGuarantee } : {}),
  };
}

function safeMessageForRevertIssue(issueCode: string): string {
  switch (issueCode) {
    case VERSION_REVERT_INVALID_PROVIDER_PAYLOAD_DIAGNOSTIC_CODE:
      return 'The version revert service did not return a valid public revert result.';
    case VERSION_REVERT_PROVIDER_ERROR_DIAGNOSTIC_CODE:
      return 'The version revert service failed before returning a usable public result.';
    case 'VERSION_REF_CONFLICT':
    case 'VERSION_REVERT_STALE_HEAD':
      return 'Version-control revert is rejected because the target head is stale or cannot be proven current.';
    case 'VERSION_REVERT_CONFLICT':
      return 'Version-control revert requires conflict review.';
    default:
      return 'Version-control revert failed.';
  }
}

function recoverabilityForRevertIssue(issueCode: string): VersionStoreDiagnostic['recoverability'] {
  switch (issueCode) {
    case VERSION_REVERT_PROVIDER_ERROR_DIAGNOSTIC_CODE:
    case 'VERSION_REF_CONFLICT':
    case 'VERSION_REVERT_STALE_HEAD':
    case 'VERSION_REVERT_CONFLICT':
      return 'retry';
    case VERSION_REVERT_INVALID_PROVIDER_PAYLOAD_DIAGNOSTIC_CODE:
      return 'repair';
    default:
      return 'none';
  }
}

function toDiagnosticSeverity(value: unknown): VersionStoreDiagnostic['severity'] {
  return value === 'info' || value === 'warning' || value === 'error' || value === 'fatal'
    ? value
    : 'error';
}

function toRecoverability(value: unknown): VersionStoreDiagnostic['recoverability'] | undefined {
  return value === 'retry' || value === 'repair' || value === 'unsupported' || value === 'none'
    ? value
    : undefined;
}
