import type {
  VersionAppendReviewDecisionInput,
  VersionCreateReviewInput,
  VersionGetReviewDiffInput,
  VersionGetReviewInput,
  VersionListReviewsInput,
  VersionResult,
  VersionStoreDiagnostic,
  VersionUpdateReviewStatusInput,
  WorkbookCommitId,
  WorkbookVersionReviewDiffPage,
  WorkbookVersionReviewRecord,
  WorkbookVersionReviewStatus,
  WorkbookVersionReviewSubject,
} from '@mog-sdk/contracts/api';

import type { VersionReviewPublicOperation } from './version-review-operation';
import { invalidOptionDiagnostic, invalidStateResult } from './version-review-results';

const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
const LIST_REVIEWS_KEYS = new Set([
  'subjectKind',
  'proposalId',
  'commitId',
  'mergePreviewId',
  'conflictId',
  'status',
  'cursor',
  'limit',
]);
const GET_REVIEW_KEYS = new Set(['reviewId']);
const CREATE_REVIEW_KEYS = new Set([
  'clientRequestId',
  'subject',
  'title',
  'createdBy',
  'baseCommitId',
  'headCommitId',
  'redactionPolicy',
]);
const APPEND_REVIEW_DECISION_KEYS = new Set([
  'reviewId',
  'expectedRevision',
  'clientRequestId',
  'decision',
]);
const UPDATE_REVIEW_STATUS_KEYS = new Set([
  'reviewId',
  'expectedRevision',
  'clientRequestId',
  'status',
  'actor',
  'reason',
]);
const GET_REVIEW_DIFF_KEYS = new Set([
  'reviewId',
  'baseCommitId',
  'headCommitId',
  'cursor',
  'limit',
  'includeDerivedImpact',
]);
const REVIEW_SUBJECT_KINDS = new Set(['commit', 'commitRange', 'proposal', 'merge', 'conflict']);
const REVIEW_STATUSES = new Set<WorkbookVersionReviewStatus>([
  'open',
  'approved',
  'changes_requested',
  'rejected',
  'applied',
  'superseded',
  'stale',
]);
const USER_MUTABLE_REVIEW_STATUSES = new Set<WorkbookVersionReviewStatus>([
  'open',
  'approved',
  'changes_requested',
  'rejected',
]);

type ValidationResult<T> =
  | { readonly ok: true; readonly input: T }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export function normalizeListReviewsInput(
  input: VersionListReviewsInput,
): ValidationResult<VersionListReviewsInput> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, 'listReviews', diagnostics)) return { ok: false, diagnostics };
  validateKnownKeys(input, LIST_REVIEWS_KEYS, 'listReviews', diagnostics);
  if ('subjectKind' in input && !REVIEW_SUBJECT_KINDS.has(String(input.subjectKind))) {
    diagnostics.push(
      invalidOptionDiagnostic('listReviews', 'subjectKind', 'unknown review subject kind.'),
    );
  }
  validateOptionalString(input, 'proposalId', 'listReviews', diagnostics);
  validateOptionalCommitId(input, 'commitId', 'listReviews', diagnostics);
  validateOptionalString(input, 'mergePreviewId', 'listReviews', diagnostics);
  validateOptionalString(input, 'conflictId', 'listReviews', diagnostics);
  validateOptionalReviewStatus(input, 'status', 'listReviews', diagnostics);
  validateOptionalString(input, 'cursor', 'listReviews', diagnostics);
  validateOptionalLimit(input, 'limit', 'listReviews', diagnostics);
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}

export function normalizeGetReviewInput(
  input: VersionGetReviewInput,
): ValidationResult<VersionGetReviewInput> {
  return normalizeReviewIdInput(input, GET_REVIEW_KEYS, 'getReview');
}

export function normalizeCreateReviewInput(
  input: VersionCreateReviewInput,
): ValidationResult<VersionCreateReviewInput> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, 'createReview', diagnostics)) return { ok: false, diagnostics };
  validateKnownKeys(input, CREATE_REVIEW_KEYS, 'createReview', diagnostics);
  validateRequiredString(input, 'clientRequestId', 'createReview', diagnostics);
  validateOptionalString(input, 'title', 'createReview', diagnostics);
  validateRequiredRecord(input, 'createdBy', 'createReview', diagnostics);
  validateRequiredRecord(input, 'redactionPolicy', 'createReview', diagnostics);
  validateOptionalCommitId(input, 'baseCommitId', 'createReview', diagnostics);
  validateOptionalCommitId(input, 'headCommitId', 'createReview', diagnostics);
  validateReviewSubject(input.subject, 'createReview', diagnostics);
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}

