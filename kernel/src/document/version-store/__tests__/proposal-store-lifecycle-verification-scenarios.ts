import type { AgentProposalMetadataStore, AgentProposalRecord } from '../proposals/proposal-store';
import { ACTOR, PASSED_VERIFICATION } from './proposal-store-test-utils';

export async function verifyProposalWithValidationChecks(
  store: AgentProposalMetadataStore,
  proposal: AgentProposalRecord,
): Promise<AgentProposalRecord> {
  await expect(
    store.updateProposal({
      clientRequestId: 'verify-failed-input',
      proposalId: proposal.id,
      expectedRevision: 3,
      status: 'verified',
      trustedActor: ACTOR,
      verification: { ...PASSED_VERIFICATION, status: 'failed' },
    }),
  ).resolves.toMatchObject({
    ok: false,
    error: { code: 'invalid_state', state: 'proposal_verification_required' },
  });

  const verified = await store.updateProposal({
    clientRequestId: 'verify-1',
    proposalId: proposal.id,
    expectedRevision: 3,
    status: 'verified',
    trustedActor: ACTOR,
    verification: PASSED_VERIFICATION,
    updatedAt: '2026-06-22T00:03:00.000Z',
  });
  expect(verified).toMatchObject({
    ok: true,
    value: { status: 'verified', revision: 4, verification: PASSED_VERIFICATION },
  });
  if (!verified.ok) throw new Error(`expected verification success: ${verified.error.code}`);

  return verified.value;
}
