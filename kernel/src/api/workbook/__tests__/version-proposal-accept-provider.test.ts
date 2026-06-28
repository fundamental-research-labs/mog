import {
  ACTOR,
  commitRef,
  createReadyReviewedProposal,
  graphCommittingWorkspaceService,
  graphWithRoot,
  versionForProvider,
} from './version-proposal-accept-provider-test-utils';
import { createMergeCommitCapture } from '../../../document/version-store/__tests__/commit-service-test-support';

describe('WorkbookVersion provider-backed proposal accept policy', () => {
  it('fast-forwards the target branch through provider-backed refs after approved review', async () => {
    const graph = await graphWithRoot();
    const version = versionForProvider(
      graph.provider,
      graphCommittingWorkspaceService(graph.provider),
    );
    const ready = await createReadyReviewedProposal(version, graph, 'fast-forward');

    const accepted = await version.proposals.advanced.acceptProposal({
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
    await expect(version.proposals.advanced.getProposal({ proposalId: ready.proposalId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'applied', revision: 6 },
    });
    await expect(version.getReview({ reviewId: ready.reviewId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'applied' },
    });
  });

  it.each(['allowCleanMerge', 'allowResolvedMerge'] as const)(
    'fast-forwards unchanged targets for permissive %s acceptance policy',
    async (resolutionPolicy) => {
      const graph = await graphWithRoot();
      const version = versionForProvider(
        graph.provider,
        graphCommittingWorkspaceService(graph.provider),
      );
      const ready = await createReadyReviewedProposal(version, graph, resolutionPolicy);

      const accepted = await version.proposals.advanced.acceptProposal({
        clientRequestId: `proposal-accept-${resolutionPolicy}`,
        proposalId: ready.proposalId,
        expectedRevision: 5,
        expectedTargetHeadId: graph.rootCommitId,
        actor: ACTOR,
        resolutionPolicy,
      });

      expect(accepted).toMatchObject({
        ok: true,
        value: {
          status: 'fast_forwarded',
          proposalId: ready.proposalId,
          appliedCommitId: ready.proposalCommitId,
        },
      });
      await expect(version.readRef('refs/heads/main')).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          ref: { commitId: ready.proposalCommitId },
        },
      });
      await expect(version.proposals.advanced.getProposal({ proposalId: ready.proposalId })).resolves.toMatchObject({
        ok: true,
        value: { status: 'applied', revision: 6 },
      });
      await expect(version.getReview({ reviewId: ready.reviewId })).resolves.toMatchObject({
        ok: true,
        value: { status: 'applied' },
      });
    },
  );

  it('applies a clean merge when the target moved and allowCleanMerge is requested', async () => {
    const graph = await graphWithRoot();
    const version = versionForProvider(
      graph.provider,
      graphCommittingWorkspaceService(graph.provider),
      { captureMergeCommit: createMergeCommitCapture('proposal-accept-clean') },
    );
    const ready = await createReadyReviewedProposal(version, graph, 'allow-clean-merge');
    const movedMainCommitId = await commitRef(
      graph.provider,
      'refs/heads/main',
      graph.rootCommitId,
      { cell: 'C1', value: 'target-moved' },
    );

    const accepted = await version.proposals.advanced.acceptProposal({
      clientRequestId: 'proposal-accept-clean-merge',
      proposalId: ready.proposalId,
      expectedRevision: 5,
      expectedTargetHeadId: graph.rootCommitId,
      actor: ACTOR,
      resolutionPolicy: 'allowCleanMerge',
    });

    if (!accepted.ok) throw new Error(`expected clean merge accept: ${JSON.stringify(accepted.error)}`);
    expect(accepted).toMatchObject({
      ok: true,
      value: {
        status: 'merge_applied',
        proposalId: ready.proposalId,
        targetRef: 'refs/heads/main',
        mergePreviewId: expect.any(String),
        refUpdateReceiptId: expect.stringContaining('proposal-accept:'),
      },
    });
    expect(accepted.value.newHeadId).not.toBe(movedMainCommitId);
    expect(accepted.value.newHeadId).not.toBe(ready.proposalCommitId);
    await expect(version.readRef('refs/heads/main')).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: { commitId: accepted.value.newHeadId },
      },
    });
    await expect(version.proposals.advanced.getProposal({ proposalId: ready.proposalId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'applied', revision: 6 },
    });
    await expect(version.getReview({ reviewId: ready.reviewId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'applied' },
    });
  });

  it('returns merge_conflicted when the target moved and clean merge is not possible', async () => {
    const graph = await graphWithRoot();
    const version = versionForProvider(
      graph.provider,
      graphCommittingWorkspaceService(graph.provider),
    );
    const ready = await createReadyReviewedProposal(version, graph, 'allow-clean-conflict');
    const movedMainCommitId = await commitRef(
      graph.provider,
      'refs/heads/main',
      graph.rootCommitId,
      { cell: 'B1', value: 'target-moved' },
    );

    const accepted = await version.proposals.advanced.acceptProposal({
      clientRequestId: 'proposal-accept-clean-conflict',
      proposalId: ready.proposalId,
      expectedRevision: 5,
      expectedTargetHeadId: graph.rootCommitId,
      actor: ACTOR,
      resolutionPolicy: 'allowCleanMerge',
    });

    if (!accepted.ok) throw new Error(`expected conflict accept result: ${JSON.stringify(accepted.error)}`);
    expect(accepted).toMatchObject({
      ok: true,
      value: {
        status: 'merge_conflicted',
        proposalId: ready.proposalId,
        mergePreviewId: expect.any(String),
        conflictIds: expect.arrayContaining([expect.any(String)]),
      },
    });
    await expect(version.readRef('refs/heads/main')).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: { commitId: movedMainCommitId },
      },
    });
    await expect(version.proposals.advanced.getProposal({ proposalId: ready.proposalId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'merge_conflicted', revision: 6 },
    });
    await expect(version.getReview({ reviewId: ready.reviewId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'approved' },
    });
  });
});
