import type { ObjectDigest } from '@mog-sdk/contracts/api';

export function digestsEqual(
  left: ObjectDigest | undefined,
  right: ObjectDigest | undefined,
): boolean {
  return Boolean(
    left && right && left.algorithm === right.algorithm && left.digest === right.digest,
  );
}

export function objectDigestKey(digest: ObjectDigest): string {
  return `${digest.algorithm}:${digest.digest}`;
}

export function isObjectDigest(value: unknown): value is ObjectDigest {
  return (
    isRecord(value) &&
    value.algorithm === 'sha256' &&
    typeof value.digest === 'string' &&
    /^[0-9a-f]{64}$/.test(value.digest)
  );
}

export function objectDigestFromConflictDigest(value: string): ObjectDigest | null {
  if (!value.startsWith('sha256:')) return null;
  const digest = value.slice('sha256:'.length);
  return /^[0-9a-f]{64}$/.test(digest) ? { algorithm: 'sha256', digest } : null;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
