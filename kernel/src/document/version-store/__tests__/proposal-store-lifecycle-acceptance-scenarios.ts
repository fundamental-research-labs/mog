import type { AgentProposalMetadataStore, AgentProposalRecord } from '../proposals/proposal-store';
import {
  ACCEPTED_COMMIT_ID,
  ACTOR,
  HEAD_COMMIT_ID,
  PROPOSAL_COMMIT_ID,
} from './proposal-store-test-utils';

export async function applyProposalWithTerminalTransitionChecks(
  store: AgentProposalMetadataStore,
  proposal: AgentProposalRecord,
): Promise<void> {
  const applied = await store.updateProposal({
    clientRequestId: 'accept-1',
    proposalId: proposal.id,
    expectedRevision: 5,
    status: 'applied',
    trustedActor: ACTOR,
    accepted: {
      targetRef: 'refs/heads/main',
      expectedTargetHeadId: HEAD_COMMIT_ID,
      appliedCommitId: ACCEPTED_COMMIT_ID,
      refUpdateReceiptId: 'receipt-1',
    },
    updatedAt: '2026-06-22T00:05:00.000Z',
  });
  expect(applied).toMatchObject({
    ok: true,
    value: {
      status: 'applied',
      revision: 6,
      proposalCommitId: PROPOSAL_COMMIT_ID,
      accepted: { appliedCommitId: ACCEPTED_COMMIT_ID },
    },
  });
  if (!applied.ok) throw new Error(`expected apply success: ${applied.error.code}`);

  await expect(
    store.updateProposal({
      clientRequestId: 'reject-after-accepted',
      proposalId: proposal.id,
      expectedRevision: 6,
      status: 'rejected',
      trustedActor: ACTOR,
      reason: 'too late',
    }),
  ).resolves.toMatchObject({
    ok: false,
    error: { code: 'invalid_state', state: 'proposal_status_transition' },
  });
}
