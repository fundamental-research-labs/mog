import type { WorkbookVersionReviewStatus } from '@mog-sdk/contracts/api';

export const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;

export const LIST_REVIEWS_KEYS: ReadonlySet<string> = new Set([
  'subjectKind',
  'proposalId',
  'commitId',
  'mergePreviewId',
  'conflictId',
  'status',
  'cursor',
  'limit',
]);

export const GET_REVIEW_KEYS: ReadonlySet<string> = new Set(['reviewId']);

export const CREATE_REVIEW_KEYS: ReadonlySet<string> = new Set([
  'clientRequestId',
  'subject',
  'title',
  'createdBy',
  'baseCommitId',
  'headCommitId',
  'redactionPolicy',
]);

export const APPEND_REVIEW_DECISION_KEYS: ReadonlySet<string> = new Set([
  'reviewId',
  'expectedRevision',
  'clientRequestId',
  'decision',
]);

export const UPDATE_REVIEW_STATUS_KEYS: ReadonlySet<string> = new Set([
  'reviewId',
  'expectedRevision',
  'clientRequestId',
  'status',
  'actor',
  'reason',
]);

export const GET_REVIEW_DIFF_KEYS: ReadonlySet<string> = new Set([
  'reviewId',
  'baseCommitId',
  'headCommitId',
  'cursor',
  'limit',
  'includeDerivedImpact',
]);

export const REVIEW_SUBJECT_KINDS: ReadonlySet<string> = new Set([
  'commit',
  'commitRange',
  'proposal',
  'merge',
  'conflict',
]);

export const REVIEW_STATUSES: ReadonlySet<WorkbookVersionReviewStatus> = new Set([
  'open',
  'approved',
  'changes_requested',
  'rejected',
  'applied',
  'superseded',
  'stale',
]);

export const USER_MUTABLE_REVIEW_STATUSES: ReadonlySet<WorkbookVersionReviewStatus> = new Set([
  'open',
  'approved',
  'changes_requested',
  'rejected',
]);
