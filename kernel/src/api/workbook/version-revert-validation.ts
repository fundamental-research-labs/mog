import type {
  VersionRecordRevision,
  VersionRevertInput,
  VersionRevertOptions,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import { invalidOptionDiagnostic } from './version-revert-diagnostics';

const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;

const REVERT_INPUT_KEYS = new Set([
  'target',
  'targetRef',
  'expectedTargetHead',
  'preflight',
  'clientRequestId',
  'reason',
]);
const REVERT_OPTIONS_KEYS = new Set(['dryRun', 'includeDiagnostics']);
const REVERT_TARGET_KEYS = new Set([
  'kind',
  'commitId',
  'baseCommitId',
  'headCommitId',
  'mainlineParent',
]);
const REVERT_COMMIT_TARGET_KEYS = new Set(['kind', 'commitId']);
const REVERT_RANGE_TARGET_KEYS = new Set(['kind', 'baseCommitId', 'headCommitId']);
const REVERT_MERGE_COMMIT_TARGET_KEYS = new Set(['kind', 'commitId', 'mainlineParent']);
const EXPECTED_HEAD_KEYS = new Set(['commitId', 'revision', 'symbolicHeadRevision']);
const REVISION_KEYS = new Set(['kind', 'value']);
const PREFLIGHT_KEYS = new Set([
  'unsupportedDomains',
  'opaqueDomains',
  'staleHead',
  'gaps',
  'cas',
  'reviewInvalidation',
]);
const DOMAIN_ADMISSION_KEYS = new Set(['domain', 'matrixRowId', 'reason']);
const STALE_HEAD_KEYS = new Set(['refName', 'expectedCommitId', 'actualCommitId']);
const HISTORY_GAP_KEYS = new Set(['gapId', 'reason']);
const CAS_KEYS = new Set(['refName', 'expectedRevision', 'reason']);
const REVIEW_INVALIDATION_KEYS = new Set(['reviewId', 'expectedRevision', 'reason']);

export type RevertValidationResult =
  | {
      readonly ok: true;
      readonly input: VersionRevertInput;
      readonly options: VersionRevertOptions;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export function validateRevertRequest(input: unknown, options: unknown): RevertValidationResult {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isRecord(input) || Array.isArray(input)) {
    diagnostics.push(invalidOptionDiagnostic('input', 'revert input must be an object.'));
    return { ok: false, diagnostics };
  }
  validateKnownKeys(input, REVERT_INPUT_KEYS, diagnostics);
  validateTarget(input.target, diagnostics);
  validateOptionalString(input, 'targetRef', diagnostics);
  validateOptionalCommitExpectedHead(input, 'expectedTargetHead', diagnostics);
  validateOptionalString(input, 'clientRequestId', diagnostics);
  validateOptionalString(input, 'reason', diagnostics);
  validatePreflight(input.preflight, diagnostics);
  validateOptions(options, diagnostics);
  return diagnostics.length > 0
    ? { ok: false, diagnostics }
    : {
        ok: true,
        input: input as unknown as VersionRevertInput,
        options: options as unknown as VersionRevertOptions,
      };
}

function validateTarget(value: unknown, diagnostics: VersionStoreDiagnostic[]): void {
  if (!isRecord(value) || Array.isArray(value)) {
    diagnostics.push(invalidOptionDiagnostic('target', 'revert target must be an object.'));
    return;
  }
  switch (value.kind) {
    case 'commit':
      validateKnownKeys(value, REVERT_COMMIT_TARGET_KEYS, diagnostics, 'target');
      validateCommitId(value.commitId, 'target.commitId', diagnostics);
      break;
    case 'range':
      validateKnownKeys(value, REVERT_RANGE_TARGET_KEYS, diagnostics, 'target');
      validateCommitId(value.baseCommitId, 'target.baseCommitId', diagnostics);
      validateCommitId(value.headCommitId, 'target.headCommitId', diagnostics);
      break;
    case 'mergeCommit':
      validateKnownKeys(value, REVERT_MERGE_COMMIT_TARGET_KEYS, diagnostics, 'target');
      validateCommitId(value.commitId, 'target.commitId', diagnostics);
      validatePositiveInteger(value.mainlineParent, 'target.mainlineParent', diagnostics);
      break;
    default:
      validateKnownKeys(value, REVERT_TARGET_KEYS, diagnostics, 'target');
      diagnostics.push(
        invalidOptionDiagnostic('target.kind', 'revert target kind is unsupported.'),
      );
  }
}

function validatePreflight(value: unknown, diagnostics: VersionStoreDiagnostic[]): void {
  if (value === undefined) return;
  if (!isRecord(value) || Array.isArray(value)) {
    diagnostics.push(invalidOptionDiagnostic('preflight', 'preflight must be an object.'));
    return;
  }
  validateKnownKeys(value, PREFLIGHT_KEYS, diagnostics, 'preflight');
  validateDomainAdmissionList(
    value.unsupportedDomains,
    'preflight.unsupportedDomains',
    diagnostics,
  );
  validateDomainAdmissionList(value.opaqueDomains, 'preflight.opaqueDomains', diagnostics);
  validateStaleHead(value.staleHead, diagnostics);
  validateHistoryGapList(value.gaps, diagnostics);
  validateCas(value.cas, diagnostics);
  validateReviewInvalidationList(value.reviewInvalidation, diagnostics);
}

function validateDomainAdmissionList(
  value: unknown,
  path: string,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    diagnostics.push(invalidOptionDiagnostic(path, `${path} must be an array.`));
    return;
  }
  value.forEach((entry, index) => {
    const itemPath = `${path}.${index}`;
    if (!isRecord(entry) || Array.isArray(entry)) {
      diagnostics.push(invalidOptionDiagnostic(itemPath, `${itemPath} must be an object.`));
      return;
    }
    validateKnownKeys(entry, DOMAIN_ADMISSION_KEYS, diagnostics, itemPath);
    validateRequiredString(entry, 'domain', diagnostics, itemPath);
    validateOptionalString(entry, 'matrixRowId', diagnostics, itemPath);
    validateOptionalString(entry, 'reason', diagnostics, itemPath);
  });
}

