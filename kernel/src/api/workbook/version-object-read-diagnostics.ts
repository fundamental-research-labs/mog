import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

const VERSION_OBJECT_READ_REPAIR_DIAGNOSTIC_CODES = new Set<string>([
  'VERSION_DIGEST_MISMATCH',
  'VERSION_INVALID_PREIMAGE',
  'VERSION_UNSUPPORTED_SCHEMA',
  'VERSION_UNSUPPORTED_PAYLOAD_ENCODING',
  'VERSION_INVALID_PAYLOAD',
  'VERSION_BYTE_LENGTH_MISMATCH',
  'VERSION_MISSING_DEPENDENCY',
  'VERSION_OBJECT_CORRUPTION',
  'VERSION_OBJECT_NOT_FOUND',
  'VERSION_OBJECT_TYPE_MISMATCH',
  'VERSION_UNSUPPORTED_OBJECT_TYPE',
]);

export function isVersionObjectReadRepairDiagnosticCode(code: unknown): boolean {
  return typeof code === 'string' && VERSION_OBJECT_READ_REPAIR_DIAGNOSTIC_CODES.has(code);
}

export function versionObjectReadDiagnosticCode(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (typeof value.code === 'string') return value.code;
  return typeof value.issueCode === 'string' ? value.issueCode : null;
}

export function recoverabilityForVersionObjectRead(
  code: unknown,
  fallback: VersionStoreDiagnostic['recoverability'],
): VersionStoreDiagnostic['recoverability'] {
  return isVersionObjectReadRepairDiagnosticCode(code) ? 'repair' : fallback;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
