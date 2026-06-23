import { jest } from '@jest/globals';

import {
  AUTHOR,
  BASE_COMMIT_ID,
  HEAD_COMMIT_ID,
  REDACTION_POLICY,
  REVIEW_ID,
  createReviewDiffPage,
  createReviewRecord,
  createVersion,
} from './version-review-test-utils';

export function registerVersionReviewFacadeDelegationScenario(): void {
  it('delegates successful review methods to the attached service', async () => {
    const review = createReviewRecord();
    const diffPage = createReviewDiffPage();
    const reviewService = {
      listReviews: jest.fn(async () => ({
        ok: true,
        value: { items: [review], limit: 25 },
      })),
      getReview: jest.fn(async () => ({ ok: true, value: review })),
      createReview: jest.fn(async () => ({ ok: true, value: review })),
      appendReviewDecision: jest.fn(async () => ({ ok: true, value: review })),
      updateReviewStatus: jest.fn(async () => ({ ok: true, value: review })),
      getReviewDiff: jest.fn(async () => ({ ok: true, value: diffPage })),
    };
    const version = createVersion(reviewService);

    await expect(version.listReviews({ limit: 25 })).resolves.toEqual({
      ok: true,
      value: { items: [review], limit: 25 },
    });
    await expect(version.getReview({ reviewId: REVIEW_ID })).resolves.toEqual({
      ok: true,
      value: review,
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
    ).resolves.toEqual({ ok: true, value: review });
    await expect(
      version.appendReviewDecision({
        reviewId: REVIEW_ID,
        expectedRevision: 1,
        clientRequestId: 'decision-1',
        decision: {
          target: { kind: 'proposal', proposalId: 'proposal-1' },
          decision: 'approve',
          reviewer: AUTHOR,
        },
      }),
    ).resolves.toEqual({ ok: true, value: review });
    await expect(
      version.updateReviewStatus({
        reviewId: REVIEW_ID,
        expectedRevision: 1,
        clientRequestId: 'status-1',
        status: 'approved',
        actor: AUTHOR,
      }),
    ).resolves.toEqual({ ok: true, value: review });
    await expect(version.getReviewDiff({ reviewId: REVIEW_ID })).resolves.toEqual({
      ok: true,
      value: diffPage,
    });

    expect(reviewService.listReviews).toHaveBeenCalledWith({ limit: 25 });
    expect(reviewService.getReview).toHaveBeenCalledWith({ reviewId: REVIEW_ID });
    expect(reviewService.getReviewDiff).toHaveBeenCalledWith({ reviewId: REVIEW_ID });
  });
}
