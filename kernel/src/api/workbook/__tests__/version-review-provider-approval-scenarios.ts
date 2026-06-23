import { AUTHOR, firstReviewDiffTarget } from './version-review-provider-test-utils';
import {
  createCellA1AndSheetOrderApprovalReview,
  createCellA1ApprovalReview,
} from './version-review-provider-approval-helpers';

export function registerReviewProviderApprovalScenarios(): void {
  it('approves commit-range reviews with diff-backed evidence and idempotent retry', async () => {
    const { graph, review, version } = await createCellA1ApprovalReview('approval-review-1');

    const approved = await version.updateReviewStatus({
      reviewId: review.id,
      expectedRevision: 1,
      clientRequestId: 'approve-status-1',
      status: 'approved',
      actor: AUTHOR,
    });
    expect(approved).toMatchObject({
      ok: true,
      value: {
        revision: 2,
        status: 'approved',
        approval: {
          schemaVersion: 1,
          baseCommitId: graph.rootCommitId,
          headCommitId: graph.childCommitId,
          changeSetDigest: { algorithm: 'sha256', digest: expect.stringMatching(/^[0-9a-f]{64}$/) },
          approvedBy: AUTHOR,
          reviewRevision: 2,
          requiredTargets: [
            {
              targetKey: expect.any(String),
              target: {
                kind: 'semanticChange',
                changeId: 'change-cell-a1',
                entityKind: 'cell',
                entityId: 'sheet-1!A1',
                propertyPath: ['value'],
                derived: false,
              },
            },
          ],
        },
      },
    });
    if (!approved.ok) throw new Error(`expected approval success: ${approved.error.code}`);
    expect(approved.value.approval?.approvedAt).toBe(approved.value.updatedAt);
    await expect(
      version.updateReviewStatus({
        reviewId: review.id,
        expectedRevision: 1,
        clientRequestId: 'approve-status-1',
        status: 'approved',
        actor: AUTHOR,
      }),
    ).resolves.toEqual(approved);
  });

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
