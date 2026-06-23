import { jest } from '@jest/globals';

import {
  ACTOR,
  AGENT,
  REDACTION_POLICY,
  acceptInput,
  createCompleteProposalService,
  createProposalRuntimeVersion,
} from './version-proposal-runtime-test-utils';

describe('WorkbookVersion proposal runtime guardrails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects malformed proposal ids before proposal service dispatch', async () => {
    const proposalService = createCompleteProposalService();
    const version = createProposalRuntimeVersion({
      versioning: { proposalService },
    });

    const result = await version.acceptProposal({
      ...acceptInput('accept-malformed-proposal-id'),
      proposalId: 'proposal:sha256:not-a-digest',
    } as any);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.acceptProposal',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_PROPOSAL_ID',
            message: 'proposalId must be a public proposal id.',
            data: expect.objectContaining({
              payload: expect.objectContaining({
                operation: 'acceptProposal',
                option: 'proposalId',
              }),
              mutationGuarantee: 'no-write-attempted',
            }),
          }),
        ],
      },
    });
    expect(proposalService.acceptProposal).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('not-a-digest');
  });

  it('rejects untrusted proposal agents and actors before dispatch', async () => {
    const proposalService = createCompleteProposalService();
    const version = createProposalRuntimeVersion({
      versioning: { proposalService },
    });

    const createResult = await version.createProposal({
      clientRequestId: 'create-untrusted-agent',
      title: 'Denied proposal',
      targetRef: 'refs/heads/main',
      agentRunId: 'agent-run-1',
      agent: { ...AGENT, trust: 'unknown', principalId: 'agent-secret' },
      redactionPolicy: REDACTION_POLICY,
    } as any);
    const acceptResult = await version.acceptProposal({
      ...acceptInput('accept-untrusted-actor'),
      actor: { ...ACTOR, trust: 'unknown', principalId: 'actor-secret' },
    } as any);

    expect(createResult).toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PERMISSION_DENIED',
            message: 'agent is not authorized for proposal createProposal.',
            data: expect.objectContaining({
              payload: expect.objectContaining({
                operation: 'createProposal',
                option: 'agent',
                reason: 'unauthorizedActor',
              }),
            }),
          }),
        ],
      },
    });
    expect(acceptResult).toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PERMISSION_DENIED',
            message: 'actor is not authorized for proposal acceptProposal.',
            data: expect.objectContaining({
              payload: expect.objectContaining({
                operation: 'acceptProposal',
                option: 'actor',
                reason: 'unauthorizedActor',
              }),
            }),
          }),
        ],
      },
    });
    expect(proposalService.createProposal).not.toHaveBeenCalled();
    expect(proposalService.acceptProposal).not.toHaveBeenCalled();
    const serialized = JSON.stringify([createResult, acceptResult]);
    expect(serialized).not.toContain('agent-secret');
    expect(serialized).not.toContain('actor-secret');
  });

  it('returns capability errors before dispatch when host policy denies proposal access', async () => {
    const proposalService = createCompleteProposalService();
    const version = createProposalRuntimeVersion({
      hostPolicy: {
        decisions: [{ capability: 'version:proposal', decision: 'denied' }],
      },
      versioning: { proposalService },
    });

    const result = await version.createProposal({
      clientRequestId: 'create-denied',
      title: 'Denied proposal',
      targetRef: 'refs/heads/main',
      agentRunId: 'agent-run-1',
      agent: AGENT,
      redactionPolicy: REDACTION_POLICY,
    } as any);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'version_capability_unavailable',
        capability: 'version:proposal',
        dependency: 'hostCapability',
      },
    });
    expect(proposalService.createProposal).not.toHaveBeenCalled();
  });
});
