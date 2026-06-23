import type {
  VersionCapability,
  VersionCapabilityDependency,
  VersionDiagnostic,
  VersionDiagnosticPublicPayload,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';
import type {
  VersionHistoryAccessDeniedSummary,
  VersionHistoryDeniedSummaryKind,
} from '@mog-sdk/contracts/versioning';

import { VERSION_CAPABILITY_KEYS } from './version-merge-capability';

type VersionHistoryAllowedProjection = {
  readonly kind: 'allowed';
};

export type VersionHistoryDeniedDiagnosticProjection = {
  readonly kind: VersionHistoryDeniedSummaryKind;
  readonly capability?: VersionCapability | string;
  readonly deniedCapabilities?: readonly (VersionCapability | string)[];
  readonly dependency?: VersionCapabilityDependency | string;
  readonly retryable?: boolean;
};

export type VersionHistoryDiagnosticProjectionAccess =
  | VersionHistoryAllowedProjection
  | VersionHistoryDeniedDiagnosticProjection;

const VERSION_CAPABILITIES = new Set<string>(VERSION_CAPABILITY_KEYS);
const VERSION_CAPABILITY_DEPENDENCIES = new Set<string>([
  'VC-04',
  'VC-05',
  'VC-07',
  'VC-09',
  'storage',
  'featureGate',
  'hostCapability',
  'upstreamRevertContract',
]);
const MAX_DIAGNOSTIC_PAYLOAD_SCAN_DEPTH = 12;
const COMMIT_ID_RE = /\bcommit:sha256:[0-9a-f]{64}\b/;
const COMMIT_ID_GLOBAL_RE = /\bcommit:sha256:[0-9a-f]{64}\b/g;
const REF_NAME_RE = /\brefs\/[A-Za-z0-9._/-]+\b/;
const REF_NAME_GLOBAL_RE = /\brefs\/[A-Za-z0-9._/-]+\b/g;
const PUBLIC_OPERATION_RE = /^[A-Za-z][A-Za-z0-9:._/-]{0,95}$/;
const STALE_HEAD_REASON = 'stale-head';
const HISTORY_GAP_REASON = 'history-gap';

export function projectVersionHistoryDiagnosticsForAccess(
  diagnostics: readonly VersionDiagnostic[],
  access: VersionHistoryDiagnosticProjectionAccess,
): readonly VersionDiagnostic[] {
  if (access.kind === 'allowed') return diagnostics;
  return [
    versionHistoryDeniedSummaryDiagnostic(projectVersionHistoryAccessDeniedSummary(access)),
  ];
}

export function projectVersionHistoryAccessDeniedSummary(
  access: VersionHistoryDeniedDiagnosticProjection,
  _diagnostics: readonly VersionDiagnostic[] = [],
): VersionHistoryAccessDeniedSummary {
  const capability = publicVersionCapability(access.capability);
  const deniedCapabilities = publicDeniedCapabilities([
    ...(access.deniedCapabilities ?? []),
    ...(capability ? [capability] : []),
  ]);
  const dependency = publicVersionCapabilityDependency(access.dependency);

  return {
    kind: access.kind,
    code: publicVersionHistoryDeniedCode(access.kind),
    ...(capability ? { capability } : {}),
    ...(deniedCapabilities.length > 0 ? { deniedCapabilities } : {}),
    ...(dependency ? { dependency } : {}),
    ...(typeof access.retryable === 'boolean' ? { retryable: access.retryable } : {}),
  };
}

export function projectVersionStoreDiagnosticForPublicResult(
  diagnostic: VersionStoreDiagnostic,
): VersionDiagnostic {
  const source = isRecord(diagnostic)
    ? (diagnostic as Readonly<Record<string, unknown>>)
    : {};
  const issueCode = publicDiagnosticIssueCode(source);
  const payload = projectVersionStoreDiagnosticPayload(source);
  return {
    code: issueCode,
    severity: publicDiagnosticSeverity(source.severity),
    message: publicVersionStoreDiagnosticMessage(source, issueCode, payload),
    owner: 'version-store',
    data: {
      ...(typeof payload.operation === 'string' ? { operation: payload.operation } : {}),
      recoverability: publicRecoverability(source.recoverability),
      messageTemplateId: publicMessageTemplateId(source.messageTemplateId, issueCode),
      redacted: true,
      ...(Object.keys(payload).length > 0 ? { payload } : {}),
      ...(isPublicMutationGuarantee(source.mutationGuarantee)
        ? { mutationGuarantee: source.mutationGuarantee }
        : {}),
    },
  };
}

export function projectVersionStoreDiagnosticsForPublicResult(
  diagnostics: readonly VersionStoreDiagnostic[],
): readonly VersionDiagnostic[] {
  return diagnostics.map(projectVersionStoreDiagnosticForPublicResult);
}

function versionHistoryDeniedSummaryDiagnostic(
  summary: VersionHistoryAccessDeniedSummary,
): VersionDiagnostic {
  return {
    code: summary.code,
    severity: 'error',
    message:
      summary.kind === 'capability-denied'
        ? 'Version history capability is denied for this caller.'
        : 'Version history access is denied for this caller.',
    ...(typeof summary.dependency === 'string'
      ? { dependency: summary.dependency as VersionCapabilityDependency }
      : {}),
    data: {
      kind: summary.kind,
      ...(summary.capability ? { capability: summary.capability } : {}),
      ...(summary.deniedCapabilities ? { deniedCapabilities: summary.deniedCapabilities } : {}),
      ...(typeof summary.retryable === 'boolean' ? { retryable: summary.retryable } : {}),
    },
  };
}

function publicDeniedCapabilities(
  candidates: readonly (VersionCapability | string)[],
): readonly VersionCapability[] {
  return [
    ...new Set(
      candidates.flatMap((candidate) => {
        const capability = publicVersionCapability(candidate);
        return capability ? [capability] : [];
      }),
    ),
  ];
}

function publicVersionCapability(value: unknown): VersionCapability | undefined {
  return typeof value === 'string' && VERSION_CAPABILITIES.has(value)
    ? (value as VersionCapability)
    : undefined;
}

function publicVersionCapabilityDependency(
  value: unknown,
): VersionCapabilityDependency | undefined {
  return typeof value === 'string' && VERSION_CAPABILITY_DEPENDENCIES.has(value)
    ? (value as VersionCapabilityDependency)
    : undefined;
}

function publicVersionHistoryDeniedCode(
  kind: VersionHistoryDeniedSummaryKind,
): VersionHistoryAccessDeniedSummary['code'] {
  return kind === 'capability-denied'
    ? 'version_capability_unavailable'
    : 'version_access_denied';
}

function publicDiagnosticIssueCode(value: Readonly<Record<string, unknown>>): string {
  return typeof value.issueCode === 'string'
    ? value.issueCode
    : typeof value.code === 'string'
      ? value.code
      : 'VERSION_PROVIDER_ERROR';
}

function projectVersionStoreDiagnosticPayload(
  value: Readonly<Record<string, unknown>>,
): VersionDiagnosticPublicPayload {
  const payload: Record<string, string | number | boolean | null> = {};
  const operation = publicOperation(value.payload) ?? publicOperation(value);
  if (operation) payload.operation = operation;

  mergePublicPayload(payload, value.payload);
  mergePublicDiagnosticDetails(payload, value.details);

  const condition = diagnosticHistoryCondition(value, payload);
  if (condition === STALE_HEAD_REASON) {
    payload.condition = STALE_HEAD_REASON;
    payload.completenessCondition = 'stale';
    payload.refName = 'redacted';
    payload.head = 'redacted';
    payload.historyHead = 'stale';
  } else if (condition === HISTORY_GAP_REASON) {
    payload.condition = HISTORY_GAP_REASON;
    payload.completenessCondition = HISTORY_GAP_REASON;
    payload.historyCompleteness = HISTORY_GAP_REASON;
  }

  return Object.freeze(payload);
}

function mergePublicPayload(
  output: Record<string, string | number | boolean | null>,
  value: unknown,
): void {
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'operation') continue;
    const projected = projectPublicDiagnosticPayloadValue(key, entry);
    if (projected !== undefined) output[key] = projected;
  }
}

