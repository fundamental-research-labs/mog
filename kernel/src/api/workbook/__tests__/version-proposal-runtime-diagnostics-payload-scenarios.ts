import { expect, it, jest } from '@jest/globals';

import {
  BASE_COMMIT_ID,
  HEAD_COMMIT_ID,
  PROPOSAL_ID,
  createCompleteProposalService,
  createProposalRecord,
  createProposalRuntimeVersion,
} from './version-proposal-runtime-test-utils';

export function registerProposalRuntimeDiagnosticsPayloadScenarios(): void {
  it('redacts stale proposal diagnostics in successful access payloads', async () => {
    const proposal = createProposalRecord({
      status: 'stale',
      diagnostics: [
        {
          code: 'VERSION_PROPOSAL_STALE',
          severity: 'warning',
          message: 'Proposal stale for principal-secret.',
          data: {
            principalId: 'principal-secret',
            payload: {
              expectedTargetHeadId: BASE_COMMIT_ID,
              actualTargetHeadId: HEAD_COMMIT_ID,
              principalScope: 'principal-secret',
            },
          },
        },
      ],
    });
    const proposalService = createCompleteProposalService({
      getProposal: jest.fn(async () => ({ ok: true, value: proposal })),
    });
    const version = createProposalRuntimeVersion({
      versioning: { proposalService },
    });

    const result = await version.getProposal({ proposalId: PROPOSAL_ID } as any);

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'stale',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PROPOSAL_STALE',
            message: 'Proposal stale for redacted-principal.',
            data: expect.objectContaining({
              payload: expect.objectContaining({
                expectedTargetHeadId: BASE_COMMIT_ID,
                actualTargetHeadId: HEAD_COMMIT_ID,
              }),
            }),
          }),
        ],
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('principal-secret');
    expect(serialized).toContain('VERSION_PROPOSAL_STALE');
  });
}
