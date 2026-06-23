import { expect, it, jest } from '@jest/globals';

import {
  PROPOSAL_ID,
  createCompleteProposalService,
  createProposalRuntimeVersion,
} from './version-proposal-runtime-test-utils';

export function registerProposalRuntimeDiagnosticsAccessScenarios(): void {
  it('redacts denied principals from proposal access diagnostics', async () => {
    const proposalService = createCompleteProposalService({
      getProposal: jest.fn(async () => ({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.getProposal',
          diagnostics: [
            {
              code: 'VERSION_PROPOSAL_ACCESS_DENIED',
              severity: 'error',
              message: 'Proposal read denied for principal-secret.',
              data: {
                deniedPrincipalId: 'principal-secret',
                payload: {
                  deniedCapabilities: ['version:proposal'],
                  deniedPrincipal: 'principal-secret',
                  principalScope: 'principal-secret',
                },
              },
            },
          ],
        },
      })),
    });
    const version = createProposalRuntimeVersion({
      versioning: { proposalService },
    });

    const result = await version.getProposal({ proposalId: PROPOSAL_ID } as any);

    expect(result).toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PROPOSAL_ACCESS_DENIED',
            message: 'Proposal read denied for redacted-principal.',
            data: expect.objectContaining({
              payload: expect.objectContaining({
                deniedCapabilities: ['version:proposal'],
              }),
            }),
          }),
        ],
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('principal-secret');
    expect(serialized).not.toContain('deniedPrincipal');
    expect(serialized).toContain('version:proposal');
  });

  it('preserves public proposal ids while sanitizing proposal diagnostic identifiers and branch names', async () => {
    const unsafeProposalBranchName = 'agent/agent-run-1/proposal-one';
    const safeProposalBranchName = 'agent/redacted-principal/proposal-one';
    const proposalService = createCompleteProposalService({
      getProposal: jest.fn(async () => ({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.getProposal',
          diagnostics: [
            {
              code: 'VERSION_PROPOSAL_ACCESS_DENIED',
              severity: 'error',
              message: `Proposal ${PROPOSAL_ID} on ${unsafeProposalBranchName} denied for principal-secret and user-secret.`,
              data: {
                proposalId: PROPOSAL_ID,
                relatedProposalId: 'proposal:sha256:not-public',
                proposalIds: [PROPOSAL_ID, 'proposal:sha256:not-public'],
                principalId: 'principal-secret',
                agentRunId: 'agent-run-1',
                agentId: 'agent-secret',
                userId: 'user-secret',
                userEmail: 'user-secret@example.invalid',
                agent: { agentRunId: 'agent-run-1', displayName: 'Agent Secret' },
                user: { id: 'user-secret', email: 'user-secret@example.invalid' },
                payload: {
                  proposalId: PROPOSAL_ID,
                  proposalBranchName: unsafeProposalBranchName,
                  branchRef: `refs/heads/${unsafeProposalBranchName}`,
                  actors: [{ actorId: 'actor-secret', proposalId: PROPOSAL_ID }],
                },
              },
              proposalId: PROPOSAL_ID,
              invalidProposalId: 'proposal:sha256:not-public',
              proposalBranchName: unsafeProposalBranchName,
              agentRunId: 'agent-run-1',
            },
          ],
        },
      })),
    });
    const version = createProposalRuntimeVersion({
      versioning: { proposalService },
    });

    const result = await version.getProposal({ proposalId: PROPOSAL_ID } as any);

    expect(result).toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PROPOSAL_ACCESS_DENIED',
            message: `Proposal ${PROPOSAL_ID} on ${safeProposalBranchName} denied for redacted-principal and redacted-principal.`,
            proposalId: PROPOSAL_ID,
            proposalBranchName: safeProposalBranchName,
            data: expect.objectContaining({
              proposalId: PROPOSAL_ID,
              proposalIds: [PROPOSAL_ID],
              payload: expect.objectContaining({
                proposalId: PROPOSAL_ID,
                proposalBranchName: safeProposalBranchName,
                branchRef: `refs/heads/${safeProposalBranchName}`,
                actors: [expect.objectContaining({ proposalId: PROPOSAL_ID })],
              }),
            }),
          }),
        ],
      },
    });
    if (result.ok) throw new Error('expected proposal access failure');
    const diagnostic = result.error.diagnostics[0] as any;
    expect(diagnostic).not.toHaveProperty('agentRunId');
    expect(diagnostic).not.toHaveProperty('invalidProposalId');
    expect(diagnostic.data).not.toHaveProperty('relatedProposalId');
    expect(diagnostic.data).not.toHaveProperty('principalId');
    expect(diagnostic.data).not.toHaveProperty('agentRunId');
    expect(diagnostic.data).not.toHaveProperty('agentId');
    expect(diagnostic.data).not.toHaveProperty('userId');
    expect(diagnostic.data).not.toHaveProperty('userEmail');
    expect(diagnostic.data).not.toHaveProperty('agent');
    expect(diagnostic.data).not.toHaveProperty('user');
    expect(diagnostic.data.payload.actors[0]).not.toHaveProperty('actorId');
    const serialized = JSON.stringify(result);
    expect(serialized).toContain(PROPOSAL_ID);
    expect(serialized).toContain(safeProposalBranchName);
    expect(serialized).not.toContain('agent-run-1');
    expect(serialized).not.toContain('principal-secret');
    expect(serialized).not.toContain('agent-secret');
    expect(serialized).not.toContain('user-secret');
    expect(serialized).not.toContain('actor-secret');
    expect(serialized).not.toContain('not-public');
  });
}
