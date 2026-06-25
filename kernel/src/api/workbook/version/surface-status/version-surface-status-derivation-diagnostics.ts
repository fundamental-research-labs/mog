import type { VersionDiagnosticPublicPayload } from '@mog-sdk/contracts/api';

const PUBLIC_DIAGNOSTIC_VALUE_RE = /^[A-Za-z0-9]+(?:[._:-][A-Za-z0-9]+)*$/;
const MAX_PUBLIC_DIAGNOSTIC_VALUE_LENGTH = 160;

export function sanitizePublicDiagnosticPayload(
  payload: Readonly<Record<string, unknown>>,
): VersionDiagnosticPublicPayload {
  const sanitized: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!isPublicDiagnosticValue(value)) continue;
    sanitized[key] = sanitizePublicDiagnosticValue(key, value);
  }
  return sanitized;
}

function isPublicDiagnosticValue(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function sanitizePublicDiagnosticValue(
  key: string,
  value: string | number | boolean | null,
): string | number | boolean | null {
  if (typeof value !== 'string') return value;
  const normalizedKey = key.toLowerCase();
  if (
    normalizedKey.includes('secret') ||
    normalizedKey.includes('credential') ||
    normalizedKey.includes('password') ||
    normalizedKey.includes('authorization') ||
    normalizedKey.includes('token') ||
    normalizedKey.includes('cursor') ||
    normalizedKey.includes('trace') ||
    normalizedKey.includes('opaque') ||
    normalizedKey.includes('hidden') ||
    normalizedKey.includes('deleted') ||
    normalizedKey.includes('protected')
  ) {
    return 'redacted';
  }
  const normalizedValue = value.toLowerCase();
  if (
    normalizedValue.includes('secret') ||
    normalizedValue.includes('credential') ||
    normalizedValue.includes('password') ||
    normalizedValue.includes('authorization') ||
    normalizedValue.includes('token') ||
    normalizedValue.includes('cursor') ||
    normalizedValue.includes('trace')
  ) {
    return 'redacted';
  }
  if (value.length > MAX_PUBLIC_DIAGNOSTIC_VALUE_LENGTH) return 'redacted';
  return PUBLIC_DIAGNOSTIC_VALUE_RE.test(value) ? value : 'redacted';
}
