import { expect, it } from '@jest/globals';

import {
  ACTOR,
  commitRef,
  graphWithRoot,
  openProposalWorkspace,
  staleHeadCheckingWorkspaceService,
  versionForProvider,
} from './version-proposal-workspace-provider-fixtures';

export function registerProposalWorkspaceCommitScenarios(): void {
  it('fails closed when a proposal workspace commit observes a stale branch head', async () => {
    const graph = await graphWithRoot();
    const workspaceService = staleHeadCheckingWorkspaceService(graph.provider);
    const version = versionForProvider(graph.provider, workspaceService);
    const opened = await openProposalWorkspace(version, 'workspace-stale-head');
    const movedProposalBranchHeadId = await commitRef(
      graph.provider,
      `refs/heads/${opened.proposalBranchName}`,
      graph.rootCommitId,
    );
    const safeProposalBranchName = opened.proposalBranchName.replace(
      'agent-run-1',
      'redacted-principal',
    );

    const committed = await version.commitProposalWorkspace({
      clientRequestId: 'workspace-commit-stale-head',
      proposalId: opened.proposalId,
      workspaceId: opened.workspaceId,
      expectedRevision: 2,
      actor: ACTOR,
      message: 'Stale workspace commit',
    });
    expect(committed).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.commitProposalWorkspace',
        diagnostics: [
          expect.objectContaining({
            code: 'stale_proposal_workspace_head',
            data: expect.objectContaining({
              proposalId: opened.proposalId,
              proposalBranchName: safeProposalBranchName,
              expectedWorkspaceHeadId: graph.rootCommitId,
              actualProposalBranchHeadId: movedProposalBranchHeadId,
            }),
          }),
        ],
      },
    });
    if (committed.ok) throw new Error('expected stale workspace commit to fail');
    expect(committed.error.diagnostics[0]?.data).not.toHaveProperty('workspaceId');
    expect(JSON.stringify(committed)).not.toContain('agent-run-1');
    expect(JSON.stringify(committed)).not.toContain(opened.workspaceId);
    await expect(version.getProposal({ proposalId: opened.proposalId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'workspace_open', revision: 2 },
    });
  });

  it('rejects proposal workspace commits after the proposal target advances', async () => {
    const graph = await graphWithRoot();
    const workspaceService = staleHeadCheckingWorkspaceService(graph.provider);
    const version = versionForProvider(graph.provider, workspaceService);
    const opened = await openProposalWorkspace(version, 'workspace-stale-target');
    const movedMainCommitId = await commitRef(
      graph.provider,
      'refs/heads/main',
      graph.rootCommitId,
    );

    await expect(
      version.commitProposalWorkspace({
        clientRequestId: 'workspace-commit-stale-target',
        proposalId: opened.proposalId,
        workspaceId: opened.workspaceId,
        expectedRevision: 2,
        expectedTargetHeadId: opened.targetHeadIdAtCreation,
        expectedTargetRefRevision: opened.targetRefRevisionAtCreation,
        actor: ACTOR,
        message: 'Stale target workspace commit',
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.commitProposalWorkspace',
        diagnostics: [
          expect.objectContaining({
            code: 'stale_proposal_target_head',
            data: expect.objectContaining({
              proposalId: opened.proposalId,
              expectedTargetHeadId: graph.rootCommitId,
              actualTargetHeadId: movedMainCommitId,
            }),
          }),
        ],
      },
    });
    await expect(version.getProposal({ proposalId: opened.proposalId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'workspace_open', revision: 2 },
    });
  });
}
