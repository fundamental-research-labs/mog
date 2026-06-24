import type { VersionDiagnostic, VersionResult } from '@mog-sdk/contracts/api';

import { VersionStoreProviderError } from '../provider';
import type { ProposalProviderOperation } from './proposal-provider-service-types';

type PublicDiagnosticData = Readonly<Record<string, string | number | boolean | null>>;

const PUBLIC_PROPOSAL_ID_RE = /^proposal:sha256:[0-9a-f]{64}$/;
const SENSITIVE_PRINCIPAL_TOKEN_RE =
  /\b(?:principal|actor|reviewer|agent|user)[_-][A-Za-z0-9_.:-]+\b/g;
const SENSITIVE_WORKSPACE_TOKEN_RE = /\bworkspace[_:-][A-Za-z0-9_.:-]+\b/g;
const SENSITIVE_PROVIDER_TOKEN_RE = /\bprovider[_:-][A-Za-z0-9_.:-]+\b/g;
const SENSITIVE_REF_TOKEN_RE = /\brefs\/[A-Za-z0-9._~!$&'()*+,;=:@/%-]+\b/g;
const SENSITIVE_BRANCH_OR_REF_FIELD_RE =
  /\b((?:branch|ref)(?:\s*(?:name|id)?\s*[:=]\s*))[A-Za-z0-9._/@:-]+\b/gi;

const OMIT_DIAGNOSTIC_FIELD = Symbol('omitDiagnosticField');

export function ok<T>(value: T): VersionResult<T> {
  return { ok: true, value };
}

export function storeFailure<T>(
  result: Extract<VersionResult<unknown>, { readonly ok: false }>,
): VersionResult<T> {
  return sanitizeProposalProviderResult({ ok: false, error: result.error });
}

export function staleRevision<T>(
  expectedRevision: number,
  actualRevision: number,
): VersionResult<T> {
  return {
    ok: false,
    error: { code: 'stale_revision', expectedRevision, actualRevision },
  };
}

export function workspaceUnavailable<T>(operation: ProposalProviderOperation): VersionResult<T> {
  return unsupported(
    operation,
    'VERSION_PROPOSAL_WORKSPACE_UNAVAILABLE',
    'Provider-backed proposal workspace sessions require an attached branch-isolated workspace lifecycle service.',
  );
}

export function unsupported<T>(
  operation: ProposalProviderOperation,
  code: string,
  message: string,
): VersionResult<T> {
  return targetUnavailable(operation, code, message, 'warning');
}

export function targetUnavailable<T>(
  operation: ProposalProviderOperation,
  code: string,
  message: string,
  severity: VersionDiagnostic['severity'] = 'error',
  sourceDiagnostics: readonly VersionDiagnostic[] = [],
): VersionResult<T> {
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: `workbook.version.${operation}`,
      diagnostics: [
        diagnostic(code, severity, message, { operation }),
        ...sanitizeProposalProviderDiagnostics(sourceDiagnostics),
      ],
    },
  };
}

export function branchFailure<T>(
  operation: ProposalProviderOperation,
  diagnostics: readonly unknown[],
): VersionResult<T> {
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: `workbook.version.${operation}`,
      diagnostics: diagnostics.length
        ? diagnostics.map((item) => branchDiagnostic(item, operation))
        : [
            diagnostic(
              'VERSION_PROVIDER_ERROR',
              'error',
              'Version branch service failed without public diagnostics.',
              { operation },
            ),
          ],
    },
  };
}

export function invalidState<T>(
  state: string,
  allowed: readonly string[],
  reason: string,
): VersionResult<T> {
  return { ok: false, error: { code: 'invalid_state', state, allowed, reason } };
}

export function invalidBranchName<T>(branchName: string, reason: string): VersionResult<T> {
  return { ok: false, error: { code: 'invalid_branch_name', branchName, reason } };
}

