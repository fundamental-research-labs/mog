import type {
  ObjectDigest,
  VersionBranchName,
  VersionBranchNameInput,
  VersionCommitExpectedHead,
  VersionDiagnostic,
  VersionError,
  VersionMainRefName,
  VersionRecordRevision,
  VersionRef,
  VersionRefName,
  VersionResult,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '../api/workbook';

type UnknownRecord = Readonly<Record<string, unknown>>;

const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
const VERSION_OBJECT_DIGEST_RE = /^[0-9a-f]{64}$/;
const VERSION_BRANCH_NAME_RE =
  /^(main|[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?(?:\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)*)$/;
const VERSION_REF_PREFIX = 'refs/heads/';
const VERSION_MAIN_REF = 'refs/heads/main' as VersionMainRefName;
const VERSION_BRANCH_NAME_MAX_BYTES = 128;
const VERSION_STALE_TARGET_DIAGNOSTIC_CODES = new Set([
  'VERSION_REF_CONFLICT',
  'VERSION_CHECKOUT_STALE_WORKSPACE_HEAD',
]);

export class VersionPublicApiValueError extends TypeError {
  readonly helper: string;
  readonly expected: string;
  readonly value: unknown;

  constructor(helper: string, expected: string, value: unknown) {
    super(`${helper} expected ${expected}.`);
    this.name = 'VersionPublicApiValueError';
    this.helper = helper;
    this.expected = expected;
    this.value = value;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class VersionResultError extends Error {
  readonly error: VersionError;

  constructor(error: VersionError) {
    super(formatVersionError(error));
    this.name = 'VersionResultError';
    this.error = error;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function parseWorkbookCommitId(value: unknown): WorkbookCommitId {
  if (!isWorkbookCommitId(value)) {
    throw invalidValue(
      'parseWorkbookCommitId',
      'commit:sha256:<64 lowercase hex characters>',
      value,
    );
  }
  return value;
}

export function isWorkbookCommitId(value: unknown): value is WorkbookCommitId {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value);
}

export function parseVersionObjectDigest(value: unknown): ObjectDigest {
  if (!isPlainRecord(value)) {
    throw invalidValue('parseVersionObjectDigest', 'a sha256 version object digest', value);
  }

  const keys = Object.keys(value);
  const hasByteLength = Object.prototype.hasOwnProperty.call(value, 'byteLength');
  const expectedKeyCount = hasByteLength ? 3 : 2;
  if (
    keys.length !== expectedKeyCount ||
    value.algorithm !== 'sha256' ||
    typeof value.digest !== 'string' ||
    !VERSION_OBJECT_DIGEST_RE.test(value.digest) ||
    (hasByteLength && !isValidByteLength(value.byteLength))
  ) {
    throw invalidValue(
      'parseVersionObjectDigest',
      '{ algorithm: "sha256"; digest: <64 lowercase hex>; byteLength?: non-negative integer }',
      value,
    );
  }

  const digest = {
    algorithm: 'sha256',
    digest: value.digest,
    ...(hasByteLength ? { byteLength: value.byteLength as number } : {}),
  } satisfies ObjectDigest;
  return Object.freeze(digest);
}

export function isVersionObjectDigest(value: unknown): value is ObjectDigest {
  try {
    parseVersionObjectDigest(value);
    return true;
  } catch {
    return false;
  }
}

export function parseVersionBranchName(value: unknown): VersionBranchName {
  if (!isVersionBranchName(value)) {
    throw invalidValue(
      'parseVersionBranchName',
      'a public branch name such as "main", "analysis", or "team/q2-forecast"',
      value,
    );
  }
  return value;
}

export function isVersionBranchName(value: unknown): value is VersionBranchName {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > VERSION_BRANCH_NAME_MAX_BYTES) return false;
  if (value === 'HEAD' || value === 'detached') return false;
  if (value === 'refs' || value.startsWith('refs/')) return false;
  if (value.startsWith('main/')) return false;
  if (!VERSION_BRANCH_NAME_RE.test(value)) return false;
  for (const segment of value.split('/')) {
    if (segment.length === 0 || segment === '.' || segment === '..') return false;
    if (segment === '.lock' || segment.endsWith('.lock')) return false;
  }
  return isVisibleAsciiRefName(value);
}

export function parseVersionRefName(value: unknown): VersionMainRefName | VersionRefName {
  if (!isVersionRefName(value)) {
    throw invalidValue(
      'parseVersionRefName',
      'a canonical public branch ref such as "refs/heads/main" or "refs/heads/team/q2-forecast"',
      value,
    );
  }
  return value;
}

export function isVersionRefName(value: unknown): value is VersionMainRefName | VersionRefName {
  if (typeof value !== 'string' || !value.startsWith(VERSION_REF_PREFIX)) return false;
  const suffix = value.slice(VERSION_REF_PREFIX.length);
  return isVersionBranchName(suffix);
}

export function branchRef(name: VersionBranchNameInput): VersionMainRefName | VersionRefName {
  if (typeof name === 'string' && name.startsWith(VERSION_REF_PREFIX)) {
    return parseVersionRefName(name);
  }

  const parsedName = parseVersionBranchName(name);
  return parsedName === 'main'
    ? VERSION_MAIN_REF
    : (`${VERSION_REF_PREFIX}${parsedName}` as VersionRefName);
}

export function branchName(ref: VersionMainRefName | VersionRefName): VersionBranchName {
  const parsedRef = parseVersionRefName(ref);
  return parseVersionBranchName(parsedRef.slice(VERSION_REF_PREFIX.length));
}

export function expectedHeadFromRef(ref: VersionRef): VersionCommitExpectedHead {
  return Object.freeze({
    commitId: parseWorkbookCommitId(ref.commitId),
    revision: parseVersionRecordRevision(ref.revision),
  });
}

export function unwrapVersionResult<T>(result: VersionResult<T>): T {
  if (result.ok) return result.value;
  throw new VersionResultError(result.error);
}

export function formatVersionDiagnostics(diagnostics: readonly VersionStoreDiagnostic[]): string {
  return diagnostics
    .map(
      (diagnostic) =>
        `${diagnostic.severity.toUpperCase()} ${diagnostic.issueCode}: ${diagnostic.safeMessage}`,
    )
    .join('\n');
}

export function isVersionBlocked(result: unknown): boolean {
  const payload = versionResultPayload(result);
  if (isRecordWithStatus(payload, 'blocked') || isRecordWithStatus(payload, 'conflicted')) {
    return true;
  }
  return (
    isVersionErrorCode(payload, 'version_capability_unavailable') ||
    isVersionErrorCode(payload, 'target_unavailable') ||
    isVersionErrorCode(payload, 'redaction_blocked')
  );
}

export function isVersionStaleTarget(result: unknown): boolean {
  const payload = versionResultPayload(result);
  if (isRecordWithStatus(payload, 'staleTargetHead')) return true;
  if (isVersionErrorCode(payload, 'stale_head') || isVersionErrorCode(payload, 'stale_revision')) {
    return true;
  }
  return diagnosticsFrom(payload).some((diagnostic) =>
    VERSION_STALE_TARGET_DIAGNOSTIC_CODES.has(String(diagnostic.issueCode)),
  );
}

function invalidValue(
  helper: string,
  expected: string,
  value: unknown,
): VersionPublicApiValueError {
  return new VersionPublicApiValueError(helper, expected, value);
}

function isPlainRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidByteLength(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isVisibleAsciiRefName(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code > 0x7e || value[index] === '%') return false;
  }
  return true;
}

function parseVersionRecordRevision(value: VersionRecordRevision): VersionRecordRevision {
  if (!isPlainRecord(value) || (value.kind !== 'counter' && value.kind !== 'opaque')) {
    throw invalidValue(
      'expectedHeadFromRef',
      'a VersionRef with a counter or opaque revision',
      value,
    );
  }
  if (typeof value.value !== 'string' || value.value.length === 0) {
    throw invalidValue(
      'expectedHeadFromRef',
      'a VersionRef with a non-empty revision value',
      value,
    );
  }
  return Object.freeze({ kind: value.kind, value: value.value }) as VersionRecordRevision;
}

function versionResultPayload(value: unknown): unknown {
  if (!isPlainRecord(value) || typeof value.ok !== 'boolean') return value;
  return value.ok ? value.value : value.error;
}

function isRecordWithStatus(value: unknown, status: string): boolean {
  return isPlainRecord(value) && value.status === status;
}

function isVersionErrorCode(value: unknown, code: VersionError['code']): boolean {
  return isPlainRecord(value) && value.code === code;
}

function diagnosticsFrom(value: unknown): readonly UnknownRecord[] {
  if (!isPlainRecord(value) || !Array.isArray(value.diagnostics)) return [];
  return value.diagnostics.filter(isPlainRecord);
}

function formatVersionError(error: VersionError): string {
  const detail = formatVersionErrorDetail(error);
  const diagnostics = diagnosticsFromVersionError(error);
  if (diagnostics.length === 0) return detail;
  return `${detail}\n${diagnostics.map((diagnostic) => diagnostic.message).join('\n')}`;
}

function formatVersionErrorDetail(error: VersionError): string {
  switch (error.code) {
    case 'version_capability_unavailable':
      return error.reason;
    case 'not_found':
      return `${error.target} not found: ${error.reason}`;
    case 'stale_revision':
      return `Stale revision: expected ${error.expectedRevision}, found ${error.actualRevision}.`;
    case 'stale_head':
      return `Stale head: expected ${error.expectedHeadId}, found ${error.actualHeadId}.`;
    case 'invalid_state':
      return `Invalid state ${error.state}: ${error.reason}`;
    case 'invalid_branch_name':
      return `Invalid branch name ${error.branchName}: ${error.reason}`;
    case 'redaction_blocked':
      return error.reason;
    case 'target_unavailable':
      return `Target unavailable: ${error.target}.`;
  }
}

function diagnosticsFromVersionError(error: VersionError): readonly VersionDiagnostic[] {
  switch (error.code) {
    case 'version_capability_unavailable':
      return error.diagnostics ?? [];
    case 'target_unavailable':
      return error.diagnostics;
    default:
      return [];
  }
}
