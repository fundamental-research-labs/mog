import { expect, it, jest } from '@jest/globals';

import {
  ACTOR,
  PROPOSAL_ID,
  createCompleteProposalService,
  createProposalRuntimeVersion,
  storeDiagnostic,
  targetUnavailable,
} from './version-proposal-runtime-test-utils';

export function registerProposalRuntimeDiagnosticsServiceWorkspaceScenarios(): void {
  it('normalizes missing workspace provider diagnostics from proposal services', async () => {
    const proposalService = createCompleteProposalService({
      startProposalWorkspace: jest.fn(async () =>
        targetUnavailable('startProposalWorkspace', [
          storeDiagnostic(
            'VERSION_PROPOSAL_WORKSPACE_UNAVAILABLE',
            'Provider-backed proposal workspace sessions require an attached branch-isolated workspace lifecycle service.',
            {
              operation: 'startProposalWorkspace',
              actorId: 'actor-secret',
            },
            { recoverability: 'unsupported', severity: 'warning' },
          ),
        ]),
      ),
    });
    const version = createProposalRuntimeVersion({
      versioning: { proposalService },
    });

    const result = await version.startProposalWorkspace({
      clientRequestId: 'workspace-missing-provider',
      proposalId: PROPOSAL_ID,
      expectedRevision: 1,
      actor: ACTOR,
    } as any);

    expect(result).toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.startProposalWorkspace',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PROPOSAL_WORKSPACE_UNAVAILABLE',
            severity: 'warning',
            message:
              'Provider-backed proposal workspace sessions require an attached branch-isolated workspace lifecycle service.',
            data: expect.objectContaining({
              recoverability: 'unsupported',
              payload: expect.objectContaining({
                operation: 'startProposalWorkspace',
              }),
            }),
          }),
        ],
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('actor-secret');
    expect(serialized).not.toContain('issueCode');
    expect(proposalService.startProposalWorkspace).toHaveBeenCalledTimes(1);
  });
}
