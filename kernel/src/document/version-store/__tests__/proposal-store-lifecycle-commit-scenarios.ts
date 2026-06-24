import type { AgentProposalMetadataStore, AgentProposalRecord } from '../proposals/proposal-store';
import { ACTOR, PROPOSAL_COMMIT_ID } from './proposal-store-test-utils';

export async function commitProposalWithValidationChecks(
  store: AgentProposalMetadataStore,
  proposal: AgentProposalRecord,
): Promise<AgentProposalRecord> {
  await expect(
    store.updateProposal({
      clientRequestId: 'commit-stale',
      proposalId: proposal.id,
      expectedRevision: 1,
      status: 'committed',
      trustedActor: ACTOR,
      proposalCommitId: PROPOSAL_COMMIT_ID,
    }),
  ).resolves.toMatchObject({
    ok: false,
    error: { code: 'stale_revision', expectedRevision: 1, actualRevision: 2 },
  });
  await expect(
    store.updateProposal({
      clientRequestId: 'commit-missing',
      proposalId: proposal.id,
      expectedRevision: 2,
      status: 'committed',
      trustedActor: ACTOR,
    }),
  ).resolves.toMatchObject({
    ok: false,
    error: { code: 'invalid_state', state: 'proposal_commit_required' },
  });

  const committed = await store.updateProposal({
    clientRequestId: 'commit-1',
    proposalId: proposal.id,
    expectedRevision: 2,
    status: 'committed',
    trustedActor: ACTOR,
    proposalCommitId: PROPOSAL_COMMIT_ID,
    updatedAt: '2026-06-22T00:02:00.000Z',
  });
  expect(committed).toMatchObject({
    ok: true,
    value: { status: 'committed', revision: 3, proposalCommitId: PROPOSAL_COMMIT_ID },
  });
  if (!committed.ok) throw new Error(`expected commit success: ${committed.error.code}`);

  return committed.value;
}