function mergePublicDiagnosticDetails(
  output: Record<string, string | number | boolean | null>,
  value: unknown,
): void {
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (!isPublicProviderDetailKey(key)) continue;
    const projected = projectPublicDiagnosticPayloadValue(key, entry);
    if (projected !== undefined) output[key] = projected;
  }
}

function projectPublicDiagnosticPayloadValue(
  key: string,
  value: unknown,
): string | number | boolean | null | undefined {
  if (value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  if (!isPublicProviderDetailKey(key) && isSensitiveProviderDiagnosticPayloadKey(key)) {
    return 'redacted';
  }
  return isUnsafeProviderDiagnosticString(value) ? 'redacted' : value;
}

function publicOperation(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.operation !== 'string') return undefined;
  return PUBLIC_OPERATION_RE.test(value.operation) ? value.operation : undefined;
}

function diagnosticHistoryCondition(
  value: Readonly<Record<string, unknown>>,
  payload: Readonly<Record<string, unknown>>,
): typeof STALE_HEAD_REASON | typeof HISTORY_GAP_REASON | null {
  if (hasHistoryGapMarker(value) || payload.completenessCondition === HISTORY_GAP_REASON) {
    return HISTORY_GAP_REASON;
  }
  if (hasStaleHeadMarker(value, payload)) return STALE_HEAD_REASON;
  return null;
}

