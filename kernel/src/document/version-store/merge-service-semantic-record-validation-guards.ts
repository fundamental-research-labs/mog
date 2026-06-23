import type { VersionRedactedValue } from '@mog-sdk/contracts/api';

const REDACTED_VALUE_REASONS = new Set([
  'permission-denied',
  'redaction-policy',
  'historical-acl-unavailable',
]);

export function hasRedactedDisplay(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ['sheetName', 'address', 'entityLabel'].some((key) => hasRedactedValue(value[key]));
}

export function hasRedactedValue(value: unknown): value is VersionRedactedValue {
  return (
    isRecord(value) &&
    value.kind === 'redacted' &&
    typeof value.reason === 'string' &&
    REDACTED_VALUE_REASONS.has(value.reason)
  );
}

export function hasOpaqueSemanticValue(value: unknown, depth = 0): boolean {
  if (depth > 16 || !isRecord(value)) return false;
  if (value.kind === 'opaque') return true;
  if (isRecord(value.digest) && value.digest.algorithm === 'opaque') return true;
  if (value.kind === 'value') return hasOpaqueSemanticValue(value.value, depth + 1);
  if (Array.isArray(value.values)) {
    return value.values.some((item) => hasOpaqueSemanticValue(item, depth + 1));
  }
  if (Array.isArray(value.fields)) {
    return value.fields.some(
      (field) => isRecord(field) && hasOpaqueSemanticValue(field.value, depth + 1),
    );
  }
  return false;
}

export function isOpaqueSemanticDiffRecord(
  value: Readonly<Record<string, unknown>>,
): value is Readonly<Record<string, unknown>> & { readonly domainId: string } {
  return (
    typeof value.changeId === 'string' &&
    typeof value.kind === 'string' &&
    typeof value.domainId === 'string' &&
    typeof value.objectId === 'string' &&
    (typeof value.objectKind === 'string' ||
      value.beforeDigest !== undefined ||
      value.afterDigest !== undefined)
  );
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