function validateStaleHead(value: unknown, diagnostics: VersionStoreDiagnostic[]): void {
  if (value === undefined) return;
  if (!isRecord(value) || Array.isArray(value)) {
    diagnostics.push(
      invalidOptionDiagnostic('preflight.staleHead', 'staleHead must be an object.'),
    );
    return;
  }
  validateKnownKeys(value, STALE_HEAD_KEYS, diagnostics, 'preflight.staleHead');
  validateOptionalString(value, 'refName', diagnostics, 'preflight.staleHead');
  validateCommitId(value.expectedCommitId, 'preflight.staleHead.expectedCommitId', diagnostics);
  if ('actualCommitId' in value) {
    validateCommitId(value.actualCommitId, 'preflight.staleHead.actualCommitId', diagnostics);
  }
}

function validateHistoryGapList(value: unknown, diagnostics: VersionStoreDiagnostic[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    diagnostics.push(invalidOptionDiagnostic('preflight.gaps', 'gaps must be an array.'));
    return;
  }
  value.forEach((entry, index) => {
    const itemPath = `preflight.gaps.${index}`;
    if (!isRecord(entry) || Array.isArray(entry)) {
      diagnostics.push(invalidOptionDiagnostic(itemPath, `${itemPath} must be an object.`));
      return;
    }
    validateKnownKeys(entry, HISTORY_GAP_KEYS, diagnostics, itemPath);
    validateRequiredString(entry, 'gapId', diagnostics, itemPath);
    validateOptionalString(entry, 'reason', diagnostics, itemPath);
  });
}

function validateCas(value: unknown, diagnostics: VersionStoreDiagnostic[]): void {
  if (value === undefined) return;
  if (!isRecord(value) || Array.isArray(value)) {
    diagnostics.push(invalidOptionDiagnostic('preflight.cas', 'cas must be an object.'));
    return;
  }
  validateKnownKeys(value, CAS_KEYS, diagnostics, 'preflight.cas');
  validateOptionalString(value, 'refName', diagnostics, 'preflight.cas');
  validateOptionalRevision(value, 'expectedRevision', diagnostics, 'preflight.cas');
  validateOptionalString(value, 'reason', diagnostics, 'preflight.cas');
}

function validateReviewInvalidationList(
  value: unknown,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    diagnostics.push(
      invalidOptionDiagnostic(
        'preflight.reviewInvalidation',
        'reviewInvalidation must be an array.',
      ),
    );
    return;
  }
  value.forEach((entry, index) => {
    const itemPath = `preflight.reviewInvalidation.${index}`;
    if (!isRecord(entry) || Array.isArray(entry)) {
      diagnostics.push(invalidOptionDiagnostic(itemPath, `${itemPath} must be an object.`));
      return;
    }
    validateKnownKeys(entry, REVIEW_INVALIDATION_KEYS, diagnostics, itemPath);
    validateRequiredString(entry, 'reviewId', diagnostics, itemPath);
    validateOptionalPositiveInteger(entry, 'expectedRevision', diagnostics, itemPath);
    validateOptionalString(entry, 'reason', diagnostics, itemPath);
  });
}

