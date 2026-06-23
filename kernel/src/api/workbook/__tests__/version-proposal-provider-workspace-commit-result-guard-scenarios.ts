import { expect, it } from '@jest/globals';

import {
  ACTOR,
  createProposalInput,
  versionForProvider,
} from './version-proposal-provider-fixtures';
import { graphWithRoot } from './version-proposal-provider-graph-fixtures';
import { mismatchedCommitWorkspaceService } from './version-proposal-provider-workspace-fixtures';

export function registerProposalProviderWorkspaceCommitResultGuardScenarios(): void {
  it('rejects proposal workspace commits whose result echoes a different workspace id', async () => {
    const graph = await graphWithRoot();
    const workspaceService = mismatchedCommitWorkspaceService(graph.provider);
    const version = versionForProvider(graph.provider, {
      proposalWorkspaceService: workspaceService,
    });

    const created = await version.createProposal(
      createProposalInput('proposal-create-commit-workspace-mismatch'),
    );
    if (!created.ok) throw new Error(`expected proposal create success: ${created.error.code}`);
    const opened = await version.startProposalWorkspace({
      clientRequestId: 'workspace-open-commit-workspace-mismatch',
      proposalId: created.value.id,
      expectedRevision: 1,
      actor: ACTOR,
    });
    if (!opened.ok) throw new Error(`expected workspace open success: ${opened.error.code}`);

    await expect(
      version.commitProposalWorkspace({
        clientRequestId: 'workspace-commit-result-mismatch',
        proposalId: created.value.id,
        workspaceId: opened.value.workspaceId,
        expectedRevision: 2,
        actor: ACTOR,
        message: 'Mismatched workspace commit result',
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'invalid_state',
        state: 'proposal_workspace_commit_mismatch',
        allowed: ['matching_workspace_id'],
      },
    });
    await expect(version.getProposal({ proposalId: created.value.id })).resolves.toMatchObject({
      ok: true,
      value: { status: 'workspace_open', revision: 2 },
    });
  });
}
