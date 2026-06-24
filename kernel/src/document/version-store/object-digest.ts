export const VERSION_OBJECT_TYPES = Object.freeze([
  'workbook.commit.v1',
  'workbook.snapshotRoot.v1',
  'workbook.snapshotChunk.v1',
  'workbook.semanticChangeSet.v1',
  'workbook.mutationSegment.v1',
  'workbook.verificationSummary.v1',
  'workbook.redactionSummary.v1',
  'workbook.authorizationSnapshot.v1',
  'workbook.opaqueDescriptor.v1',
  'workbook.reviewExtension.v1',
  'workbook.mergePreview.v1',
  'workbook.mergeResolutionSet.v1',
  'workbook.mergeResolutionSet.v2',
  'workbook.resolvedMergeAttempt.v1',
] as const);

export type VersionObjectType = (typeof VERSION_OBJECT_TYPES)[number];

export interface ObjectDigest {
  readonly algorithm: 'sha256';
  readonly digest: string;
}

export type WorkbookCommitId = `commit:sha256:${string}` & {
  readonly __brand: 'WorkbookCommitId';
};

export type VersionDependencyRef =
  | {
      readonly kind: 'object';
      readonly objectType: VersionObjectType;
      readonly digest: ObjectDigest;
    }
  | {
      readonly kind: 'commit';
      readonly commitId: WorkbookCommitId;
      readonly digest: ObjectDigest;
    };

export type VersionObjectDigestIssue =
  | 'VERSION_INVALID_DIGEST'
  | 'VERSION_UNSUPPORTED_DIGEST_ALGORITHM'
  | 'VERSION_INVALID_COMMIT_ID'
  | 'VERSION_UNSUPPORTED_OBJECT_TYPE'
  | 'VERSION_DIGEST_MISMATCH'
  | 'VERSION_DUPLICATE_DEPENDENCY'
  | 'VERSION_INVALID_DEPENDENCY';

const OBJECT_DIGEST_HEX_RE = /^[0-9a-f]{64}$/;
const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:([0-9a-f]{64})$/;
const VERSION_OBJECT_TYPE_SET = new Set<string>(VERSION_OBJECT_TYPES);

export class VersionObjectDigestError extends Error {
  readonly issue: VersionObjectDigestIssue;
  readonly details: {
    readonly paramName: string;
    readonly expected: string;
    readonly received: string;
  };

  constructor(
    issue: VersionObjectDigestIssue,
    paramName: string,
    expected: string,
    received: unknown,
  ) {
    super(`${paramName} must be ${expected}.`);
    this.name = 'VersionObjectDigestError';
    this.issue = issue;
    this.details = {
      paramName,
      expected,
      received: formatReceived(received),
    };
  }
}

export function parseObjectDigest(value: unknown, paramName = 'digest'): ObjectDigest {
  if (!isPlainRecord(value)) {
    throw invalidDigest(paramName, value);
  }

  assertExactKeys(value, ['algorithm', 'digest'], 'VERSION_INVALID_DIGEST', paramName);

  if (value.algorithm !== 'sha256') {
    throw new VersionObjectDigestError(
      'VERSION_UNSUPPORTED_DIGEST_ALGORITHM',
      `${paramName}.algorithm`,
      '"sha256"',
      value.algorithm,
    );
  }

  if (typeof value.digest !== 'string' || !OBJECT_DIGEST_HEX_RE.test(value.digest)) {
    throw invalidDigest(`${paramName}.digest`, value.digest);
  }

  return Object.freeze({ algorithm: 'sha256', digest: value.digest });
}

export function isObjectDigest(value: unknown): value is ObjectDigest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Readonly<Record<string, unknown>>;
  return (
    Object.keys(record).length === 2 &&
    record.algorithm === 'sha256' &&
    typeof record.digest === 'string' &&
    OBJECT_DIGEST_HEX_RE.test(record.digest)
  );
}

export function parseWorkbookCommitId(value: unknown, paramName = 'commitId'): WorkbookCommitId {
  if (typeof value !== 'string' || !WORKBOOK_COMMIT_ID_RE.test(value)) {
    throw new VersionObjectDigestError(
      'VERSION_INVALID_COMMIT_ID',
      paramName,
      'commit:sha256:<64 lowercase hex>',
      value,
    );
  }
  return value as WorkbookCommitId;
}

export function isWorkbookCommitId(value: unknown): value is WorkbookCommitId {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value);
}

export function objectDigestFromWorkbookCommitId(commitId: WorkbookCommitId): ObjectDigest {
  const parsedCommitId = parseWorkbookCommitId(commitId);
  return Object.freeze({
    algorithm: 'sha256',
    digest: parsedCommitId.slice('commit:sha256:'.length),
  });
}