function validateOptions(value: unknown, diagnostics: VersionStoreDiagnostic[]): void {
  if (value === undefined) return;
  if (!isRecord(value) || Array.isArray(value)) {
    diagnostics.push(invalidOptionDiagnostic('options', 'revert options must be an object.'));
    return;
  }
  validateKnownKeys(value, REVERT_OPTIONS_KEYS, diagnostics, 'options');
  validateOptionalBoolean(value, 'dryRun', diagnostics, 'options');
  validateOptionalBoolean(value, 'includeDiagnostics', diagnostics, 'options');
}

function validateKnownKeys(
  input: Readonly<Record<string, unknown>>,
  allowedKeys: ReadonlySet<string>,
  diagnostics: VersionStoreDiagnostic[],
  path = '',
): void {
  for (const key of Object.keys(input)) {
    if (allowedKeys.has(key)) continue;
    const option = path ? `${path}.${key}` : key;
    diagnostics.push(invalidOptionDiagnostic(option, `Unknown revert option "${option}".`));
  }
}

function validateCommitId(
  value: unknown,
  option: string,
  diagnostics: VersionStoreDiagnostic[],
): value is WorkbookCommitId {
  if (typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)) return true;
  diagnostics.push(invalidOptionDiagnostic(option, `${option} must be a commit id.`));
  return false;
}

function validateOptionalCommitExpectedHead(
  input: Readonly<Record<string, unknown>>,
  key: string,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (!(key in input)) return;
  const value = input[key];
  if (!isRecord(value) || Array.isArray(value)) {
    diagnostics.push(invalidOptionDiagnostic(key, `${key} must be an object.`));
    return;
  }
  validateKnownKeys(value, EXPECTED_HEAD_KEYS, diagnostics, key);
  validateCommitId(value.commitId, `${key}.commitId`, diagnostics);
  validateRequiredRevision(value, 'revision', diagnostics, key);
  validateOptionalRevision(value, 'symbolicHeadRevision', diagnostics, key);
}

function validateRequiredRevision(
  input: Readonly<Record<string, unknown>>,
  key: string,
  diagnostics: VersionStoreDiagnostic[],
  path: string,
): void {
  if (toPublicRevision(input[key])) return;
  diagnostics.push(invalidOptionDiagnostic(`${path}.${key}`, `${path}.${key} is invalid.`));
}

function validateOptionalRevision(
  input: Readonly<Record<string, unknown>>,
  key: string,
  diagnostics: VersionStoreDiagnostic[],
  path: string,
): void {
  if (!(key in input) || toPublicRevision(input[key])) return;
  diagnostics.push(invalidOptionDiagnostic(`${path}.${key}`, `${path}.${key} is invalid.`));
}

function toPublicRevision(value: unknown): VersionRecordRevision | null {
  if (!isRecord(value) || Array.isArray(value)) return null;
  return Object.keys(value).every((key) => REVISION_KEYS.has(key)) &&
    (value.kind === 'counter' || value.kind === 'opaque') &&
    typeof value.value === 'string'
    ? (value as VersionRecordRevision)
    : null;
}

function validateRequiredString(
  input: Readonly<Record<string, unknown>>,
  key: string,
  diagnostics: VersionStoreDiagnostic[],
  path = '',
): void {
  if (typeof input[key] === 'string' && String(input[key]).length > 0) return;
  const option = path ? `${path}.${key}` : key;
  diagnostics.push(invalidOptionDiagnostic(option, `${option} must be a non-empty string.`));
}

function validateOptionalString(
  input: Readonly<Record<string, unknown>>,
  key: string,
  diagnostics: VersionStoreDiagnostic[],
  path = '',
): void {
  if (!(key in input) || typeof input[key] === 'string') return;
  const option = path ? `${path}.${key}` : key;
  diagnostics.push(invalidOptionDiagnostic(option, `${option} must be a string.`));
}

function validateOptionalBoolean(
  input: Readonly<Record<string, unknown>>,
  key: string,
  diagnostics: VersionStoreDiagnostic[],
  path = '',
): void {
  if (!(key in input) || typeof input[key] === 'boolean') return;
  const option = path ? `${path}.${key}` : key;
  diagnostics.push(invalidOptionDiagnostic(option, `${option} must be a boolean.`));
}

function validatePositiveInteger(
  value: unknown,
  option: string,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (Number.isInteger(value) && Number(value) >= 1) return;
  diagnostics.push(invalidOptionDiagnostic(option, `${option} must be a positive integer.`));
}

function validateOptionalPositiveInteger(
  input: Readonly<Record<string, unknown>>,
  key: string,
  diagnostics: VersionStoreDiagnostic[],
  path = '',
): void {
  if (!(key in input)) return;
  const option = path ? `${path}.${key}` : key;
  validatePositiveInteger(input[key], option, diagnostics);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
