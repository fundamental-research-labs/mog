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

    await expect(version.listReviews()).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.listReviews',
        diagnostics: [expect.objectContaining({ code: 'VERSION_REVIEW_SERVICE_UNAVAILABLE' })],
      },
    });
    await expect(version.getReview({ reviewId: REVIEW_ID })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.getReview',
        diagnostics: [expect.objectContaining({ code: 'VERSION_REVIEW_SERVICE_UNAVAILABLE' })],
      },
    });
    await expect(
      version.createReview({
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
        target: 'workbook.version.createReview',
        diagnostics: [expect.objectContaining({ code: 'VERSION_REVIEW_SERVICE_UNAVAILABLE' })],
      },
    });
    await expect(
      version.appendReviewDecision({
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
        target: 'workbook.version.appendReviewDecision',
        diagnostics: [expect.objectContaining({ code: 'VERSION_REVIEW_SERVICE_UNAVAILABLE' })],
      },
    });
    await expect(
      version.updateReviewStatus({
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
        target: 'workbook.version.updateReviewStatus',
        diagnostics: [expect.objectContaining({ code: 'VERSION_REVIEW_SERVICE_UNAVAILABLE' })],
      },
    });
    await expect(version.getReviewDiff({ reviewId: REVIEW_ID })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.getReviewDiff',
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

    await expect(version.listReviews()).resolves.toEqual({
      ok: true,
      value: { items: [], limit: 50 },
    });
    await expect(version.getReview({ reviewId: REVIEW_ID })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.getReview',
        diagnostics: [expect.objectContaining({ code: 'VERSION_REVIEW_METHOD_UNAVAILABLE' })],
      },
    });
  });
}