export function normalizeAppendReviewDecisionInput(
  input: VersionAppendReviewDecisionInput,
): ValidationResult<VersionAppendReviewDecisionInput> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, 'appendReviewDecision', diagnostics)) return { ok: false, diagnostics };
  validateKnownKeys(input, APPEND_REVIEW_DECISION_KEYS, 'appendReviewDecision', diagnostics);
  validateRequiredString(input, 'reviewId', 'appendReviewDecision', diagnostics);
  validateRequiredRevision(input, 'expectedRevision', 'appendReviewDecision', diagnostics);
  validateRequiredString(input, 'clientRequestId', 'appendReviewDecision', diagnostics);
  validateRequiredRecord(input, 'decision', 'appendReviewDecision', diagnostics);
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}

export function normalizeUpdateReviewStatusInput(
  input: VersionUpdateReviewStatusInput,
): ValidationResult<VersionUpdateReviewStatusInput> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, 'updateReviewStatus', diagnostics)) return { ok: false, diagnostics };
  validateKnownKeys(input, UPDATE_REVIEW_STATUS_KEYS, 'updateReviewStatus', diagnostics);
  validateRequiredString(input, 'reviewId', 'updateReviewStatus', diagnostics);
  validateRequiredRevision(input, 'expectedRevision', 'updateReviewStatus', diagnostics);
  validateRequiredString(input, 'clientRequestId', 'updateReviewStatus', diagnostics);
  validateRequiredUserMutableReviewStatus(input, 'status', 'updateReviewStatus', diagnostics);
  validateRequiredRecord(input, 'actor', 'updateReviewStatus', diagnostics);
  validateOptionalString(input, 'reason', 'updateReviewStatus', diagnostics);
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}

export function normalizeGetReviewDiffInput(
  input: VersionGetReviewDiffInput,
): ValidationResult<VersionGetReviewDiffInput> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, 'getReviewDiff', diagnostics)) return { ok: false, diagnostics };
  validateKnownKeys(input, GET_REVIEW_DIFF_KEYS, 'getReviewDiff', diagnostics);
  validateOptionalString(input, 'reviewId', 'getReviewDiff', diagnostics);
  validateOptionalCommitId(input, 'baseCommitId', 'getReviewDiff', diagnostics);
  validateOptionalCommitId(input, 'headCommitId', 'getReviewDiff', diagnostics);
  validateOptionalString(input, 'cursor', 'getReviewDiff', diagnostics);
  validateOptionalLimit(input, 'limit', 'getReviewDiff', diagnostics);
  if ('includeDerivedImpact' in input && typeof input.includeDerivedImpact !== 'boolean') {
    diagnostics.push(
      invalidOptionDiagnostic(
        'getReviewDiff',
        'includeDerivedImpact',
        'includeDerivedImpact must be a boolean.',
      ),
    );
  }
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}

export function validateExplicitSubjectHeads(
  input: VersionCreateReviewInput,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly result: VersionResult<WorkbookVersionReviewRecord> } {
  const subjectBase = subjectBaseCommitId(input.subject);
  const subjectHead = subjectHeadCommitId(input.subject);
  if (input.baseCommitId && subjectBase && input.baseCommitId !== subjectBase) {
    return {
      ok: false,
      result: invalidStateResult(
        'createReview',
        'review_subject_base_mismatch',
        'baseCommitId must match the base commit implied by the review subject.',
      ),
    };
  }
  if (input.headCommitId && subjectHead && input.headCommitId !== subjectHead) {
    return {
      ok: false,
      result: invalidStateResult(
        'createReview',
        'review_subject_head_mismatch',
        'headCommitId must match the head commit implied by the review subject.',
      ),
    };
  }
  return { ok: true };
}

export function validateReviewDiffTarget(
  input: VersionGetReviewDiffInput,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly result: VersionResult<WorkbookVersionReviewDiffPage> } {
  if (input.reviewId || (input.baseCommitId && input.headCommitId)) return { ok: true };
  return {
    ok: false,
    result: invalidStateResult(
      'getReviewDiff',
      'missing_review_diff_target',
      'getReviewDiff requires reviewId or both baseCommitId and headCommitId.',
    ),
  };
}

function normalizeReviewIdInput<T extends VersionGetReviewInput>(
  input: T,
  allowedKeys: ReadonlySet<string>,
  operation: VersionReviewPublicOperation,
): ValidationResult<T> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, operation, diagnostics)) return { ok: false, diagnostics };
  validateKnownKeys(input, allowedKeys, operation, diagnostics);
  validateRequiredString(input, 'reviewId', operation, diagnostics);
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}

