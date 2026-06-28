import { jest } from '@jest/globals';

import {
  AUTHOR,
  BASE_COMMIT_ID,
  HEAD_COMMIT_ID,
  REDACTION_POLICY,
  REVIEW_ID,
  createVersion,
} from './version-review-test-utils';

export function registerVersionReviewFacadeMissingServiceScenario(): void {
  it('fails closed for review methods when no review service is attached', async () => {
    const version = createVersion();

    await expect(version.reviews.advanced.listReviews()).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.reviews.advanced.listReviews',
        diagnostics: [expect.objectContaining({ code: 'VERSION_REVIEW_SERVICE_UNAVAILABLE' })],
      },
    });
    await expect(version.reviews.advanced.getReview({ reviewId: REVIEW_ID })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.reviews.advanced.getReview',
        diagnostics: [expect.objectContaining({ code: 'VERSION_REVIEW_SERVICE_UNAVAILABLE' })],
      },
    });
    await expect(
      version.reviews.advanced.createReview({
        clientRequestId: 'create-1',
        subject: {
          kind: 'commitRange',
          baseCommitId: BASE_COMMIT_ID,
          headCommitId: HEAD_COMMIT_ID,
        },
        createdBy: AUTHOR,
        redactionPolicy: REDACTION_POLICY,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.reviews.advanced.createReview',
        diagnostics: [expect.objectContaining({ code: 'VERSION_REVIEW_SERVICE_UNAVAILABLE' })],
      },
    });
    await expect(
      version.reviews.advanced.appendReviewDecision({
        reviewId: REVIEW_ID,
        expectedRevision: 1,
        clientRequestId: 'decision-1',
        decision: {
          target: { kind: 'proposal', proposalId: 'proposal-1' },
          decision: 'comment',
          reviewer: AUTHOR,
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.reviews.advanced.appendReviewDecision',
        diagnostics: [expect.objectContaining({ code: 'VERSION_REVIEW_SERVICE_UNAVAILABLE' })],
      },
    });
    await expect(
      version.reviews.advanced.updateReviewStatus({
        reviewId: REVIEW_ID,
        expectedRevision: 1,
        clientRequestId: 'status-1',
        status: 'approved',
        actor: AUTHOR,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.reviews.advanced.updateReviewStatus',
        diagnostics: [expect.objectContaining({ code: 'VERSION_REVIEW_SERVICE_UNAVAILABLE' })],
      },
    });
    await expect(version.reviews.advanced.getReviewDiff({ reviewId: REVIEW_ID })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.reviews.advanced.getReviewDiff',
        diagnostics: [expect.objectContaining({ code: 'VERSION_REVIEW_SERVICE_UNAVAILABLE' })],
      },
    });
  });
}

export function registerVersionReviewFacadePartialServiceScenario(): void {
  it('fails closed when a partial review service is missing a requested method', async () => {
    const version = createVersion({
      listReviews: jest.fn(async () => ({ ok: true, value: { items: [], limit: 50 } })),
    });

    await expect(version.reviews.advanced.listReviews()).resolves.toEqual({
      ok: true,
      value: { items: [], limit: 50 },
    });
    await expect(version.reviews.advanced.getReview({ reviewId: REVIEW_ID })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.reviews.advanced.getReview',
        diagnostics: [expect.objectContaining({ code: 'VERSION_REVIEW_METHOD_UNAVAILABLE' })],
      },
    });
  });
}
