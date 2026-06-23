import { expect, it } from '@jest/globals';

import {
  ACTOR,
  createReadyReviewedProposal,
  versionForProvider,
} from './version-proposal-provider-fixtures';
import { commitMain, graphWithRoot } from './version-proposal-provider-graph-fixtures';
import { approvedReviewServiceWithoutFinalizer } from './version-proposal-provider-review-fixtures';
import { graphCommittingWorkspaceService } from './version-proposal-provider-workspace-fixtures';

export function registerProposalProviderAcceptanceScenarios(): void {
  it('rejects proposal acceptance until the linked review is approved', async () => {
    const graph = await graphWithRoot();
    const workspaceService = graphCommittingWorkspaceService(graph.provider);
    const version = versionForProvider(graph.provider, {
      proposalWorkspaceService: workspaceService,
    });
    const ready = await createReadyReviewedProposal(version, graph, 'unapproved', {
      approveReview: false,
    });

    const accepted = await version.acceptProposal({
      clientRequestId: 'proposal-accept-unapproved',
      proposalId: ready.proposalId,
      expectedRevision: 5,
      expectedTargetHeadId: graph.rootCommitId,
      actor: ACTOR,
      resolutionPolicy: 'fastForwardOnly',
    });
    expect(accepted).toMatchObject({
      ok: false,
      error: {
        code: 'invalid_state',
        state: 'proposal_review_not_approved',
        allowed: ['approved'],
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
      value: { status: 'open' },
    });
  });

  it('rejects proposal acceptance when the linked review cannot be finalized', async () => {
    const graph = await graphWithRoot();
    const workspaceService = graphCommittingWorkspaceService(graph.provider);
    const version = versionForProvider(graph.provider, {
      proposalWorkspaceService: workspaceService,
      reviewService: approvedReviewServiceWithoutFinalizer(),
    });
    const ready = await createReadyReviewedProposal(version, graph, 'no-review-finalizer', {
      approveReview: false,
    });

    const accepted = await version.acceptProposal({
      clientRequestId: 'proposal-accept-no-review-finalizer',
      proposalId: ready.proposalId,
      expectedRevision: 5,
      expectedTargetHeadId: graph.rootCommitId,
      actor: ACTOR,
      resolutionPolicy: 'fastForwardOnly',
    });
    expect(accepted).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.acceptProposal',
        diagnostics: [expect.objectContaining({ code: 'VERSION_REVIEW_FINALIZER_UNAVAILABLE' })],
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
  });

  it('marks a proposal stale when the target ref moves before acceptance', async () => {
    const graph = await graphWithRoot();
    const workspaceService = graphCommittingWorkspaceService(graph.provider);
    const version = versionForProvider(graph.provider, {
      proposalWorkspaceService: workspaceService,
    });
    const ready = await createReadyReviewedProposal(version, graph, 'stale');
    const movedMainCommitId = await commitMain(graph.provider, graph.rootCommitId);

    const accepted = await version.acceptProposal({
      clientRequestId: 'proposal-accept-stale',
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
        actualTargetHeadId: movedMainCommitId,
      },
    });

    await expect(version.getProposal({ proposalId: ready.proposalId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'stale', revision: 6 },
    });
    await expect(version.getReview({ reviewId: ready.reviewId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'approved' },
    });
  });
}
