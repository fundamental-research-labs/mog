import type { ObjectDigest } from './object-digest';
import type { RefVersion } from './refs/ref-store';

export function cloneDigest(digest: ObjectDigest): ObjectDigest {
  return Object.freeze({ algorithm: digest.algorithm, digest: digest.digest });
}

export function cloneRefVersion(refVersion: RefVersion): RefVersion {
  return Object.freeze({ kind: refVersion.kind, value: refVersion.value });
}

export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
