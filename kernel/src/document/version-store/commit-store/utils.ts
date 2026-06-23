import type { ObjectDigest, VersionDependencyRef } from '../object-digest';

export function dependencyKey(dependency: VersionDependencyRef): string {
  if (dependency.kind === 'object') {
    return [
      dependency.kind,
      dependency.objectType,
      dependency.digest.algorithm,
      dependency.digest.digest,
    ].join('\u0000');
  }
  return [
    dependency.kind,
    dependency.commitId,
    dependency.digest.algorithm,
    dependency.digest.digest,
  ].join('\u0000');
}

export function cloneDigest(digest: ObjectDigest): ObjectDigest {
  return { algorithm: digest.algorithm, digest: digest.digest };
}
