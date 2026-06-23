import { expect, it, jest } from '@jest/globals';

import {
  acceptInput,
  createCompleteProposalService,
  createProposalRuntimeVersion,
  storeDiagnostic,
  targetUnavailable,
} from './version-proposal-runtime-test-utils';

export function registerProposalRuntimeDiagnosticsServiceAcceptScenarios(): void {
  it('normalizes unsupported-domain accept diagnostics returned by proposal services', async () => {
    const proposalService = createCompleteProposalService({
      acceptProposal: jest.fn(async () =>
        targetUnavailable('acceptProposal', [
          storeDiagnostic(
            'VERSION_MERGE_UNSUPPORTED_DOMAIN',
            'Proposal acceptance is blocked by an unsupported authored domain.',
            {
              operation: 'acceptProposal',
              domain: 'pivot.cache',
              principalId: 'principal-secret',
            },
            { recoverability: 'unsupported' },
          ),
        ]),
      ),
    });
    const version = createProposalRuntimeVersion({
      versioning: {
        proposalService,
        mergeService: { merge: jest.fn() },
        applyMergeService: { applyMerge: jest.fn() },
      },
    });

    const result = await version.acceptProposal(acceptInput('accept-unsupported-domain') as any);

    expect(result).toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.acceptProposal',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_MERGE_UNSUPPORTED_DOMAIN',
            message: 'Proposal acceptance is blocked by an unsupported authored domain.',
            data: expect.objectContaining({
              recoverability: 'unsupported',
              payload: expect.objectContaining({
                operation: 'acceptProposal',
                domain: 'pivot.cache',
              }),
            }),
          }),
        ],
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('principal-secret');
    expect(serialized).not.toContain('issueCode');
    expect(proposalService.acceptProposal).toHaveBeenCalledTimes(1);
  });
}
