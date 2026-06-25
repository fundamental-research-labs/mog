import type { AgentProposalMetadataStore, AgentProposalRecord } from '../proposals/proposal-store';
import { BASE_COMMIT_ID, DOCUMENT_SCOPE, createProposalInput } from './proposal-store-test-utils';

export async function createProposalDraftWithIdempotencyChecks(
  store: AgentProposalMetadataStore,
): Promise<AgentProposalRecord> {
  const createInput = createProposalInput('create-1');

  const created = await store.createProposal(createInput);
  expect(created).toMatchObject({
    ok: true,
    value: {
      id: expect.stringMatching(/^proposal:sha256:[0-9a-f]{64}$/),
      documentId: DOCUMENT_SCOPE.documentId,
      status: 'draft',
      revision: 1,
      targetRef: 'refs/heads/main',
      baseCommitId: BASE_COMMIT_ID,
      proposalBranchName: 'agent/agent-run-1/proposal-1',
      agentRunId: 'agent-run-1',
    },
  });
  if (!created.ok) throw new Error(`expected create success: ${created.error.code}`);

  await expect(store.createProposal(createInput)).resolves.toEqual(created);
  await expect(
    store.createProposal({ ...createInput, title: 'Different title' }),
  ).resolves.toMatchObject({
    ok: false,
    error: { code: 'invalid_state', state: 'proposal_client_request_reused' },
  });

  return created.value;
}
