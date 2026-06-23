import { jest } from '@jest/globals';

import {
  AUTHOR,
  BASE_COMMIT_ID,
  HEAD_COMMIT_ID,
  REDACTION_POLICY,
  REVIEW_ID,
  createVersion,
} from './version-review-test-utils';

export function registerVersionReviewValidationScenarios(): void {
  it('validates review identity contracts before calling the service', async () => {
    const createReview = jest.fn();
    const updateReviewStatus = jest.fn();
    const version = createVersion({ createReview, updateReviewStatus });

    await expect(
      version.createReview({
        clientRequestId: 'create-1',
        subject: {
          kind: 'commitRange',
          baseCommitId: BASE_COMMIT_ID,
          headCommitId: HEAD_COMMIT_ID,
        },
        baseCommitId: HEAD_COMMIT_ID,
        createdBy: AUTHOR,
        redactionPolicy: REDACTION_POLICY,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'invalid_state',
        state: 'review_subject_base_mismatch',
      },
    });
    expect(createReview).not.toHaveBeenCalled();

    await expect(version.getReviewDiff({})).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'invalid_state',
        state: 'missing_review_diff_target',
      },
    });
    await expect(
      version.updateReviewStatus({
        reviewId: REVIEW_ID,
        expectedRevision: 1,
        clientRequestId: 'status-1',
        actor: AUTHOR,
      } as any),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.updateReviewStatus',
        diagnostics: [expect.objectContaining({ code: 'VERSION_INVALID_OPTIONS' })],
      },
    });
    expect(updateReviewStatus).not.toHaveBeenCalled();

    await expect(
      version.updateReviewStatus({
        reviewId: REVIEW_ID,
        expectedRevision: 1,
        clientRequestId: 'status-applied',
        status: 'applied',
        actor: AUTHOR,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.updateReviewStatus',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({
              payload: expect.objectContaining({
                option: 'status',
              }),
            }),
          }),
        ],
      },
    });
    expect(updateReviewStatus).not.toHaveBeenCalled();
  });
}
