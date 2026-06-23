import { expect, it } from '@jest/globals';

import {
  ACTOR,
  PASSED_VERIFICATION,
  approveReview,
  createProposalInput,
  versionForProvider,
} from './version-proposal-provider-fixtures';
import { graphWithRoot } from './version-proposal-provider-graph-fixtures';
import { graphCommittingWorkspaceService } from './version-proposal-provider-workspace-fixtures';

export function registerProposalProviderWorkspaceLifecycleAttachedServiceFastForwardScenarios(): void {
  it('delegates workspace lifecycle to an attached branch-isolated workspace service before review', async () => {
    const graph = await graphWithRoot();
    const workspaceService = graphCommittingWorkspaceService(graph.provider);
    const version = versionForProvider(graph.provider, {
      proposalWorkspaceService: workspaceService,
    });

    await expect(version.getSurfaceStatus()).resolves.toMatchObject({
      capabilities: { 'version:proposal': { enabled: true } },
    });

    const created = await version.createProposal(createProposalInput('proposal-create-2'));
    if (!created.ok) throw new Error(`expected proposal create success: ${created.error.code}`);

    const opened = await version.startProposalWorkspace({
      clientRequestId: 'workspace-open-1',
      proposalId: created.value.id,
      expectedRevision: 1,
      actor: ACTOR,
    });
    expect(opened).toMatchObject({
      ok: true,
      value: {
        proposalId: created.value.id,
        proposalBranchName: created.value.proposalBranchName,
        baseCommitId: graph.rootCommitId,
      },
    });
    if (!opened.ok) throw new Error(`expected workspace open success: ${opened.error.code}`);

    const committed = await version.commitProposalWorkspace({
      clientRequestId: 'workspace-commit-1',
      proposalId: created.value.id,
      workspaceId: opened.value.workspaceId,
      expectedRevision: 2,
      actor: ACTOR,
      message: 'Agent proposal commit',
    });
    if (!committed.ok) {
      throw new Error(`expected proposal commit success: ${JSON.stringify(committed.error)}`);
    }
    expect(committed).toMatchObject({
      ok: true,
      value: {
        status: 'committed',
        revision: 3,
        proposalCommitId: expect.stringMatching(/^commit:sha256:[0-9a-f]{64}$/),
      },
    });
    await expect(version.getRef(created.value.proposalBranchName)).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: { commitId: committed.value.proposalCommitId },
      },
    });

    const verified = await version.markProposalVerified({
      clientRequestId: 'proposal-verify-1',
      proposalId: created.value.id,
      expectedRevision: 3,
      actor: ACTOR,
      verification: PASSED_VERIFICATION,
    });
    expect(verified).toMatchObject({ ok: true, value: { status: 'verified', revision: 4 } });
    if (!verified.ok) throw new Error(`expected proposal verify success: ${verified.error.code}`);

    const review = await version.openProposalReview({
      clientRequestId: 'proposal-review-1',
      proposalId: created.value.id,
      expectedRevision: 4,
      actor: ACTOR,
    });
    expect(review).toMatchObject({
      ok: true,
      value: {
        subject: {
          kind: 'proposal',
          proposalId: created.value.id,
          baseCommitId: graph.rootCommitId,
          headCommitId: committed.value.proposalCommitId,
        },
      },
    });
    if (!review.ok) throw new Error(`expected proposal review success: ${review.error.code}`);
    const approved = await approveReview(
      version,
      review.value.id,
      review.value.revision,
      'proposal-review-approve-1',
    );
    expect(approved).toMatchObject({ ok: true, value: { status: 'approved' } });
    if (!approved.ok) throw new Error(`expected review approval success: ${approved.error.code}`);
    if (!approved.value.approval) throw new Error('expected approval evidence');

    await expect(version.getProposal({ proposalId: created.value.id })).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'ready_for_review',
        revision: 5,
        reviewId: review.value.id,
      },
    });

    const accepted = await version.acceptProposal({
      clientRequestId: 'proposal-accept-1',
      proposalId: created.value.id,
      expectedRevision: 5,
      expectedTargetHeadId: graph.rootCommitId,
      actor: ACTOR,
      resolutionPolicy: 'fastForwardOnly',
    });
    if (!accepted.ok) {
      throw new Error(`expected proposal accept success: ${JSON.stringify(accepted.error)}`);
    }
    expect(accepted).toMatchObject({
      ok: true,
      value: {
        status: 'fast_forwarded',
        proposalId: created.value.id,
        appliedCommitId: committed.value.proposalCommitId,
        targetRef: 'refs/heads/main',
        newHeadId: committed.value.proposalCommitId,
        refUpdateReceiptId: expect.stringContaining('proposal-accept:'),
      },
    });

    await expect(version.readRef('refs/heads/main')).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: { commitId: committed.value.proposalCommitId },
      },
    });
    await expect(version.getProposal({ proposalId: created.value.id })).resolves.toMatchObject({
      ok: true,
      value: { status: 'applied', revision: 6 },
    });
    await expect(version.getReview({ reviewId: review.value.id })).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'applied',
        revision: approved.value.revision + 1,
        approval: approved.value.approval,
      },
    });

    await expect(
      version.acceptProposal({
        clientRequestId: 'proposal-accept-1-retry',
        proposalId: created.value.id,
        expectedRevision: 5,
        expectedTargetHeadId: graph.rootCommitId,
        actor: ACTOR,
        resolutionPolicy: 'fastForwardOnly',
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'fast_forwarded',
        proposalId: created.value.id,
        appliedCommitId: committed.value.proposalCommitId,
      },
    });
  });
}
