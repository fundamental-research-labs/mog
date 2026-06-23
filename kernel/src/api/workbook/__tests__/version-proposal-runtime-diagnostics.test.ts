import { jest } from '@jest/globals';

import {
  ACTOR,
  AGENT,
  BASE_COMMIT_ID,
  HEAD_COMMIT_ID,
  PROPOSAL_ID,
  REDACTION_POLICY,
  acceptInput,
  createCompleteProposalService,
  createProposalRecord,
  createProposalRuntimeVersion,
  storeDiagnostic,
  targetUnavailable,
} from './version-proposal-runtime-test-utils';

describe('WorkbookVersion proposal runtime diagnostics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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
});
