import { expect, it, jest } from '@jest/globals';

import {
  AGENT,
  BASE_COMMIT_ID,
  HEAD_COMMIT_ID,
  REDACTION_POLICY,
  createCompleteProposalService,
  createProposalRuntimeVersion,
  storeDiagnostic,
  targetUnavailable,
} from './version-proposal-runtime-test-utils';

export function registerProposalRuntimeDiagnosticsServiceCreateScenarios(): void {
  it('normalizes stale head diagnostics returned during proposal creation', async () => {
    const proposalService = createCompleteProposalService({
      createProposal: jest.fn(async () =>
        targetUnavailable('createProposal', [
          storeDiagnostic(
            'VERSION_PROPOSAL_STALE_HEAD',
            'Proposal baseCommitId must match the current target ref head.',
            {
              operation: 'createProposal',
              expectedTargetHeadId: BASE_COMMIT_ID,
              actualTargetHeadId: HEAD_COMMIT_ID,
              proposalId: 'proposal:sha256:not-public',
            },
            { recoverability: 'retry' },
          ),
        ]),
      ),
    });
    const version = createProposalRuntimeVersion({
      versioning: { proposalService },
    });

    const result = await version.createProposal({
      clientRequestId: 'create-stale-head',
      title: 'Stale proposal',
      targetRef: 'refs/heads/main',
      baseCommitId: BASE_COMMIT_ID,
      agentRunId: 'agent-run-1',
      agent: AGENT,
      redactionPolicy: REDACTION_POLICY,
    } as any);

    expect(result).toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.createProposal',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PROPOSAL_STALE_HEAD',
            message: 'Proposal baseCommitId must match the current target ref head.',
            data: expect.objectContaining({
              recoverability: 'retry',
              payload: expect.objectContaining({
                operation: 'createProposal',
                expectedTargetHeadId: BASE_COMMIT_ID,
                actualTargetHeadId: HEAD_COMMIT_ID,
              }),
            }),
          }),
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('not-public');
    expect(proposalService.createProposal).toHaveBeenCalledTimes(1);
  });
}
