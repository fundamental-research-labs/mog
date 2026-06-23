import { expect, it } from '@jest/globals';

import {
  ACTOR,
  createProposalInput,
  versionForProvider,
} from './version-proposal-provider-fixtures';
import { graphWithRoot } from './version-proposal-provider-graph-fixtures';
import { graphCommittingWorkspaceService } from './version-proposal-provider-workspace-fixtures';

export function registerProposalProviderWorkspaceIdGuardScenarios(): void {
  it('rejects proposal workspace commits with a stale workspace id', async () => {
    const graph = await graphWithRoot();
    const workspaceService = graphCommittingWorkspaceService(graph.provider);
    const version = versionForProvider(graph.provider, {
      proposalWorkspaceService: workspaceService,
    });

    const created = await version.createProposal(
      createProposalInput('proposal-create-workspace-id'),
    );
    if (!created.ok) throw new Error(`expected proposal create success: ${created.error.code}`);
    const opened = await version.startProposalWorkspace({
      clientRequestId: 'workspace-open-id-check',
      proposalId: created.value.id,
      expectedRevision: 1,
      actor: ACTOR,
    });
    if (!opened.ok) throw new Error(`expected workspace open success: ${opened.error.code}`);

    await expect(
      version.commitProposalWorkspace({
        clientRequestId: 'workspace-commit-id-mismatch',
        proposalId: created.value.id,
        workspaceId: `${opened.value.workspaceId}:stale`,
        expectedRevision: 2,
        actor: ACTOR,
        message: 'Wrong workspace commit',
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'invalid_state',
        state: 'proposal_workspace_mismatch',
        allowed: ['matching_workspace_id'],
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
