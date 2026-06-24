import type { VersionResult, VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import type { VersionProposalPublicOperation } from './version-proposal-types';
import { versionFailureFromStoreDiagnostics } from '../../version-result';

export function hardenVersionProposalServiceResult<T>(result: VersionResult<T>): VersionResult<T> {
  return sanitizeDiagnosticsInValue(result) as VersionResult<T>;
}

export function sanitizeVersionProposalServiceValue<T>(value: T): T {
  return sanitizeDiagnosticsInValue(value);
}

export function versionProposalFailureFromDiagnostics<T>(
  operation: VersionProposalPublicOperation,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionResult<T> {
  return sanitizeDiagnosticsInValue(versionFailureFromStoreDiagnostics(operation, diagnostics));
}

function sanitizeDiagnosticsInValue<T>(value: T): T {
  return sanitizeDiagnosticContainer(value) as T;
}

function sanitizeDiagnosticContainer(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeDiagnosticContainer);
  if (!isRecord(value)) return value;

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] =
      key === 'diagnostics' && Array.isArray(child)
        ? child.map(sanitizeProposalDiagnostic)
        : sanitizeDiagnosticContainer(child);
  }
  return output;
}

function sanitizeProposalDiagnostic(value: unknown): unknown {
  if (!isRecord(value)) return fallbackProposalDiagnostic();
  if ('issueCode' in value || 'safeMessage' in value) {
    return sanitizeStoreProposalDiagnostic(value);
  }
  return sanitizePublicProposalDiagnostic(value);
}

function sanitizeStoreProposalDiagnostic(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const payload = sanitizeDiagnosticData(value.payload);
  const data = compactRecord({
    recoverability: diagnosticStringValue(value.recoverability),
    messageTemplateId: diagnosticStringValue(value.messageTemplateId),
    redacted: typeof value.redacted === 'boolean' ? value.redacted : undefined,
    ...(payload === OMIT_DIAGNOSTIC_FIELD ? {} : { payload }),
    mutationGuarantee: diagnosticStringValue(value.mutationGuarantee),
  });
  return compactRecord({
    code: diagnosticStringValue(value.issueCode) ?? 'VERSION_PROVIDER_ERROR',
    severity: publicDiagnosticSeverity(value.severity),
    message:
      typeof value.safeMessage === 'string'
        ? sanitizeDiagnosticString(value.safeMessage)
        : 'Version proposal service returned a diagnostic without a public message.',
    owner: 'version-store',
    ...(Object.keys(data).length === 0 ? {} : { data }),
  });
}

function sanitizePublicProposalDiagnostic(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const data = sanitizeDiagnosticData(value.data);
  const output = compactRecord({
    code: diagnosticStringValue(value.code) ?? 'VERSION_PROVIDER_ERROR',
    severity: publicDiagnosticSeverity(value.severity),
    message:
      typeof value.message === 'string'
        ? sanitizeDiagnosticString(value.message)
        : 'Version proposal service returned a diagnostic without a public message.',
    owner: diagnosticStringValue(value.owner),
    dependency: diagnosticStringValue(value.dependency),
    ...(data === OMIT_DIAGNOSTIC_FIELD ? {} : { data }),
  });

  for (const [key, child] of Object.entries(value)) {
    if (key in output || key === 'issueCode' || key === 'safeMessage') continue;
    if (key === 'data' || key === 'payload' || key === 'details') continue;
    const sanitized = sanitizeDiagnosticData(child, key);
    if (sanitized !== OMIT_DIAGNOSTIC_FIELD) output[key] = sanitized;
  }
  return output;
}

function fallbackProposalDiagnostic(): Readonly<Record<string, unknown>> {
  return {
    code: 'VERSION_PROVIDER_ERROR',
    severity: 'error',
    message: 'Version proposal service returned an invalid diagnostic.',
    owner: 'version-store',
  };
}

const OMIT_DIAGNOSTIC_FIELD = Symbol('omitDiagnosticField');
const PUBLIC_PROPOSAL_ID_RE = /^proposal:sha256:[0-9a-f]{64}$/;
const SENSITIVE_PRINCIPAL_TOKEN_RE =
  /\b(?:principal|actor|reviewer|agent|user)[_-][A-Za-z0-9_.:-]+\b/g;

function sanitizeDiagnosticData(
  value: unknown,
  key?: string,
): unknown | typeof OMIT_DIAGNOSTIC_FIELD {
  if (key && isProposalIdDiagnosticKey(key)) {
    return sanitizeProposalIdDiagnosticValue(value);
  }
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
  return value.replace(SENSITIVE_PRINCIPAL_TOKEN_RE, 'redacted-principal');
}

function isSensitiveDiagnosticKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized.includes('principal') ||
    normalized === 'actor' ||
    normalized === 'reviewer' ||
    normalized === 'agent' ||
    normalized === 'user' ||
    isSensitiveIdentifierKey(normalized) ||
    normalized === 'useremail' ||
    normalized === 'useremails'
  );
}

function isProposalIdDiagnosticKey(key: string): boolean {
  const normalized = key.toLowerCase();
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

function isSensitiveIdentifierKey(normalizedKey: string): boolean {
  return (
    /(actor|reviewer|agent|user).*(id|ids|email|emails)$/.test(normalizedKey) ||
    /(id|ids|email|emails).*(actor|reviewer|agent|user)$/.test(normalizedKey)
  );
}

function publicDiagnosticSeverity(value: unknown): 'info' | 'warning' | 'error' {
  if (value === 'info' || value === 'warning' || value === 'error') return value;
  return 'error';
}

function diagnosticStringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? sanitizeDiagnosticString(value) : undefined;
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined) output[key] = child;
  }
  return output;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
