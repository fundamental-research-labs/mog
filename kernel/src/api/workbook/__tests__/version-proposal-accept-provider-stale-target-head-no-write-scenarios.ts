import { expect, it } from '@jest/globals';

import {
  ACTOR,
  commitRef,
  createReadyReviewedProposal,
  graphCommittingWorkspaceService,
  graphWithRoot,
  noWriteStaleProposalUpdateDiagnostic,
  providerWithFirstStaleProposalUpdateFailure,
  versionForProvider,
} from './version-proposal-accept-provider-test-utils';

export function registerTargetHeadNoWriteScenarios(): void {
  it('retries stale no-write accepts against current review state without appending diagnostics', async () => {
    const graph = await graphWithRoot();
    const acceptClientRequestId = 'proposal-accept-target-stale-no-write-review-retry';
    const provider = providerWithFirstStaleProposalUpdateFailure(graph.provider, {
      clientRequestId: acceptClientRequestId,
      diagnostic: noWriteStaleProposalUpdateDiagnostic(acceptClientRequestId),
    });
    const version = versionForProvider(provider, graphCommittingWorkspaceService(graph.provider));
    const ready = await createReadyReviewedProposal(version, graph, 'target-stale-no-write-retry');
    const movedMainCommitId = await commitRef(
      graph.provider,
      'refs/heads/main',
      graph.rootCommitId,
    );
    const acceptInput = {
      clientRequestId: acceptClientRequestId,
      proposalId: ready.proposalId,
      expectedRevision: 5,
      expectedTargetHeadId: graph.rootCommitId,
      actor: ACTOR,
      resolutionPolicy: 'fastForwardOnly',
    } as const;

    const noWriteAttempt = await version.acceptProposal(acceptInput);

    expect(noWriteAttempt).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.acceptProposal',
        diagnostics: [
          expect.objectContaining({
            code: 'proposal_accept_stale_update_no_write',
            data: expect.objectContaining({
              operation: 'acceptProposal',
              acceptClientRequestId,
              mutationGuarantee: 'no-write-attempted',
            }),
          }),
        ],
      },
    });
    await expect(version.getProposal({ proposalId: ready.proposalId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'ready_for_review', revision: 5, diagnostics: [] },
    });

    const approvedReview = await version.getReview({ reviewId: ready.reviewId });
    if (!approvedReview.ok) {
      throw new Error(`expected approved review before retry: ${approvedReview.error.code}`);
    }
    const rejectedReview = await version.updateReviewStatus({
      reviewId: ready.reviewId,
      expectedRevision: approvedReview.value.revision,
      clientRequestId: 'proposal-review-reject-after-stale-no-write',
      status: 'rejected',
      actor: ACTOR,
      reason: 'Reviewer withdrew approval before retry.',
    });
    expect(rejectedReview).toMatchObject({ ok: true, value: { status: 'rejected' } });

    const retry = await version.acceptProposal(acceptInput);

    expect(retry).toMatchObject({
      ok: false,
      error: {
        code: 'invalid_state',
        state: 'proposal_review_not_approved',
        allowed: ['approved'],
      },
    });
    await expect(version.getProposal({ proposalId: ready.proposalId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'ready_for_review', revision: 5, diagnostics: [] },
    });
    await expect(version.getReview({ reviewId: ready.reviewId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'rejected' },
    });
    await expect(version.readRef('refs/heads/main')).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: { commitId: movedMainCommitId },
      },
    });
  });
}
