import { AUTHOR, firstReviewDiffTarget } from './version-review-provider-test-utils';
import { createCellA1ApprovalReview } from './version-review-provider-approval-helpers';

export function registerReviewProviderRequestChangeScenario(): void {
  it('requires same-target trusted approve decisions to resolve request changes before approval', async () => {
    const { review, version } = await createCellA1ApprovalReview('approval-request-change-1');
    const target = await firstReviewDiffTarget(version, review.id);

    const requested = await version.appendReviewDecision({
      reviewId: review.id,
      expectedRevision: 1,
      clientRequestId: 'request-change-1',
      decision: { target, decision: 'request_change', reviewer: AUTHOR },
    });
    if (!requested.ok) throw new Error(`expected request-change success: ${requested.error.code}`);
    const requestDecisionId = requested.value.decisions[0].id;

    await expect(
      version.updateReviewStatus({
        reviewId: review.id,
        expectedRevision: 2,
        clientRequestId: 'approve-with-unresolved-request',
        status: 'approved',
        actor: AUTHOR,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'unresolved_request_change' },
    });

    const unresolvedApprove = await version.appendReviewDecision({
      reviewId: review.id,
      expectedRevision: 2,
      clientRequestId: 'approve-decision-missing-supersede',
      decision: { target, decision: 'approve', reviewer: AUTHOR },
    });
    expect(unresolvedApprove).toMatchObject({ ok: true, value: { revision: 3 } });
    await expect(
      version.updateReviewStatus({
        reviewId: review.id,
        expectedRevision: 3,
        clientRequestId: 'approve-with-missing-supersede',
        status: 'approved',
        actor: AUTHOR,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'unresolved_request_change' },
    });

    const resolved = await version.appendReviewDecision({
      reviewId: review.id,
      expectedRevision: 3,
      clientRequestId: 'approve-decision-with-supersede',
      decision: {
        target,
        decision: 'approve',
        reviewer: AUTHOR,
        supersedesDecisionId: requestDecisionId,
      },
    });
    expect(resolved).toMatchObject({ ok: true, value: { revision: 4 } });
    await expect(
      version.updateReviewStatus({
        reviewId: review.id,
        expectedRevision: 4,
        clientRequestId: 'approve-after-request-resolved',
        status: 'approved',
        actor: AUTHOR,
      }),
    ).resolves.toMatchObject({ ok: true, value: { revision: 5, status: 'approved' } });
  });
}
