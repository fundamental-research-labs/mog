import { expect, it } from '@jest/globals';

import {
  ACTOR,
  commitRef,
  createReadyReviewedProposal,
  graphCommittingWorkspaceService,
  graphWithRoot,
  versionForProvider,
} from './version-proposal-accept-provider-test-utils';

export function registerProposalBranchStaleScenarios(): void {
  it('marks a reviewed proposal stale when the proposal branch head changed', async () => {
    const graph = await graphWithRoot();
    const version = versionForProvider(
      graph.provider,
      graphCommittingWorkspaceService(graph.provider),
    );
    const ready = await createReadyReviewedProposal(version, graph, 'proposal-branch-stale');
    await commitRef(
      graph.provider,
      `refs/heads/${ready.proposalBranchName}`,
      ready.proposalCommitId,
    );

    const accepted = await version.acceptProposal({
      clientRequestId: 'proposal-accept-proposal-branch-stale',
      proposalId: ready.proposalId,
      expectedRevision: 5,
      expectedTargetHeadId: graph.rootCommitId,
      actor: ACTOR,
      resolutionPolicy: 'fastForwardOnly',
    });

    expect(accepted).toMatchObject({
      ok: true,
      value: {
        status: 'stale',
        proposalId: ready.proposalId,
        expectedTargetHeadId: graph.rootCommitId,
        actualTargetHeadId: graph.rootCommitId,
      },
    });
    await expect(version.readRef('refs/heads/main')).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: { commitId: graph.rootCommitId },
      },
    });
    await expect(version.getProposal({ proposalId: ready.proposalId })).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'stale',
        revision: 6,
        diagnostics: [
          expect.objectContaining({
            code: 'stale_proposal_branch_head',
            data: expect.objectContaining({
              expectedProposalCommitId: ready.proposalCommitId,
              actualProposalBranchHeadId: expect.stringMatching(/^commit:sha256:/),
            }),
          }),
        ],
      },
    });
    await expect(version.getReview({ reviewId: ready.reviewId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'approved' },
    });
  });

  it('replays stale proposal-branch accept retries from durable proposal diagnostics', async () => {
    const graph = await graphWithRoot();
    const version = versionForProvider(
      graph.provider,
      graphCommittingWorkspaceService(graph.provider),
    );
    const ready = await createReadyReviewedProposal(version, graph, 'proposal-branch-stale-retry');
    const movedProposalBranchHeadId = await commitRef(
      graph.provider,
      `refs/heads/${ready.proposalBranchName}`,
      ready.proposalCommitId,
    );
    const acceptInput = {
      clientRequestId: 'proposal-accept-proposal-branch-stale-retry',
      proposalId: ready.proposalId,
      expectedRevision: 5,
      expectedTargetHeadId: graph.rootCommitId,
      actor: ACTOR,
      resolutionPolicy: 'fastForwardOnly',
    } as const;

    const accepted = await version.acceptProposal(acceptInput);
    const retry = await version.acceptProposal(acceptInput);

    expect(retry).toEqual(accepted);
    await expect(version.getProposal({ proposalId: ready.proposalId })).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'stale',
        revision: 6,
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'stale_proposal_branch_head',
            data: expect.objectContaining({
              acceptClientRequestId: acceptInput.clientRequestId,
              expectedTargetHeadId: graph.rootCommitId,
              actualTargetHeadId: graph.rootCommitId,
              actualProposalBranchHeadId: movedProposalBranchHeadId,
            }),
          }),
        ]),
      },
    });
    await expect(version.readRef('refs/heads/main')).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: { commitId: graph.rootCommitId },
      },
    });
  });
}
