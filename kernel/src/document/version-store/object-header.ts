import type { VersionDependencyRef, VersionObjectType } from './object-digest';

export const VERSION_OBJECT_MIN_COMPATIBILITY_VERSION = 'VC-10';
export const VERSION_OBJECT_CURRENT_COMPATIBILITY_VERSION = 'VC-11';

export type VersionObjectCompatibilityVersion = `VC-${number}`;

export type VersionObjectPayloadEncoding = 'mog-canonical-json-v1' | 'bytes';

export type VersionObjectPreimage<TPayload> = {
  readonly objectType: VersionObjectType;
  readonly schemaVersion: 1;
  readonly minReaderVersion?: VersionObjectCompatibilityVersion;
  readonly minWriterVersion?: VersionObjectCompatibilityVersion;
  readonly payloadEncoding: VersionObjectPayloadEncoding;
  readonly dependencies: readonly VersionDependencyRef[];
  readonly payload: TPayload;
};

export type VersionObjectCompatibilityHeader = {
  readonly minReaderVersion: VersionObjectCompatibilityVersion;
  readonly minWriterVersion: VersionObjectCompatibilityVersion;
};

export type VersionObjectHeaderIssue = 'VERSION_INVALID_PREIMAGE' | 'VERSION_UNSUPPORTED_SCHEMA';

export class VersionObjectHeaderError extends Error {
  readonly issue: VersionObjectHeaderIssue;
  readonly path: string;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    issue: VersionObjectHeaderIssue,
    message: string,
    path: string,
    details: Readonly<Record<string, string | number | boolean | null>> = {},
  ) {
    super(message);
    this.name = 'VersionObjectHeaderError';
    this.issue = issue;
    this.path = path;
    this.details = details;
  }
}

export function assertVersionObjectPreimageHeaderKeys(
  value: Readonly<Record<string, unknown>>,
  path = 'preimage',
): void {
  const allowed = new Set([
    'objectType',
    'schemaVersion',
    'minReaderVersion',
    'minWriterVersion',
    'payloadEncoding',
    'dependencies',
    'payload',
  ]);
  const unsupported = Object.keys(value).find((key) => !allowed.has(key));
  if (unsupported) {
    throw new VersionObjectHeaderError(
      'VERSION_INVALID_PREIMAGE',
      'Version object preimage has an unsupported header field.',
      `${path}.${unsupported}`,
      { field: unsupported },
    );
  }
}

export function normalizeVersionObjectCompatibilityHeader(
  value: {
    readonly minReaderVersion?: unknown;
    readonly minWriterVersion?: unknown;
  },
  path = 'preimage',
): VersionObjectCompatibilityHeader {
  return Object.freeze({
    minReaderVersion: normalizeCompatibilityVersion(
      value.minReaderVersion,
      `${path}.minReaderVersion`,
      'minReaderVersion',
    ),
    minWriterVersion: normalizeCompatibilityVersion(
      value.minWriterVersion,
      `${path}.minWriterVersion`,
      'minWriterVersion',
    ),
  });
}

export function cloneVersionObjectCompatibilityHeader(value: {
  readonly minReaderVersion?: unknown;
  readonly minWriterVersion?: unknown;
}): VersionObjectCompatibilityHeader {
  return Object.freeze({
    minReaderVersion:
      value.minReaderVersion === undefined
        ? (VERSION_OBJECT_MIN_COMPATIBILITY_VERSION as VersionObjectCompatibilityVersion)
        : (value.minReaderVersion as VersionObjectCompatibilityVersion),
    minWriterVersion:
      value.minWriterVersion === undefined
        ? (VERSION_OBJECT_MIN_COMPATIBILITY_VERSION as VersionObjectCompatibilityVersion)
        : (value.minWriterVersion as VersionObjectCompatibilityVersion),
  });
}

const COMPATIBILITY_VERSION_RE = /^VC-(\d+)$/;
const MIN_COMPATIBILITY_NUMBER = requiredCompatibilityVersionNumber(
  VERSION_OBJECT_MIN_COMPATIBILITY_VERSION,
);
const CURRENT_COMPATIBILITY_NUMBER = requiredCompatibilityVersionNumber(
  VERSION_OBJECT_CURRENT_COMPATIBILITY_VERSION,
);

function normalizeCompatibilityVersion(
  value: unknown,
  path: string,
  field: 'minReaderVersion' | 'minWriterVersion',
): VersionObjectCompatibilityVersion {
  if (value === undefined) {
    return VERSION_OBJECT_MIN_COMPATIBILITY_VERSION as VersionObjectCompatibilityVersion;
  }
  if (typeof value !== 'string') {
    throw new VersionObjectHeaderError(
      'VERSION_INVALID_PREIMAGE',
      'Version object compatibility versions must be VC-<number> strings.',
      path,
      { field, received: String(value) },
    );
  }
  const parsed = compatibilityVersionNumber(value);
  if (parsed === null) {
    throw new VersionObjectHeaderError(
      'VERSION_INVALID_PREIMAGE',
      'Version object compatibility versions must be VC-<number> strings.',
      path,
      { field, received: value },
    );
  }
  if (parsed < MIN_COMPATIBILITY_NUMBER || parsed > CURRENT_COMPATIBILITY_NUMBER) {
    throw new VersionObjectHeaderError(
      'VERSION_UNSUPPORTED_SCHEMA',
      'Version object compatibility version is outside this reader/writer window.',
      path,
      {
        field,
        minSupportedVersion: VERSION_OBJECT_MIN_COMPATIBILITY_VERSION,
        currentVersion: VERSION_OBJECT_CURRENT_COMPATIBILITY_VERSION,
        received: value,
      },
    );
  }
  return value as VersionObjectCompatibilityVersion;
}

function compatibilityVersionNumber(value: string): number | null {
  const match = COMPATIBILITY_VERSION_RE.exec(value);
  return match ? Number(match[1]) : null;
}

function requiredCompatibilityVersionNumber(value: string): number {
  const parsed = compatibilityVersionNumber(value);
  if (parsed === null) throw new Error(`Invalid version object compatibility version: ${value}`);
  return parsed;
}
