import { parseObjectDigest, type ObjectDigest, type VersionDependencyRef } from './object-digest';
import { cloneVersionObjectCompatibilityHeader, type VersionObjectPreimage } from './object-header';
import { clonePayload, isPlainRecord, sha256ObjectDigest } from './object-store-canonical';
import { throwValidation, type VersionObjectStoreDiagnosticCode } from './object-store-diagnostics';
import {
  normalizeVersionGraphNamespace,
  versionGraphNamespaceKey,
  type VersionGraphNamespace,
} from './object-store-namespace';
import { encodeVersionObjectPreimage } from './object-store-preimage';

export type VersionObjectRecord<TPayload> = {
  readonly namespace: VersionGraphNamespace;
  readonly preimage: VersionObjectPreimage<TPayload>;
  readonly digest: ObjectDigest;
  readonly payloadByteLength: number;
  readonly preimageByteLength: number;
};

export type ValidatedVersionObjectRecord<TPayload> = {
  readonly record: VersionObjectRecord<TPayload>;
  readonly dependencies: readonly VersionDependencyRef[];
};

export async function createVersionObjectRecord<TPayload>(
  namespace: VersionGraphNamespace,
  preimage: VersionObjectPreimage<TPayload>,
): Promise<VersionObjectRecord<TPayload>> {
  const normalizedNamespace = normalizeVersionGraphNamespace(namespace);
  const encoded = encodeVersionObjectPreimage(preimage);
  const digest = await sha256ObjectDigest(encoded.preimageBytes);

  return cloneVersionObjectRecord({
    namespace: normalizedNamespace,
    preimage: encoded.preimage as VersionObjectPreimage<TPayload>,
    digest,
    payloadByteLength: encoded.payloadBytes.byteLength,
    preimageByteLength: encoded.preimageBytes.byteLength,
  }) as VersionObjectRecord<TPayload>;
}

export async function validateVersionObjectRecord<TPayload>(
  record: VersionObjectRecord<TPayload>,
  path: string,
): Promise<ValidatedVersionObjectRecord<TPayload>> {
  if (!isPlainRecord(record)) {
    throwValidation('VERSION_INVALID_PREIMAGE', 'Version object record must be an object.', {
      path,
    });
  }

  const namespace = normalizeVersionGraphNamespace(record.namespace, `${path}.namespace`);
  const digest = parseObjectDigest(record.digest, `${path}.digest`);
  assertNonNegativeSafeInteger(
    record.payloadByteLength,
    `${path}.payloadByteLength`,
    'VERSION_BYTE_LENGTH_MISMATCH',
  );
  assertNonNegativeSafeInteger(
    record.preimageByteLength,
    `${path}.preimageByteLength`,
    'VERSION_BYTE_LENGTH_MISMATCH',
  );

  const encoded = encodeVersionObjectPreimage(record.preimage);
  const expectedDigest = await sha256ObjectDigest(encoded.preimageBytes);
  if (digest.digest !== expectedDigest.digest) {
    throwValidation('VERSION_DIGEST_MISMATCH', 'Version object digest does not match preimage.', {
      namespace,
      digest,
      objectType: encoded.preimage.objectType,
      path: `${path}.digest`,
      details: { expected: expectedDigest.digest, received: digest.digest },
    });
  }

  if (
    record.payloadByteLength !== encoded.payloadBytes.byteLength ||
    record.preimageByteLength !== encoded.preimageBytes.byteLength
  ) {
    throwValidation(
      'VERSION_BYTE_LENGTH_MISMATCH',
      'Version object byte length metadata does not match canonical bytes.',
      {
        namespace,
        digest,
        objectType: encoded.preimage.objectType,
        path,
        details: {
          expectedPayloadByteLength: encoded.payloadBytes.byteLength,
          receivedPayloadByteLength: record.payloadByteLength,
          expectedPreimageByteLength: encoded.preimageBytes.byteLength,
          receivedPreimageByteLength: record.preimageByteLength,
        },
      },
    );
  }

  return Object.freeze({
    record: cloneVersionObjectRecord({
      namespace,
      preimage: encoded.preimage as VersionObjectPreimage<TPayload>,
      digest,
      payloadByteLength: encoded.payloadBytes.byteLength,
      preimageByteLength: encoded.preimageBytes.byteLength,
    }),
    dependencies: encoded.dependencies,
  });
}

