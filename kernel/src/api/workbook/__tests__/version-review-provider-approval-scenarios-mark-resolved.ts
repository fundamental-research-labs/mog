import { AUTHOR } from './version-review-provider-test-utils';
import { createCellA1AndSheetOrderApprovalReview } from './version-review-provider-approval-helpers';

export function registerReviewProviderMarkResolvedScenario(): void {
  it('requires mark_resolved decisions to supersede a same-target request change', async () => {
    const { review, version } = await createCellA1AndSheetOrderApprovalReview(
      'approval-mark-resolved-1',
    );
    const diff = await version.getReviewDiff({ reviewId: review.id, limit: 2 });
    if (!diff.ok) throw new Error(`expected review diff success: ${diff.error.code}`);
    const target = diff.value.changes[0].target;
    const otherTarget = diff.value.changes[1].target;

    const requested = await version.appendReviewDecision({
      reviewId: review.id,
      expectedRevision: 1,
      clientRequestId: 'request-change-for-mark-resolved',
      decision: { target, decision: 'request_change', reviewer: AUTHOR },
    });
    if (!requested.ok) throw new Error(`expected request-change success: ${requested.error.code}`);
    const requestDecisionId = requested.value.decisions[0].id;

    const wrongTargetResolution = await version.appendReviewDecision({
      reviewId: review.id,
      expectedRevision: 2,
      clientRequestId: 'mark-resolved-wrong-target',
      decision: {
        target: otherTarget,
        decision: 'mark_resolved',
        reviewer: AUTHOR,
        supersedesDecisionId: requestDecisionId,
      },
    });
    expect(wrongTargetResolution).toMatchObject({ ok: true, value: { revision: 3 } });
    await expect(
      version.updateReviewStatus({
        reviewId: review.id,
        expectedRevision: 3,
        clientRequestId: 'approve-after-wrong-target-resolution',
        status: 'approved',
        actor: AUTHOR,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'unresolved_request_change' },
    });

    const missingSupersede = await version.appendReviewDecision({
      reviewId: review.id,
      expectedRevision: 3,
      clientRequestId: 'mark-resolved-missing-supersede',
      decision: { target, decision: 'mark_resolved', reviewer: AUTHOR },
    });
    expect(missingSupersede).toMatchObject({ ok: true, value: { revision: 4 } });
    await expect(
      version.updateReviewStatus({
        reviewId: review.id,
        expectedRevision: 4,
        clientRequestId: 'approve-after-missing-supersede',
        status: 'approved',
        actor: AUTHOR,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_state', state: 'unresolved_request_change' },
    });

    const resolved = await version.appendReviewDecision({
      reviewId: review.id,
      expectedRevision: 4,
      clientRequestId: 'mark-resolved-with-supersede',
      decision: {
        target,
        decision: 'mark_resolved',
        reviewer: AUTHOR,
        supersedesDecisionId: requestDecisionId,
      },
    });
    expect(resolved).toMatchObject({ ok: true, value: { revision: 5 } });
    await expect(
      version.updateReviewStatus({
        reviewId: review.id,
        expectedRevision: 5,
        clientRequestId: 'approve-after-mark-resolved',
        status: 'approved',
        actor: AUTHOR,
      }),
    ).resolves.toMatchObject({ ok: true, value: { revision: 6, status: 'approved' } });
  });
}
