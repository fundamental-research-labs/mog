import type { VersionObjectRecord } from '../object-store';

export function isVersionObjectRecord(value: unknown): value is VersionObjectRecord<unknown> {
  return (
    isPlainRecord(value) &&
    isPlainRecord(value.preimage) &&
    typeof value.preimage.objectType === 'string' &&
    isPlainRecord(value.digest) &&
    typeof value.payloadByteLength === 'number' &&
    typeof value.preimageByteLength === 'number'
  );
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
