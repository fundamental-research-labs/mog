import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

const VERSION_OBJECT_READ_REPAIR_DIAGNOSTIC_CODES = new Set<string>([
  'VERSION_BYTE_LENGTH_MISMATCH',
  'VERSION_DIGEST_MISMATCH',
  'VERSION_DUPLICATE_DEPENDENCY',
  'VERSION_INVALID_DEPENDENCY',
  'VERSION_INVALID_DIGEST',
  'VERSION_INVALID_PREIMAGE',
  'VERSION_INVALID_PAYLOAD',
  'VERSION_MISSING_DEPENDENCY',
  'VERSION_OBJECT_CORRUPTION',
  'VERSION_OBJECT_NOT_FOUND',
  'VERSION_OBJECT_STORE_FAILURE',
  'VERSION_OBJECT_TYPE_MISMATCH',
  'VERSION_UNSUPPORTED_DIGEST_ALGORITHM',
  'VERSION_UNSUPPORTED_OBJECT_TYPE',
  'VERSION_UNSUPPORTED_PAYLOAD_ENCODING',
  'VERSION_UNSUPPORTED_SCHEMA',
  'VERSION_WRONG_NAMESPACE',
]);

const VERSION_OBJECT_READ_RETRY_DIAGNOSTIC_CODES = new Set<string>([
  'VERSION_PROVIDER_ERROR',
  'VERSION_PROVIDER_FAILED',
  'VERSION_REF_CONFLICT',
  'VERSION_STALE_PAGE_CURSOR',
]);

const VERSION_OBJECT_READ_UNSUPPORTED_DIAGNOSTIC_CODES = new Set<string>([
  'VERSION_GRAPH_UNINITIALIZED',
  'VERSION_PERMISSION_DENIED',
  'VERSION_STORE_UNAVAILABLE',
]);

const VERSION_OBJECT_READ_DIAGNOSTIC_CODES = new Set<string>([
  ...VERSION_OBJECT_READ_REPAIR_DIAGNOSTIC_CODES,
  ...VERSION_OBJECT_READ_RETRY_DIAGNOSTIC_CODES,
  ...VERSION_OBJECT_READ_UNSUPPORTED_DIAGNOSTIC_CODES,
  'VERSION_INVALID_COMMIT_PAYLOAD',
  'VERSION_MISSING_OBJECT',
]);

export function isVersionObjectReadRepairDiagnosticCode(code: unknown): boolean {
  const normalized = normalizeVersionObjectReadDiagnosticCode(code);
  return normalized !== null && VERSION_OBJECT_READ_REPAIR_DIAGNOSTIC_CODES.has(normalized);
}

export function normalizeVersionObjectReadDiagnosticCode(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const normalized = normalizedObjectReadDiagnosticAlias(code);
  return VERSION_OBJECT_READ_DIAGNOSTIC_CODES.has(normalized) ? normalized : null;
}

export function versionObjectReadDiagnosticCode(value: unknown): string | null {
  const direct = normalizeVersionObjectReadDiagnosticCode(value);
  if (direct) return direct;
  if (!isRecord(value)) return null;

  const code = stableDiagnosticCodeField(value.code);
  if (code) return code;

  const issueCode = stableDiagnosticCodeField(value.issueCode);
  if (issueCode) return issueCode;

  const diagnosticCode = stableDiagnosticCodeField(value.diagnosticCode);
  if (diagnosticCode) return diagnosticCode;

  const nested = nestedVersionObjectReadDiagnosticCode(value);
  if (nested) return nested;

  const malformedObjectRef = malformedObjectReadRefDiagnosticCode(value);
  if (malformedObjectRef) return malformedObjectRef;

  return syntaxErrorDiagnosticCode(value);
}

export function recoverabilityForVersionObjectRead(
  code: unknown,
  fallback: VersionStoreDiagnostic['recoverability'],
): VersionStoreDiagnostic['recoverability'] {
  const normalized =
    normalizeVersionObjectReadDiagnosticCode(code) ?? versionObjectReadDiagnosticCode(code);
  if (normalized === null) return fallback;
  if (VERSION_OBJECT_READ_REPAIR_DIAGNOSTIC_CODES.has(normalized)) return 'repair';
  if (VERSION_OBJECT_READ_RETRY_DIAGNOSTIC_CODES.has(normalized)) return 'retry';
  if (VERSION_OBJECT_READ_UNSUPPORTED_DIAGNOSTIC_CODES.has(normalized)) return 'unsupported';
  return fallback;
}

function nestedVersionObjectReadDiagnosticCode(
  value: Readonly<Record<string, unknown>>,
): string | null {
  for (const key of ['diagnostic', 'error', 'cause'] as const) {
    const candidate = value[key];
    if (candidate !== value) {
      const code = versionObjectReadDiagnosticCode(candidate);
      if (code) return code;
    }
  }

  if (Array.isArray(value.diagnostics)) {
    for (const diagnostic of value.diagnostics) {
      const code = versionObjectReadDiagnosticCode(diagnostic);
      if (code) return code;
    }
  }

  if (isRecord(value.details)) {
    for (const key of ['sourceCode', 'cause', 'code', 'issueCode', 'diagnosticCode'] as const) {
      const code = stableDiagnosticCodeField(value.details[key]);
      if (code) return code;
    }
    const malformedObjectRef = malformedObjectReadRefDiagnosticCode(value.details);
    if (malformedObjectRef) return malformedObjectRef;
  }

  for (const key of ['ref', 'dependency', 'objectRef', 'readRef'] as const) {
    const candidate = value[key];
    if (!isRecord(candidate)) continue;
    const malformedObjectRef = malformedObjectReadRefDiagnosticCode(candidate);
    if (malformedObjectRef) return malformedObjectRef;
  }

  return null;
}

function stableDiagnosticCodeField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return normalizeVersionObjectReadDiagnosticCode(value) ?? 'VERSION_PROVIDER_FAILED';
}

function normalizedObjectReadDiagnosticAlias(code: string): string {
  switch (code) {
    case 'VERSION_INVALID_JSON':
    case 'VERSION_JSON_PARSE_FAILED':
    case 'VERSION_MALFORMED_JSON':
      return 'VERSION_INVALID_PAYLOAD';
    default:
      return code;
  }
}

function malformedObjectReadRefDiagnosticCode(
  value: Readonly<Record<string, unknown>>,
): string | null {
  if (typeof value.objectKind === 'string' && value.objectKind !== 'object') {
    return 'VERSION_INVALID_DEPENDENCY';
  }
  if (typeof value.kind !== 'string') return null;
  if (!looksLikeObjectReadRef(value)) return null;
  if (value.kind !== 'object') return 'VERSION_INVALID_DEPENDENCY';
  return isDigestRecord(value.digest) ? null : 'VERSION_INVALID_DIGEST';
}

function looksLikeObjectReadRef(value: Readonly<Record<string, unknown>>): boolean {
  return 'digest' in value || 'objectType' in value || 'commitId' in value;
}

function isDigestRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.algorithm === 'sha256' &&
    typeof value.digest === 'string' &&
    /^[0-9a-f]{64}$/.test(value.digest)
  );
}

function syntaxErrorDiagnosticCode(value: Readonly<Record<string, unknown>>): string | null {
  return value.name === 'SyntaxError' ? 'VERSION_INVALID_PAYLOAD' : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
