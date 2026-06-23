import { jest } from '@jest/globals';

import {
  AGENT,
  BASE_COMMIT_ID,
  PROPOSAL_ID,
  REDACTION_POLICY,
  createCompleteProposalService,
  createProposalRuntimeVersion,
} from './version-proposal-runtime-test-utils';

describe('WorkbookVersion proposal runtime facade', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('dispatches proposal methods to an attached proposal service', async () => {
    const proposalService = createCompleteProposalService();
    const version = createProposalRuntimeVersion({
      versioning: { proposalService },
    });
    const input = {
      clientRequestId: 'create-1',
      title: 'Proposal One',
      targetRef: 'refs/heads/main',
      baseCommitId: BASE_COMMIT_ID,
      agentRunId: 'agent-run-1',
      agent: AGENT,
      proposalBranchNameHint: 'agent/agent-run-1/proposal-one',
      redactionPolicy: REDACTION_POLICY,
    };

    const result = await version.createProposal(input as any);

    expect(result).toMatchObject({ ok: true, value: { status: 'draft' } });
    expect(proposalService.createProposal).toHaveBeenCalledWith(input);
  });

  it('returns target_unavailable when no proposal service is attached', async () => {
    const version = createProposalRuntimeVersion();

    const result = await version.getProposal({ proposalId: PROPOSAL_ID } as any);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.getProposal',
      },
    });
  });
});
