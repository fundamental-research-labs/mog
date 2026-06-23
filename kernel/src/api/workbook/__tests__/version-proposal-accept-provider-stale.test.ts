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

describe('WorkbookVersion provider-backed proposal accept stale handling', () => {
  it('marks a reviewed proposal stale when the target branch head moved', async () => {
    const graph = await graphWithRoot();
    const version = versionForProvider(
      graph.provider,
      graphCommittingWorkspaceService(graph.provider),
    );
    const ready = await createReadyReviewedProposal(version, graph, 'target-stale');
    const movedMainCommitId = await commitRef(
      graph.provider,
      'refs/heads/main',
      graph.rootCommitId,
    );

    const accepted = await version.acceptProposal({
      clientRequestId: 'proposal-accept-target-stale',
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
    await expect(version.readRef('refs/heads/main')).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: { commitId: movedMainCommitId },
      },
    });
    await expect(version.getProposal({ proposalId: ready.proposalId })).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'stale',
        revision: 6,
        diagnostics: [
          expect.objectContaining({
            code: 'stale_head',
            data: expect.objectContaining({
              expectedTargetHeadId: graph.rootCommitId,
              actualTargetHeadId: movedMainCommitId,
            }),
          }),
        ],
      },
    });
  });

  it('replays stale target-head accept retries from durable proposal diagnostics', async () => {
    const graph = await graphWithRoot();
    const version = versionForProvider(
      graph.provider,
      graphCommittingWorkspaceService(graph.provider),
    );
    const ready = await createReadyReviewedProposal(version, graph, 'target-stale-retry');
    const movedMainCommitId = await commitRef(
      graph.provider,
      'refs/heads/main',
      graph.rootCommitId,
    );
    const acceptInput = {
      clientRequestId: 'proposal-accept-target-stale-retry',
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
            code: 'stale_head',
            data: expect.objectContaining({
              acceptClientRequestId: acceptInput.clientRequestId,
              expectedTargetHeadId: graph.rootCommitId,
              actualTargetHeadId: movedMainCommitId,
            }),
          }),
        ]),
      },
    });
    await expect(version.readRef('refs/heads/main')).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: { commitId: movedMainCommitId },
      },
    });
  });

  it('retries stale no-write accepts against current review state without appending diagnostics', async () => {
    const graph = await graphWithRoot();
    const acceptClientRequestId = 'proposal-accept-target-stale-no-write-review-retry';
    const provider = providerWithFirstStaleProposalUpdateFailure(graph.provider, {
      clientRequestId: acceptClientRequestId,
      diagnostic: noWriteStaleProposalUpdateDiagnostic(acceptClientRequestId),
    });
    const version = versionForProvider(
      provider,
      graphCommittingWorkspaceService(graph.provider),
    );
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

  it('keeps target-head drift acceptance disabled without merge apply capability', async () => {
    const graph = await graphWithRoot();
    const version = versionForProvider(
      graph.provider,
      graphCommittingWorkspaceService(graph.provider),
      { proposalAcceptMergeApplyCapability: false },
    );
    const ready = await createReadyReviewedProposal(version, graph, 'target-stale-disabled');
    const movedMainCommitId = await commitRef(
      graph.provider,
      'refs/heads/main',
      graph.rootCommitId,
    );

    const accepted = await version.acceptProposal({
      clientRequestId: 'proposal-accept-target-stale-disabled',
      proposalId: ready.proposalId,
      expectedRevision: 5,
      expectedTargetHeadId: graph.rootCommitId,
      actor: ACTOR,
      resolutionPolicy: 'fastForwardOnly',
    });

    expect(accepted).toMatchObject({
      ok: false,
      error: {
        code: 'version_capability_unavailable',
        capability: 'version:mergeApply',
        dependency: 'VC-07',
      },
    });
    await expect(version.readRef('refs/heads/main')).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: { commitId: movedMainCommitId },
      },
    });
    await expect(version.getProposal({ proposalId: ready.proposalId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'ready_for_review', revision: 5 },
    });
  });

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
});