export function diagnosticsFromProviderError(error: unknown): readonly VersionDiagnostic[] {
  if (!(error instanceof VersionStoreProviderError)) return [];
  return sanitizeProposalProviderDiagnostics(
    error.diagnostics.map((item) =>
      diagnostic(item.issueCode, publicSeverity(item.severity), item.safeMessage, {
        operation: item.operation,
      }),
    ),
  );
}

export function sanitizeProposalProviderResult<T>(result: VersionResult<T>): VersionResult<T> {
  return sanitizeDiagnosticContainer(result) as VersionResult<T>;
}

export function sanitizeProposalProviderValue<T>(value: T): T {
  return sanitizeDiagnosticContainer(value) as T;
}

export function sanitizeProposalProviderDiagnostics(
  diagnostics: readonly VersionDiagnostic[],
): readonly VersionDiagnostic[] {
  return diagnostics.map(sanitizeProposalProviderDiagnostic);
}

export function sanitizeProposalProviderDiagnostic(value: unknown): VersionDiagnostic {
  if (!isRecord(value)) {
    return diagnostic(
      'VERSION_PROVIDER_ERROR',
      'error',
      'Version proposal provider returned an invalid diagnostic.',
    );
  }

  const data = sanitizeDiagnosticData(value.data);
  return {
    code: typeof value.code === 'string' ? value.code : 'VERSION_PROVIDER_ERROR',
    severity: publicSeverity(value.severity),
    message:
      typeof value.message === 'string'
        ? sanitizeDiagnosticString(value.message)
        : 'Version proposal provider returned a diagnostic without a public message.',
    ...(typeof value.owner === 'string' ? { owner: sanitizeDiagnosticString(value.owner) } : {}),
    ...(typeof value.dependency === 'string'
      ? {
          dependency: sanitizeDiagnosticString(value.dependency) as VersionDiagnostic['dependency'],
        }
      : {}),
    ...(data === OMIT_DIAGNOSTIC_FIELD || data === undefined
      ? {}
      : { data: data as VersionDiagnostic['data'] }),
  };
}

function sanitizeDiagnosticContainer(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeDiagnosticContainer);
  if (!isRecord(value)) return value;

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] =
      key === 'diagnostics' && Array.isArray(child)
        ? child.map(sanitizeProposalProviderDiagnostic)
        : sanitizeDiagnosticContainer(child);
  }
  return output;
}

function branchDiagnostic(value: unknown, operation: ProposalProviderOperation): VersionDiagnostic {
  if (!isRecord(value)) {
    return diagnostic(
      'VERSION_PROVIDER_ERROR',
      'error',
      'Version branch service returned an invalid diagnostic.',
      { operation },
    );
  }
  return diagnostic(
    typeof value.code === 'string' ? value.code : 'VERSION_PROVIDER_ERROR',
    publicSeverity(value.severity),
    typeof value.message === 'string'
      ? sanitizeDiagnosticString(value.message)
      : 'Version branch service returned a diagnostic without a public message.',
    branchDiagnosticData(value, operation),
  );
}

function branchDiagnosticData(
  value: Readonly<Record<string, unknown>>,
  operation: ProposalProviderOperation,
): PublicDiagnosticData {
  const data: Record<string, string | number | boolean | null> = { operation };
  const details = isRecord(value.details) ? value.details : null;
  const cause = details && sanitizeDiagnosticData(details.cause, 'cause');
  if (typeof cause === 'string') data.cause = cause;
  if (details && typeof details.missingField === 'string') data.option = details.missingField;
  return data;
}

function diagnostic(
  code: string,
  severity: VersionDiagnostic['severity'],
  message: string,
  data?: PublicDiagnosticData,
): VersionDiagnostic {
  const sanitizedData = data === undefined ? undefined : sanitizeDiagnosticData(data);
  return {
    code,
    severity,
    message: sanitizeDiagnosticString(message),
    owner: 'version-store',
    ...(sanitizedData === undefined || sanitizedData === OMIT_DIAGNOSTIC_FIELD
      ? {}
      : { data: sanitizedData as VersionDiagnostic['data'] }),
  };
}

