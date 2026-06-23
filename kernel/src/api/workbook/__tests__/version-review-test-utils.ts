import type {
  WorkbookVersionReviewDiffPage,
  WorkbookVersionReviewRecord,
} from '@mog-sdk/contracts/api';

import { WorkbookVersionImpl } from '../version';

export const BASE_COMMIT_ID = `commit:sha256:${'1'.repeat(64)}`;
export const HEAD_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}`;
export const REVIEW_ID = 'review-1';
export const AUTHOR = { kind: 'user', trust: 'trusted', displayName: 'Reviewer' } as const;
export const REDACTION_POLICY = {
  mode: 'default',
  redactSecrets: true,
  redactExternalLinks: true,
  redactAgentTrace: true,
} as const;

export function createReviewRecord(
  overrides: Partial<WorkbookVersionReviewRecord> = {},
): WorkbookVersionReviewRecord {
  return {
    schemaVersion: 1,
    id: REVIEW_ID,
    documentId: 'document-1',
    subject: {
      kind: 'commitRange',
      baseCommitId: BASE_COMMIT_ID,
      headCommitId: HEAD_COMMIT_ID,
    },
    status: 'open',
    baseCommitId: BASE_COMMIT_ID,
    headCommitId: HEAD_COMMIT_ID,
    revision: 1,
    createdBy: AUTHOR,
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
    decisions: [],
    redaction: {
      policy: REDACTION_POLICY,
      redactedFields: [],
      diagnostics: [],
    },
    diagnostics: [],
    ...overrides,
  };
}

export function createReviewDiffPage(): WorkbookVersionReviewDiffPage {
  return {
    schemaVersion: 1,
    source: 'semantic-diff',
    reviewId: REVIEW_ID,
    baseCommitId: BASE_COMMIT_ID,
    headCommitId: HEAD_COMMIT_ID,
    changeSetDigest: {
      algorithm: 'sha256',
      digest: 'a'.repeat(64),
    },
    changes: [],
    summary: {
      authoredChanges: 0,
      derivedChanges: 0,
      redactedChanges: 0,
    },
    limit: 50,
    diagnostics: [],
  };
}

export function createVersion(reviewService: Record<string, unknown> | null = null) {
  return new WorkbookVersionImpl({
    versioning: reviewService ? { reviewService } : {},
  } as any);
}
