import type { ObjectDigest } from './object-digest';
import type { PendingRemoteSegmentRecord } from './pending-remote-segment-store';

export function sortPendingRemoteSegments(
  records: readonly PendingRemoteSegmentRecord[],
): readonly PendingRemoteSegmentRecord[] {
  return Object.freeze(
    [...records].sort((left, right) => {
      const createdAt = left.createdAt.localeCompare(right.createdAt);
      if (createdAt !== 0) return createdAt;
      return left.pendingRemoteSegmentId.localeCompare(right.pendingRemoteSegmentId);
    }),
  );
}

export function digestKey(digest: ObjectDigest): string {
  return `${digest.algorithm}:${digest.digest}`;
}

export function digestKeys(digests: readonly ObjectDigest[]): readonly string[] {
  return digests.map(digestKey);
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('stable JSON number must be finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!isRecord(value)) throw new Error('stable JSON value must be a record');
  return `{${Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(',')}}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
