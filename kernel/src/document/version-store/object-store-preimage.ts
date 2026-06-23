import {
  canonicalizeVersionDependencies,
  isVersionObjectType,
  type VersionDependencyRef,
  type VersionObjectType,
} from './object-digest';
import {
  assertVersionObjectPreimageHeaderKeys,
  normalizeVersionObjectCompatibilityHeader,
  type VersionObjectPreimage,
} from './object-header';
import {
  canonicalJsonStringify,
  cloneBytesPayload,
  concatBytes,
  isPlainRecord,
  normalizeCanonicalJsonValue,
  utf8Encode,
} from './object-store-canonical';
import { throwValidation } from './object-store-diagnostics';

export const VERSION_OBJECT_PREIMAGE_DOMAIN = 'mog.version-object.v1\n';
export const VERSION_OBJECT_SCHEMA_VERSION = 1;

export function encodeVersionObjectPreimage<TPayload>(preimage: VersionObjectPreimage<TPayload>): {
  readonly preimage: VersionObjectPreimage<unknown>;
  readonly dependencies: readonly VersionDependencyRef[];
  readonly payloadBytes: Uint8Array;
  readonly preimageBytes: Uint8Array;
} {
  if (!isPlainRecord(preimage)) {
    throwValidation('VERSION_INVALID_PREIMAGE', 'Version object preimage must be an object.');
  }
  assertVersionObjectPreimageHeaderKeys(preimage, 'preimage');

  if (!isVersionObjectType(preimage.objectType)) {
    throwValidation('VERSION_UNSUPPORTED_OBJECT_TYPE', 'Version object type is not supported.', {
      objectType:
        typeof preimage.objectType === 'string'
          ? (preimage.objectType as VersionObjectType)
          : undefined,
      path: 'preimage.objectType',
    });
  }

  if (preimage.schemaVersion !== VERSION_OBJECT_SCHEMA_VERSION) {
    throwValidation(
      'VERSION_UNSUPPORTED_SCHEMA',
      'Version object schema version is not supported.',
      {
        objectType: preimage.objectType,
        path: 'preimage.schemaVersion',
        details: {
          expected: VERSION_OBJECT_SCHEMA_VERSION,
          received: String(preimage.schemaVersion),
        },
      },
    );
  }

  const compatibilityHeader = normalizeVersionObjectCompatibilityHeader(preimage, 'preimage');

  if (
    preimage.payloadEncoding !== 'mog-canonical-json-v1' &&
    preimage.payloadEncoding !== 'bytes'
  ) {
    throwValidation(
      'VERSION_UNSUPPORTED_PAYLOAD_ENCODING',
      'Version object payload encoding is not supported.',
      {
        objectType: preimage.objectType,
        path: 'preimage.payloadEncoding',
        details: { received: String(preimage.payloadEncoding) },
      },
    );
  }

  const dependencies = canonicalizeVersionDependencies(preimage.dependencies);
  const canonicalPayload =
    preimage.payloadEncoding === 'bytes'
      ? cloneBytesPayload(preimage.payload, 'preimage.payload')
      : normalizeCanonicalJsonValue(preimage.payload, 'preimage.payload');
  const payloadBytes =
    preimage.payloadEncoding === 'bytes'
      ? (canonicalPayload as Uint8Array)
      : utf8Encode(canonicalJsonStringify(canonicalPayload));
  const dependencyBytes = utf8Encode(canonicalJsonStringify(dependencies));
  const preimageBytes = concatBytes(
    utf8Encode(VERSION_OBJECT_PREIMAGE_DOMAIN),
    utf8Encode(`${preimage.objectType}\n`),
    utf8Encode(`${preimage.schemaVersion}\n`),
    utf8Encode(`${compatibilityHeader.minReaderVersion}\n`),
    utf8Encode(`${compatibilityHeader.minWriterVersion}\n`),
    utf8Encode(`${preimage.payloadEncoding}\n`),
    dependencyBytes,
    utf8Encode('\n'),
    payloadBytes,
  );

  return Object.freeze({
    preimage: Object.freeze({
      objectType: preimage.objectType,
      schemaVersion: preimage.schemaVersion,
      minReaderVersion: compatibilityHeader.minReaderVersion,
      minWriterVersion: compatibilityHeader.minWriterVersion,
      payloadEncoding: preimage.payloadEncoding,
      dependencies,
      payload: canonicalPayload,
    }),
    dependencies,
    payloadBytes,
    preimageBytes,
  });
}
