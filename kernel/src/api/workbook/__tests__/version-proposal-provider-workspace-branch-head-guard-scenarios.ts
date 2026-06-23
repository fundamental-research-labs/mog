import { expect, it } from '@jest/globals';

import {
  ACTOR,
  createProposalInput,
  versionForProvider,
} from './version-proposal-provider-fixtures';
import { graphWithRoot } from './version-proposal-provider-graph-fixtures';
import { wrongBranchCommittingWorkspaceService } from './version-proposal-provider-workspace-fixtures';

export function registerProposalProviderWorkspaceBranchHeadGuardScenarios(): void {
  it('rejects proposal workspace commits that are not the proposal branch head', async () => {
    const graph = await graphWithRoot();
    const workspaceService = wrongBranchCommittingWorkspaceService(
      graph.provider,
      graph.rootCommitId,
    );
    const version = versionForProvider(graph.provider, {
      proposalWorkspaceService: workspaceService,
    });

    const created = await version.createProposal(
      createProposalInput('proposal-create-wrong-branch'),
    );
    if (!created.ok) throw new Error(`expected proposal create success: ${created.error.code}`);
    const opened = await version.startProposalWorkspace({
      clientRequestId: 'workspace-open-wrong-branch',
      proposalId: created.value.id,
      expectedRevision: 1,
      actor: ACTOR,
    });
    if (!opened.ok) throw new Error(`expected workspace open success: ${opened.error.code}`);

    await expect(
      version.commitProposalWorkspace({
        clientRequestId: 'workspace-commit-wrong-branch',
        proposalId: created.value.id,
        workspaceId: opened.value.workspaceId,
        expectedRevision: 2,
        actor: ACTOR,
        message: 'Wrong branch commit',
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'invalid_state',
        state: 'proposal_commit_branch_head_mismatch',
        allowed: ['proposal_branch_head_commit'],
      },
    });
    await expect(version.getProposal({ proposalId: created.value.id })).resolves.toMatchObject({
      ok: true,
      value: { status: 'workspace_open', revision: 2 },
    });
    await expect(version.getRef(created.value.proposalBranchName)).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: { commitId: graph.rootCommitId },
      },
    });
  });
}
