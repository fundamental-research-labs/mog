import { expect, it } from '@jest/globals';

import {
  ACTOR,
  createProposalInput,
  versionForProvider,
} from './version-proposal-provider-fixtures';
import { graphWithRoot } from './version-proposal-provider-graph-fixtures';
import { misboundStartWorkspaceService } from './version-proposal-provider-workspace-fixtures';

export function registerProposalProviderWorkspaceStartBindingScenarios(): void {
  it('rejects proposal workspace handles that do not match the proposal binding', async () => {
    const graph = await graphWithRoot();
    const workspaceService = misboundStartWorkspaceService(graph.provider);
    const version = versionForProvider(graph.provider, {
      proposalWorkspaceService: workspaceService,
    });

    const created = await version.createProposal(
      createProposalInput('proposal-create-misbound-start'),
    );
    if (!created.ok) throw new Error(`expected proposal create success: ${created.error.code}`);

    await expect(
      version.startProposalWorkspace({
        clientRequestId: 'workspace-open-misbound',
        proposalId: created.value.id,
        expectedRevision: 1,
        actor: ACTOR,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'invalid_state',
        state: 'proposal_workspace_proposal_mismatch',
        allowed: ['matching_proposal_workspace'],
      },
    });
    const stored = await version.getProposal({ proposalId: created.value.id });
    expect(stored).toMatchObject({
      ok: true,
      value: { status: 'draft', revision: 1 },
    });
    if (!stored.ok) throw new Error(`expected proposal get success: ${stored.error.code}`);
    expect('workspaceId' in stored.value).toBe(false);
  });
}