function sanitizeDiagnosticData(
  value: unknown,
  key?: string,
): unknown | typeof OMIT_DIAGNOSTIC_FIELD {
  if (key && isProposalIdDiagnosticKey(key)) return sanitizeProposalIdDiagnosticValue(value);
  if (key && isSensitiveDiagnosticKey(key)) return OMIT_DIAGNOSTIC_FIELD;
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeDiagnosticData(item))
      .filter((item) => item !== OMIT_DIAGNOSTIC_FIELD);
  }
  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const [childKey, child] of Object.entries(value)) {
      const sanitized = sanitizeDiagnosticData(child, childKey);
      if (sanitized !== OMIT_DIAGNOSTIC_FIELD) output[childKey] = sanitized;
    }
    return output;
  }
  return typeof value === 'string' ? sanitizeDiagnosticString(value) : value;
}

function sanitizeDiagnosticString(value: string): string {
  return value
    .replace(SENSITIVE_REF_TOKEN_RE, 'redacted-ref')
    .replace(SENSITIVE_BRANCH_OR_REF_FIELD_RE, '$1redacted-ref')
    .replace(SENSITIVE_WORKSPACE_TOKEN_RE, 'redacted-workspace')
    .replace(SENSITIVE_PROVIDER_TOKEN_RE, 'redacted-provider')
    .replace(SENSITIVE_PRINCIPAL_TOKEN_RE, 'redacted-principal');
}

function isProposalIdDiagnosticKey(key: string): boolean {
  const normalized = normalizeDiagnosticKey(key);
  return normalized.endsWith('proposalid') || normalized.endsWith('proposalids');
}

function sanitizeProposalIdDiagnosticValue(value: unknown): unknown | typeof OMIT_DIAGNOSTIC_FIELD {
  if (typeof value === 'string') {
    return PUBLIC_PROPOSAL_ID_RE.test(value) ? value : OMIT_DIAGNOSTIC_FIELD;
  }
  if (Array.isArray(value)) {
    const proposalIds = value.filter(
      (item): item is string => typeof item === 'string' && PUBLIC_PROPOSAL_ID_RE.test(item),
    );
    return proposalIds.length > 0 ? proposalIds : OMIT_DIAGNOSTIC_FIELD;
  }
  return OMIT_DIAGNOSTIC_FIELD;
}

function isSensitiveDiagnosticKey(key: string): boolean {
  const normalized = normalizeDiagnosticKey(key);
  return (
    normalized.includes('principal') ||
    normalized === 'actor' ||
    normalized === 'actors' ||
    normalized === 'reviewer' ||
    normalized === 'reviewers' ||
    normalized === 'agent' ||
    normalized === 'agents' ||
    normalized === 'user' ||
    normalized === 'users' ||
    normalized === 'workspace' ||
    normalized === 'workspaces' ||
    normalized.endsWith('workspaceid') ||
    normalized.endsWith('workspaceids') ||
    normalized.includes('workspacescope') ||
    normalized.includes('workspacedetail') ||
    normalized === 'provider' ||
    normalized === 'providers' ||
    normalized.endsWith('providerid') ||
    normalized.endsWith('providerids') ||
    normalized.includes('provideridentity') ||
    (normalized.includes('raw') && normalized.includes('ref')) ||
    isSensitiveIdentifierKey(normalized)
  );
}

function isSensitiveIdentifierKey(normalizedKey: string): boolean {
  return (
    /(actor|reviewer|agent|user).*(id|ids|email|emails)$/.test(normalizedKey) ||
    /(id|ids|email|emails).*(actor|reviewer|agent|user)$/.test(normalizedKey)
  );
}

function normalizeDiagnosticKey(key: string): string {
  return key.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

function publicSeverity(value: unknown): VersionDiagnostic['severity'] {
  return value === 'info' || value === 'warning' || value === 'error' ? value : 'error';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
