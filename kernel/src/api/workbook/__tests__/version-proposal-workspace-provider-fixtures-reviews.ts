import type {
  VersionCreateReviewInput,
  VersionGetReviewInput,
  WorkbookVersionReviewRecord,
} from '@mog-sdk/contracts/api';

import { DOCUMENT_SCOPE } from './version-proposal-workspace-provider-fixtures-core';

export function missingLinkedReviewService() {
  return {
    async createReview(input: VersionCreateReviewInput) {
      const review: WorkbookVersionReviewRecord = {
        schemaVersion: 1,
        id: `review:${input.clientRequestId}`,
        documentId: DOCUMENT_SCOPE.documentId,
        subject: input.subject,
        status: 'approved',
        baseCommitId: input.baseCommitId,
        headCommitId: input.headCommitId,
        revision: 1,
        createdBy: input.createdBy,
        createdAt: '2026-06-22T00:00:00.000Z',
        updatedAt: '2026-06-22T00:00:00.000Z',
        decisions: [],
        redaction: {
          policy: input.redactionPolicy,
          redactedFields: [],
          diagnostics: [],
        },
        diagnostics: [],
      };
      return { ok: true, value: review } as const;
    },
    async getReview(input: VersionGetReviewInput) {
      return {
        ok: false,
        error: {
          code: 'not_found',
          target: 'workbook.version.review',
          reason: `Review record ${input.reviewId} was not found.`,
        },
      } as const;
    },
  };
}
