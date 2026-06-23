import {
  ACTOR,
  createReadyReviewedProposal,
  graphCommittingWorkspaceService,
  graphWithRoot,
  versionForProvider,
} from './version-proposal-accept-provider-test-utils';

describe('WorkbookVersion provider-backed proposal accept policy', () => {
  it('fast-forwards the target branch through provider-backed refs after approved review', async () => {
    const graph = await graphWithRoot();
    const version = versionForProvider(
      graph.provider,
      graphCommittingWorkspaceService(graph.provider),
    );
    const ready = await createReadyReviewedProposal(version, graph, 'fast-forward');

    const accepted = await version.acceptProposal({
      clientRequestId: 'proposal-accept-fast-forward',
      proposalId: ready.proposalId,
      expectedRevision: 5,
      expectedTargetHeadId: graph.rootCommitId,
      actor: ACTOR,
      resolutionPolicy: 'fastForwardOnly',
    });

    expect(accepted).toMatchObject({
      ok: true,
      value: {
        status: 'fast_forwarded',
        proposalId: ready.proposalId,
        appliedCommitId: ready.proposalCommitId,
        targetRef: 'refs/heads/main',
        newHeadId: ready.proposalCommitId,
        refUpdateReceiptId: expect.stringContaining('proposal-accept:'),
      },
    });
    await expect(version.readRef('refs/heads/main')).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: { commitId: ready.proposalCommitId },
      },
    });
    await expect(version.getProposal({ proposalId: ready.proposalId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'applied', revision: 6 },
    });
    await expect(version.getReview({ reviewId: ready.reviewId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'applied' },
    });
  });

  it.each(['allowCleanMerge', 'allowResolvedMerge'] as const)(
    'fails closed for unsupported %s acceptance policy',
    async (resolutionPolicy) => {
      const graph = await graphWithRoot();
      const version = versionForProvider(
        graph.provider,
        graphCommittingWorkspaceService(graph.provider),
      );
      const ready = await createReadyReviewedProposal(version, graph, resolutionPolicy);

      const accepted = await version.acceptProposal({
        clientRequestId: `proposal-accept-${resolutionPolicy}`,
        proposalId: ready.proposalId,
        expectedRevision: 5,
        expectedTargetHeadId: graph.rootCommitId,
        actor: ACTOR,
        resolutionPolicy,
      });

      expect(accepted).toMatchObject({
        ok: false,
        error: {
          code: 'invalid_state',
          state: 'proposal_accept_resolution_policy_unsupported',
          allowed: ['fastForwardOnly'],
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
        value: { status: 'ready_for_review', revision: 5 },
      });
      await expect(version.getReview({ reviewId: ready.reviewId })).resolves.toMatchObject({
        ok: true,
        value: { status: 'approved' },
      });
    },
  );
});
