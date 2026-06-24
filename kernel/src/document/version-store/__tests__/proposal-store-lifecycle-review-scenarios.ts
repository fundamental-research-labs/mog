import type { AgentProposalMetadataStore, AgentProposalRecord } from '../proposals/proposal-store';
import { ACTOR } from './proposal-store-test-utils';

export async function markProposalReadyForReviewWithValidationChecks(
  store: AgentProposalMetadataStore,
  proposal: AgentProposalRecord,
): Promise<AgentProposalRecord> {
  await expect(
    store.updateProposal({
      clientRequestId: 'ready-missing-review',
      proposalId: proposal.id,
      expectedRevision: 4,
      status: 'ready_for_review',
      trustedActor: ACTOR,
    }),
  ).resolves.toMatchObject({
    ok: false,
    error: { code: 'invalid_state', state: 'proposal_review_required' },
  });

  const ready = await store.updateProposal({
    clientRequestId: 'ready-1',
    proposalId: proposal.id,
    expectedRevision: 4,
    status: 'ready_for_review',
    trustedActor: ACTOR,
    reviewId: 'review-1',
    updatedAt: '2026-06-22T00:04:00.000Z',
  });
  expect(ready).toMatchObject({
    ok: true,
    value: { status: 'ready_for_review', revision: 5, reviewId: 'review-1' },
  });
  if (!ready.ok) throw new Error(`expected review success: ${ready.error.code}`);

  return ready.value;
}
