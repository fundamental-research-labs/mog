import type { AgentProposalMetadataStore, AgentProposalRecord } from '../proposals/proposal-store';
import { ACTOR } from './proposal-store-test-utils';

export async function openProposalWorkspaceWithIdempotencyChecks(
  store: AgentProposalMetadataStore,
  proposal: AgentProposalRecord,
): Promise<AgentProposalRecord> {
  const workspace = await store.updateProposal({
    clientRequestId: 'workspace-1',
    proposalId: proposal.id,
    expectedRevision: proposal.revision,
    status: 'workspace_open',
    trustedActor: ACTOR,
    workspaceId: 'workspace-session-1',
    updatedAt: '2026-06-22T00:01:00.000Z',
  });
  expect(workspace).toMatchObject({
    ok: true,
    value: { status: 'workspace_open', revision: 2, workspaceId: 'workspace-session-1' },
  });
  if (!workspace.ok) throw new Error(`expected workspace success: ${workspace.error.code}`);

  await expect(store.getProposalByWorkspaceId('workspace-session-1')).resolves.toEqual(workspace);
  await expect(store.getProposalByWorkspaceId('missing-workspace')).resolves.toMatchObject({
    ok: false,
    error: { code: 'not_found', target: 'workbook.version.proposal' },
  });
  await expect(
    store.updateProposal({
      clientRequestId: 'workspace-1',
      proposalId: proposal.id,
      expectedRevision: proposal.revision,
      status: 'workspace_open',
      trustedActor: ACTOR,
      workspaceId: 'workspace-session-1',
      updatedAt: '2026-06-22T00:01:00.000Z',
    }),
  ).resolves.toEqual(workspace);
  await expect(
    store.updateProposal({
      clientRequestId: 'workspace-1',
      proposalId: proposal.id,
      expectedRevision: 2,
      status: 'workspace_open',
      trustedActor: ACTOR,
      workspaceId: 'different-workspace',
    }),
  ).resolves.toMatchObject({
    ok: false,
    error: { code: 'invalid_state', state: 'proposal_client_request_reused' },
  });

  return workspace.value;
}
