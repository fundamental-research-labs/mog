import type {
  PageCursor,
  Paged,
  VersionListReviewsInput,
  VersionResult,
  WorkbookCommitId,
  WorkbookVersionReviewRecord,
  WorkbookVersionReviewRecordSummary,
  WorkbookVersionReviewStatus,
  WorkbookVersionReviewSubject,
} from '@mog-sdk/contracts/api';

import { invalidState } from './review-service-record-store-helpers-results';

export const DEFAULT_REVIEW_LIST_LIMIT = 50;

const REVIEW_LIST_CURSOR_PREFIX = 'review-list:';
const ACTIVE_REVIEW_STATUSES = new Set<WorkbookVersionReviewStatus>([
  'open',
  'approved',
  'changes_requested',
]);

export function reviewMatchesListInput(
  record: WorkbookVersionReviewRecord,
  input: VersionListReviewsInput,
): boolean {
  if (input.subjectKind && record.subject.kind !== input.subjectKind) return false;
  if (input.status && record.status !== input.status) return false;
  if (input.proposalId && record.proposalId !== input.proposalId) return false;
  if (input.commitId && !reviewIncludesCommit(record, input.commitId)) return false;
  if (input.mergePreviewId && !reviewIncludesMergePreview(record.subject, input.mergePreviewId)) {
    return false;
  }
  if (input.conflictId && !reviewIncludesConflict(record.subject, input.conflictId)) return false;
  return true;
}

export function isActiveReview(record: WorkbookVersionReviewRecord): boolean {
  return ACTIVE_REVIEW_STATUSES.has(record.status);
}

function reviewIncludesCommit(
  record: WorkbookVersionReviewRecord,
  commitId: WorkbookCommitId,
): boolean {
  if (record.baseCommitId === commitId || record.headCommitId === commitId) return true;
  return record.subject.kind === 'commit' && record.subject.commitId === commitId;
}

function reviewIncludesMergePreview(
  subject: WorkbookVersionReviewSubject,
  mergePreviewId: string,
): boolean {
  return (
    (subject.kind === 'merge' || subject.kind === 'conflict') &&
    subject.mergePreviewId === mergePreviewId
  );
}

function reviewIncludesConflict(
  subject: WorkbookVersionReviewSubject,
  conflictId: string,
): boolean {
  return subject.kind === 'conflict' && subject.conflictId === conflictId;
}

export function compareReviewsForList(
  left: WorkbookVersionReviewRecord,
  right: WorkbookVersionReviewRecord,
): number {
  if (left.updatedAt > right.updatedAt) return -1;
  if (left.updatedAt < right.updatedAt) return 1;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

export function parseReviewListCursor(cursor: PageCursor | undefined):
  | { readonly ok: true; readonly offset: number }
  | {
      readonly ok: false;
      readonly result: VersionResult<Paged<WorkbookVersionReviewRecordSummary>>;
    } {
  if (cursor === undefined) return { ok: true, offset: 0 };
  if (!cursor.startsWith(REVIEW_LIST_CURSOR_PREFIX)) {
    return {
      ok: false,
      result: invalidState(
        'stale_review_cursor',
        ['valid_cursor'],
        'Review list cursor is not valid for this store.',
      ),
    };
  }
  const offset = Number(cursor.slice(REVIEW_LIST_CURSOR_PREFIX.length));
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return {
      ok: false,
      result: invalidState(
        'stale_review_cursor',
        ['valid_cursor'],
        'Review list cursor has an invalid offset.',
      ),
    };
  }
  return { ok: true, offset };
}

export function reviewListCursor(offset: number): PageCursor {
  return `${REVIEW_LIST_CURSOR_PREFIX}${offset}` as PageCursor;
}
