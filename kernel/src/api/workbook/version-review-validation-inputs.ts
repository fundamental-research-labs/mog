import type {
  VersionAppendReviewDecisionInput,
  VersionCreateReviewInput,
  VersionGetReviewDiffInput,
  VersionGetReviewInput,
  VersionListReviewsInput,
  VersionStoreDiagnostic,
  VersionUpdateReviewStatusInput,
} from '@mog-sdk/contracts/api';

import type { VersionReviewPublicOperation } from './version-review-operation';
import { invalidOptionDiagnostic } from './version-review-results';
import {
  APPEND_REVIEW_DECISION_KEYS,
  CREATE_REVIEW_KEYS,
  GET_REVIEW_DIFF_KEYS,
  GET_REVIEW_KEYS,
  LIST_REVIEWS_KEYS,
  REVIEW_SUBJECT_KINDS,
  UPDATE_REVIEW_STATUS_KEYS,
} from './version-review-validation-constants';
import {
  isPlainInput,
  validateKnownKeys,
  validateOptionalCommitId,
  validateOptionalLimit,
  validateOptionalReviewStatus,
  validateOptionalString,
  validateRequiredRecord,
  validateRequiredRevision,
  validateRequiredString,
  validateRequiredUserMutableReviewStatus,
} from './version-review-validation-rules';
import { validateReviewSubject } from './version-review-validation-subject';
import type { ValidationResult } from './version-review-validation-types';

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