function validateReviewSubject(
  value: unknown,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): value is WorkbookVersionReviewSubject {
  if (!isRecord(value) || Array.isArray(value)) {
    diagnostics.push(invalidOptionDiagnostic(operation, 'subject', 'subject must be an object.'));
    return false;
  }
  if (!REVIEW_SUBJECT_KINDS.has(String(value.kind))) {
    diagnostics.push(
      invalidOptionDiagnostic(operation, 'subject.kind', 'unknown review subject kind.'),
    );
    return false;
  }

  switch (value.kind) {
    case 'commit':
      return validateCommitId(value.commitId, operation, 'subject.commitId', diagnostics);
    case 'commitRange':
      return (
        validateCommitId(value.baseCommitId, operation, 'subject.baseCommitId', diagnostics) &&
        validateCommitId(value.headCommitId, operation, 'subject.headCommitId', diagnostics)
      );
    case 'proposal':
      validateRequiredString(value, 'proposalId', operation, diagnostics);
      return (
        validateCommitId(value.baseCommitId, operation, 'subject.baseCommitId', diagnostics) &&
        validateCommitId(value.headCommitId, operation, 'subject.headCommitId', diagnostics)
      );
    case 'merge':
      validateRequiredString(value, 'mergePreviewId', operation, diagnostics);
      return true;
    case 'conflict':
      validateRequiredString(value, 'mergePreviewId', operation, diagnostics);
      validateRequiredString(value, 'conflictId', operation, diagnostics);
      return true;
    default:
      return false;
  }
}

function subjectBaseCommitId(subject: WorkbookVersionReviewSubject): WorkbookCommitId | undefined {
  return 'baseCommitId' in subject ? subject.baseCommitId : undefined;
}

function subjectHeadCommitId(subject: WorkbookVersionReviewSubject): WorkbookCommitId | undefined {
  if ('headCommitId' in subject) return subject.headCommitId;
  if (subject.kind === 'commit') return subject.commitId;
  return undefined;
}

function isPlainInput(
  input: unknown,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): input is Readonly<Record<string, unknown>> {
  if (isRecord(input) && !Array.isArray(input)) return true;
  diagnostics.push(invalidOptionDiagnostic(operation, 'input', 'review input must be an object.'));
  return false;
}

function validateKnownKeys(
  input: Readonly<Record<string, unknown>>,
  allowedKeys: ReadonlySet<string>,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  for (const key of Object.keys(input)) {
    if (allowedKeys.has(key)) continue;
    diagnostics.push(invalidOptionDiagnostic(operation, key, `Unknown review option "${key}".`));
  }
}

function validateRequiredString(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  const value = input[key];
  if (typeof value === 'string' && value.length > 0) return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be a non-empty string.`));
}

function validateOptionalString(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (!(key in input) || typeof input[key] === 'string') return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be a string.`));
}

function validateRequiredRecord(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (isRecord(input[key]) && !Array.isArray(input[key])) return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be an object.`));
}

function validateOptionalReviewStatus(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (!(key in input) || REVIEW_STATUSES.has(input[key] as WorkbookVersionReviewStatus)) return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be a review status.`));
}

function validateRequiredReviewStatus(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (REVIEW_STATUSES.has(input[key] as WorkbookVersionReviewStatus)) return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be a review status.`));
}

function validateRequiredUserMutableReviewStatus(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (USER_MUTABLE_REVIEW_STATUSES.has(input[key] as WorkbookVersionReviewStatus)) return;
  diagnostics.push(
    invalidOptionDiagnostic(operation, key, `${key} must be a user-mutable review status.`),
  );
}

function validateOptionalCommitId(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (!(key in input)) return;
  validateCommitId(input[key], operation, key, diagnostics);
}

function validateCommitId(
  value: unknown,
  operation: VersionReviewPublicOperation,
  key: string,
  diagnostics: VersionStoreDiagnostic[],
): value is WorkbookCommitId {
  if (typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)) return true;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be a commit id.`));
  return false;
}

function validateRequiredRevision(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (Number.isInteger(input[key]) && Number(input[key]) >= 1) return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be a positive integer.`));
}

function validateOptionalLimit(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (!(key in input)) return;
  const value = input[key];
  if (Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 100) return;
  diagnostics.push(
    invalidOptionDiagnostic(operation, key, `${key} must be an integer from 1 to 100.`),
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