function hasHistoryGapMarker(value: unknown, depth = 0): boolean {
  if (depth > MAX_DIAGNOSTIC_PAYLOAD_SCAN_DEPTH) return false;
  if (Array.isArray(value)) return value.some((entry) => hasHistoryGapMarker(entry, depth + 1));
  if (!isRecord(value)) return false;
  if (
    value.completenessCondition === HISTORY_GAP_REASON ||
    value.reason === HISTORY_GAP_REASON ||
    value.condition === HISTORY_GAP_REASON
  ) {
    return true;
  }
  return Object.entries(value).some(([key, entry]) => {
    if (isSensitiveDiagnosticScanKey(key)) return false;
    return hasHistoryGapMarker(entry, depth + 1);
  });
}

function hasStaleHeadMarker(
  value: Readonly<Record<string, unknown>>,
  payload: Readonly<Record<string, unknown>>,
): boolean {
  if (
    payload.reason === 'staleTargetHead' ||
    payload.reason === 'staleWorkspaceHead' ||
    payload.reason === STALE_HEAD_REASON ||
    payload.condition === STALE_HEAD_REASON ||
    payload.completenessCondition === 'stale'
  ) {
    return true;
  }
  const details = isRecord(value.details) ? value.details : null;
  return (
    value.issueCode === 'VERSION_REF_CONFLICT' ||
    value.code === 'VERSION_REF_CONFLICT' ||
    details?.completenessCondition === 'stale' ||
    (typeof details?.expectedHead === 'string' && typeof details?.actualHead === 'string') ||
    (typeof details?.expectedHeadCommitId === 'string' &&
      typeof details?.actualHeadCommitId === 'string') ||
    (typeof value.expectedHead === 'string' && typeof value.actualHead === 'string')
  );
}

function isPublicProviderDetailKey(key: string): boolean {
  return (
    key === 'accessFiltered' ||
    key === 'completenessCondition' ||
    key === 'completenessMarker' ||
    key === 'completenessScope' ||
    key === 'corruptTraversalCondition' ||
    key === 'missingCommitRole' ||
    key === 'mode' ||
    key === 'mutationGuarantee' ||
    key === 'option' ||
    key === 'reason' ||
    key === 'reloadIssue'
  );
}

function isSensitiveProviderDiagnosticPayloadKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized.includes('namespace') ||
    normalized.includes('documentscope') ||
    normalized.includes('principal') ||
    normalized.includes('userid') ||
    normalized.includes('useremail') ||
    normalized.includes('client') ||
    normalized.includes('session') ||
    normalized.includes('actor') ||
    normalized.includes('author') ||
    normalized.includes('providerref') ||
    normalized.includes('authorityref') ||
    normalized.includes('originid') ||
    normalized.includes('commit') ||
    normalized.includes('ref') ||
    normalized.includes('branch') ||
    normalized.includes('head') ||
    normalized.includes('revision') ||
    normalized.includes('token') ||
    normalized.includes('cursor') ||
    normalized.includes('path') ||
    normalized.includes('value') ||
    normalized.includes('formula') ||
    normalized.includes('result') ||
    normalized.includes('digest') ||
    normalized.includes('secret') ||
    normalized.includes('credential') ||
    normalized.includes('password') ||
    normalized.includes('trace') ||
    normalized.includes('opaque') ||
    normalized.includes('hidden') ||
    normalized.includes('deleted') ||
    normalized.includes('protected')
  );
}

function isSensitiveDiagnosticScanKey(key: string): boolean {
  return isSensitiveProviderDiagnosticPayloadKey(key);
}

function isUnsafeProviderDiagnosticString(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    COMMIT_ID_RE.test(value) ||
    REF_NAME_RE.test(value) ||
    normalized.includes('secret') ||
    normalized.includes('token') ||
    normalized.includes('credential') ||
    normalized.includes('password') ||
    normalized.includes('principal') ||
    normalized.includes('client') ||
    normalized.includes('session') ||
    normalized.includes('namespace') ||
    normalized.includes('hidden') ||
    normalized.includes('protected') ||
    normalized.includes('deleted')
  );
}

function publicVersionStoreDiagnosticMessage(
  source: Readonly<Record<string, unknown>>,
  issueCode: string,
  payload: Readonly<Record<string, unknown>>,
): string {
  const condition = diagnosticHistoryCondition(source, payload);
  if (condition === STALE_HEAD_REASON) {
    return 'Version history head changed before the operation completed; refresh and retry.';
  }
  if (condition === HISTORY_GAP_REASON) {
    return 'Version history has a gap; refresh or repair the provider history before retrying.';
  }
  const safeMessage =
    typeof source.safeMessage === 'string'
      ? source.safeMessage
      : typeof source.message === 'string'
        ? source.message
        : '';
  const sanitized = sanitizeDiagnosticMessage(safeMessage);
  return sanitized.length > 0 ? sanitized : `Version history operation failed: ${issueCode}.`;
}

function sanitizeDiagnosticMessage(value: string): string {
  return value
    .replace(COMMIT_ID_GLOBAL_RE, 'redacted')
    .replace(REF_NAME_GLOBAL_RE, 'redacted')
    .replace(
      /\b(?:client|session|principal|namespace|token|secret)[A-Za-z0-9._:-]*\b/gi,
      'redacted',
    );
}

function publicDiagnosticSeverity(value: unknown): VersionDiagnostic['severity'] {
  return value === 'info' || value === 'warning' || value === 'error' ? value : 'error';
}

function publicRecoverability(value: unknown): VersionStoreDiagnostic['recoverability'] {
  return value === 'retry' || value === 'repair' || value === 'unsupported' || value === 'none'
    ? value
    : 'none';
}

function publicMessageTemplateId(value: unknown, issueCode: string): string {
  return typeof value === 'string' && value.length > 0
    ? value
    : `version.provider.${issueCode}`;
}

function isPublicMutationGuarantee(
  value: unknown,
): value is NonNullable<VersionStoreDiagnostic['mutationGuarantee']> {
  return (
    value === 'ref-not-mutated' ||
    value === 'registry-not-visible' ||
    value === 'no-write-attempted' ||
    value === 'unknown-after-crash'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
