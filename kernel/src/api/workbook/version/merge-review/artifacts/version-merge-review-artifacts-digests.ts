import type { ObjectDigest } from '@mog-sdk/contracts/api';

import type { ObjectDigest as InternalObjectDigest } from '../../../../../document/version-store/object-digest';

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

export function toInternalSha256Digest(value: ObjectDigest): InternalObjectDigest | null {
  return value.algorithm === 'sha256' && SHA256_HEX_RE.test(value.digest)
    ? (value as InternalObjectDigest)
    : null;
}

export function objectDigestFromConflictDigest(value: string): ObjectDigest {
  if (!value.startsWith('sha256:')) {
    throw new Error('expected sha256 conflict digest.');
  }
  const digest = value.slice('sha256:'.length);
  if (!SHA256_HEX_RE.test(digest)) {
    throw new Error('expected sha256 conflict digest.');
  }
  return { algorithm: 'sha256', digest };
}
