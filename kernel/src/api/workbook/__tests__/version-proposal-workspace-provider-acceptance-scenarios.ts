import { expect, it } from '@jest/globals';

import {
  ACTOR,
  commitRef,
  createReadyReviewedProposal,
  graphWithRoot,
  missingLinkedReviewService,
  staleHeadCheckingWorkspaceService,
  versionForProvider,
} from './version-proposal-workspace-provider-fixtures';

export function registerProposalWorkspaceAcceptanceScenarios(): void {
  it('rejects proposal acceptance when the linked review record is missing', async () => {
    const graph = await graphWithRoot();
    const version = versionForProvider(
      graph.provider,
      staleHeadCheckingWorkspaceService(graph.provider),
      { reviewService: missingLinkedReviewService() as any },
    );
    const ready = await createReadyReviewedProposal(version, graph, 'missing-review', false);

    await expect(
      version.acceptProposal({
        clientRequestId: 'proposal-accept-missing-review',
        proposalId: ready.proposalId,
        expectedRevision: 5,
        expectedTargetHeadId: graph.rootCommitId,
        actor: ACTOR,
        resolutionPolicy: 'fastForwardOnly',
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'not_found',
        target: 'workbook.version.review',
        reason: expect.stringContaining(ready.reviewId),
      },
    });
    await expect(version.getProposal({ proposalId: ready.proposalId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'ready_for_review', revision: 5, reviewId: ready.reviewId },
    });
    await expect(version.readRef('refs/heads/main')).resolves.toMatchObject({
      ok: true,
      value: { status: 'success', ref: { commitId: graph.rootCommitId } },
    });
  });

  it('persists public diagnostics when the target head moves before acceptance', async () => {
    const graph = await graphWithRoot();
    const version = versionForProvider(
      graph.provider,
      staleHeadCheckingWorkspaceService(graph.provider),
    );
    const ready = await createReadyReviewedProposal(version, graph, 'stale-target');
    const movedMainCommitId = await commitRef(
      graph.provider,
      'refs/heads/main',
      graph.rootCommitId,
    );

    await expect(
      version.acceptProposal({
        clientRequestId: 'proposal-accept-stale-target',
        proposalId: ready.proposalId,
        expectedRevision: 5,
        expectedTargetHeadId: graph.rootCommitId,
        actor: ACTOR,
        resolutionPolicy: 'fastForwardOnly',
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'stale',
        proposalId: ready.proposalId,
        expectedTargetHeadId: graph.rootCommitId,
        actualTargetHeadId: movedMainCommitId,
      },
    });
    await expect(version.getProposal({ proposalId: ready.proposalId })).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'stale',
        revision: 6,
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'stale_head',
            severity: 'warning',
            data: expect.objectContaining({
              expectedTargetHeadId: graph.rootCommitId,
              actualTargetHeadId: movedMainCommitId,
            }),
          }),
          expect.objectContaining({
            code: 'stale_proposal_target_ref_revision',
            severity: 'warning',
            data: expect.objectContaining({
              expectedTargetHeadId: graph.rootCommitId,
              actualTargetHeadId: movedMainCommitId,
            }),
          }),
        ]),
      },
    });
    await expect(version.getReview({ reviewId: ready.reviewId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'approved' },
    });
  });
}
