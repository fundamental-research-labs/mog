import { AUTHOR } from './version-review-provider-test-utils';
import { createCellA1ApprovalReview } from './version-review-provider-approval-helpers';

export function registerReviewProviderApprovalStatusScenario(): void {
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
}
