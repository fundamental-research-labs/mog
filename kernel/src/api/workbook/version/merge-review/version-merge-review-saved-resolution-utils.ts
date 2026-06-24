import type { ObjectDigest as PublicObjectDigest } from '@mog-sdk/contracts/api';

import type { ObjectDigest as VersionObjectDigest } from '../../../../document/version-store/object-digest';

export function digestsEqual(
  left: PublicObjectDigest | VersionObjectDigest,
  right: PublicObjectDigest | VersionObjectDigest,
): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
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

export function hasUnknownKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(value).some((key) => !allowed.has(key));
}
