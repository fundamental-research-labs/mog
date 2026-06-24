import type {
  VersionCreateReviewInput,
  VersionResult,
  VersionStoreDiagnostic,
  WorkbookCommitId,
  WorkbookVersionReviewRecord,
  WorkbookVersionReviewSubject,
} from '@mog-sdk/contracts/api';

import type { VersionReviewPublicOperation } from './version-review-operation';
import { invalidOptionDiagnostic, invalidStateResult } from './version-review-results';
import { REVIEW_SUBJECT_KINDS } from './version-review-validation-constants';
import {
  isRecord,
  validateCommitId,
  validateRequiredString,
} from './version-review-validation-rules';

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

export function validateReviewSubject(
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