export function dependencyMatchesRecord(
  namespace: VersionGraphNamespace,
  dependency: VersionDependencyRef,
  record: VersionObjectRecord<unknown>,
): boolean {
  if (!recordBelongsToNamespace(namespace, record)) {
    return false;
  }
  if (!objectDigestsEqual(record.digest, dependency.digest)) {
    return false;
  }
  if (dependency.kind === 'object') {
    return record.preimage.objectType === dependency.objectType;
  }
  return record.preimage.objectType === 'workbook.commit.v1';
}

export function recordBelongsToNamespace(
  namespace: VersionGraphNamespace,
  record: VersionObjectRecord<unknown>,
): boolean {
  try {
    return versionGraphNamespaceKey(record.namespace) === versionGraphNamespaceKey(namespace);
  } catch {
    return false;
  }
}

export function versionObjectRecordsMatch(
  left: VersionObjectRecord<unknown>,
  right: VersionObjectRecord<unknown>,
): boolean {
  try {
    return (
      versionGraphNamespaceKey(left.namespace) === versionGraphNamespaceKey(right.namespace) &&
      objectDigestsEqual(left.digest, right.digest) &&
      left.payloadByteLength === right.payloadByteLength &&
      left.preimageByteLength === right.preimageByteLength &&
      preimageBytesMatch(left.preimage, right.preimage)
    );
  } catch {
    return false;
  }
}

export function cloneVersionObjectRecord<TPayload>(
  record: VersionObjectRecord<TPayload>,
): VersionObjectRecord<TPayload> {
  const compatibilityHeader = cloneVersionObjectCompatibilityHeader(record.preimage);
  return Object.freeze({
    namespace: normalizeVersionGraphNamespace(record.namespace),
    preimage: Object.freeze({
      objectType: record.preimage.objectType,
      schemaVersion: record.preimage.schemaVersion,
      minReaderVersion: compatibilityHeader.minReaderVersion,
      minWriterVersion: compatibilityHeader.minWriterVersion,
      payloadEncoding: record.preimage.payloadEncoding,
      dependencies: Object.freeze(record.preimage.dependencies.map(cloneDependencyRef)),
      payload: clonePayload(record.preimage.payload),
    }),
    digest: { ...record.digest },
    payloadByteLength: record.payloadByteLength,
    preimageByteLength: record.preimageByteLength,
  });
}

function objectDigestsEqual(left: ObjectDigest, right: ObjectDigest): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
}

function preimageBytesMatch(
  left: VersionObjectPreimage<unknown>,
  right: VersionObjectPreimage<unknown>,
): boolean {
  const leftEncoded = encodeVersionObjectPreimage(left);
  const rightEncoded = encodeVersionObjectPreimage(right);
  return bytesEqual(leftEncoded.preimageBytes, rightEncoded.preimageBytes);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function cloneDependencyRef(dependency: VersionDependencyRef): VersionDependencyRef {
  if (dependency.kind === 'object') {
    return {
      kind: 'object',
      objectType: dependency.objectType,
      digest: { ...dependency.digest },
    };
  }
  return {
    kind: 'commit',
    commitId: dependency.commitId,
    digest: { ...dependency.digest },
  };
}

function assertNonNegativeSafeInteger(
  value: unknown,
  path: string,
  code: VersionObjectStoreDiagnosticCode,
): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throwValidation(code, 'Version object byte lengths must be non-negative safe integers.', {
      path,
      details: { received: String(value) },
    });
  }
}