export function workbookCommitIdFromObjectDigest(digest: ObjectDigest): WorkbookCommitId {
  const parsedDigest = parseObjectDigest(digest);
  return `commit:sha256:${parsedDigest.digest}` as WorkbookCommitId;
}

export function isVersionObjectType(value: unknown): value is VersionObjectType {
  return typeof value === 'string' && VERSION_OBJECT_TYPE_SET.has(value);
}

export function canonicalizeVersionDependencies(
  dependencies: readonly unknown[],
): readonly VersionDependencyRef[] {
  if (!Array.isArray(dependencies)) {
    throw new VersionObjectDigestError(
      'VERSION_INVALID_DEPENDENCY',
      'dependencies',
      'an array',
      dependencies,
    );
  }

  const canonical = dependencies.map((dependency, index) =>
    parseVersionDependencyRef(dependency, `dependencies[${index}]`),
  );
  canonical.sort(compareVersionDependencies);

  for (let i = 1; i < canonical.length; i++) {
    if (versionDependencySortKey(canonical[i - 1]) === versionDependencySortKey(canonical[i])) {
      throw new VersionObjectDigestError(
        'VERSION_DUPLICATE_DEPENDENCY',
        'dependencies',
        'unique canonical dependency refs',
        canonical[i],
      );
    }
  }

  return Object.freeze(canonical);
}

export function versionDependencySortKey(dependency: VersionDependencyRef): string {
  if (dependency.kind === 'object') {
    return [
      dependency.kind,
      dependency.objectType,
      dependency.digest.algorithm,
      dependency.digest.digest,
      '',
    ].join('\u0000');
  }

  return [
    dependency.kind,
    '',
    dependency.digest.algorithm,
    dependency.digest.digest,
    dependency.commitId,
  ].join('\u0000');
}

function parseVersionDependencyRef(value: unknown, paramName: string): VersionDependencyRef {
  if (!isPlainRecord(value)) {
    throw new VersionObjectDigestError(
      'VERSION_INVALID_DEPENDENCY',
      paramName,
      'a dependency ref object',
      value,
    );
  }

  if (value.kind === 'object') {
    assertExactKeys(
      value,
      ['kind', 'objectType', 'digest'],
      'VERSION_INVALID_DEPENDENCY',
      paramName,
    );
    if (!isVersionObjectType(value.objectType)) {
      throw new VersionObjectDigestError(
        'VERSION_UNSUPPORTED_OBJECT_TYPE',
        `${paramName}.objectType`,
        VERSION_OBJECT_TYPES.join(', '),
        value.objectType,
      );
    }
    return Object.freeze({
      kind: 'object',
      objectType: value.objectType,
      digest: parseObjectDigest(value.digest, `${paramName}.digest`),
    });
  }

  if (value.kind === 'commit') {
    assertExactKeys(value, ['kind', 'commitId', 'digest'], 'VERSION_INVALID_DEPENDENCY', paramName);
    const commitId = parseWorkbookCommitId(value.commitId, `${paramName}.commitId`);
    const digest = parseObjectDigest(value.digest, `${paramName}.digest`);
    const expectedDigest = objectDigestFromWorkbookCommitId(commitId);
    if (digest.digest !== expectedDigest.digest) {
      throw new VersionObjectDigestError(
        'VERSION_DIGEST_MISMATCH',
        `${paramName}.digest`,
        expectedDigest.digest,
        digest,
      );
    }
    return Object.freeze({ kind: 'commit', commitId, digest });
  }

  throw new VersionObjectDigestError(
    'VERSION_INVALID_DEPENDENCY',
    `${paramName}.kind`,
    '"object" or "commit"',
    value.kind,
  );
}

function compareVersionDependencies(
  left: VersionDependencyRef,
  right: VersionDependencyRef,
): number {
  const leftKey = versionDependencySortKey(left);
  const rightKey = versionDependencySortKey(right);
  if (leftKey < rightKey) return -1;
  if (leftKey > rightKey) return 1;
  return 0;
}

function assertExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  issue: VersionObjectDigestIssue,
  paramName: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new VersionObjectDigestError(
      issue,
      paramName,
      `exact keys: ${expected.join(', ')}`,
      actual,
    );
  }
}

function invalidDigest(paramName: string, received: unknown): VersionObjectDigestError {
  return new VersionObjectDigestError(
    'VERSION_INVALID_DIGEST',
    paramName,
    '{ algorithm: "sha256", digest: <64 lowercase hex> }',
    received,
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function formatReceived(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}
