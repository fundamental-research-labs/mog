import { isRecord, isSensitiveDiagnosticKey } from './version-review-diagnostics-values';

export function sanitizeDiagnosticsInValue<T>(value: T): T {
  return sanitizeDiagnosticContainer(value) as T;
}

function sanitizeDiagnosticContainer(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeDiagnosticContainer);
  if (!isRecord(value)) return value;

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] =
      key === 'diagnostics' && Array.isArray(child)
        ? child.map(sanitizeReviewDiagnostic)
        : sanitizeDiagnosticContainer(child);
  }
  return output;
}

function sanitizeReviewDiagnostic(value: unknown): unknown {
  if (!isRecord(value)) return value;

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if ((key === 'message' || key === 'safeMessage') && typeof child === 'string') {
      output[key] = sanitizeDiagnosticString(child);
      continue;
    }
    if (key === 'data' || key === 'payload' || key === 'details') {
      const sanitized = sanitizeDiagnosticData(child);
      if (sanitized !== OMIT_DIAGNOSTIC_FIELD) output[key] = sanitized;
      continue;
    }
    output[key] = child;
  }
  return output;
}

const OMIT_DIAGNOSTIC_FIELD = Symbol('omitDiagnosticField');
const SENSITIVE_PRINCIPAL_TOKEN_RE =
  /\b(?:principal|actor|reviewer|agent|user)[_-][A-Za-z0-9_.:-]+\b/g;

function sanitizeDiagnosticData(
  value: unknown,
  key?: string,
): unknown | typeof OMIT_DIAGNOSTIC_FIELD {
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
