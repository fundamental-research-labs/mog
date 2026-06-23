import { jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';

const BASE_COMMIT_ID = `commit:sha256:${'1'.repeat(64)}`;
const HEAD_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}`;
const PROPOSAL_ID = `proposal:sha256:${'a'.repeat(64)}`;
const ACTOR = { kind: 'user', trust: 'trusted', displayName: 'Reviewer' } as const;
const AGENT = {
  kind: 'agent',
  trust: 'trusted',
  displayName: 'Agent One',
  agentRunId: 'agent-run-1',
} as const;
const REDACTION_POLICY = {
  mode: 'default',
  redactSecrets: true,
  redactExternalLinks: true,
  redactAgentTrace: true,
} as const;

function createMockCtx(overrides: Record<string, unknown> = {}) {
  return {
    computeBridge: {},
    writeGate: { assertWritable: jest.fn() },
    services: { undo: {} },
    floatingObjectManager: { dispose: jest.fn() },
    workbookLinkScope: () => ({
      requestingDocumentId: 'document-1',
      requestingSessionId: 'session-1',
      actor: 'user-1',
      principal: { tags: ['host:trusted'] },
    }),
    ...overrides,
  } as any;
}

function createProposalRecord(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    id: PROPOSAL_ID,
    documentId: 'document-1',
    title: 'Proposal One',
    targetRef: 'refs/heads/main',
    baseCommitId: BASE_COMMIT_ID,
    targetHeadIdAtCreation: HEAD_COMMIT_ID,
    proposalBranchName: 'agent/agent-run-1/proposal-one',
    status: 'draft',
    revision: 1,
    agentRunId: 'agent-run-1',
    agent: AGENT,
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
    redaction: {
      policy: REDACTION_POLICY,
      redactedFields: [],
      diagnostics: [],
    },
    diagnostics: [],
    ...overrides,
  };
}

function createCompleteProposalService(overrides: Record<string, unknown> = {}) {
  const proposal = createProposalRecord();
  return {
    createProposal: jest.fn(async () => proposal),
    startProposalWorkspace: jest.fn(),
    getProposalWorkspace: jest.fn(),
    disposeProposalWorkspace: jest.fn(),
    commitProposalWorkspace: jest.fn(),
    failProposal: jest.fn(),
    getProposal: jest.fn(),
    listProposals: jest.fn(),
    markProposalVerified: jest.fn(),
    openProposalReview: jest.fn(),
    acceptProposal: jest.fn(),
    rejectProposal: jest.fn(),
    supersedeProposal: jest.fn(),
    ...overrides,
  };
}

describe('WorkbookVersion proposal runtime facade', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('dispatches proposal methods to an attached proposal service', async () => {
    const proposalService = createCompleteProposalService();
    const version = new WorkbookVersionImpl(
      createMockCtx({
        versioning: { proposalService },
      }),
    );
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
    const version = new WorkbookVersionImpl(createMockCtx());

    const result = await version.getProposal({ proposalId: PROPOSAL_ID } as any);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.getProposal',
      },
    });
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
    const version = new WorkbookVersionImpl(
      createMockCtx({
        versioning: { proposalService },
      }),
    );

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
    const version = new WorkbookVersionImpl(
      createMockCtx({
        versioning: { proposalService },
      }),
    );

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
    const version = new WorkbookVersionImpl(
      createMockCtx({
        versioning: { proposalService },
      }),
    );

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

  it('rejects malformed proposal ids before proposal service dispatch', async () => {
    const proposalService = createCompleteProposalService();
    const version = new WorkbookVersionImpl(
      createMockCtx({
        versioning: { proposalService },
      }),
    );

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
    const version = new WorkbookVersionImpl(
      createMockCtx({
        versioning: { proposalService },
      }),
    );

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
    const version = new WorkbookVersionImpl(
      createMockCtx({
        versioning: { proposalService },
      }),
    );

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
    const version = new WorkbookVersionImpl(
      createMockCtx({
        versioning: { proposalService },
      }),
    );

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
    const version = new WorkbookVersionImpl(
      createMockCtx({
        versioning: {
          proposalService,
          mergeService: { merge: jest.fn() },
          applyMergeService: { applyMerge: jest.fn() },
        },
      }),
    );

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

  it('keeps proposal capability disabled for incomplete attached services', async () => {
    const proposalService = {
      createProposal: jest.fn(),
    };
    const version = new WorkbookVersionImpl(
      createMockCtx({
        versioning: { proposalService },
      }),
    );

    const surface = await version.getSurfaceStatus();

    expect(surface.capabilities['version:proposal']).toMatchObject({
      enabled: false,
      dependency: 'VC-05',
      retryable: false,
    });
  });

  it('enables proposal capability for a complete attached proposal service', async () => {
    const version = new WorkbookVersionImpl(
      createMockCtx({
        versioning: { proposalService: createCompleteProposalService() },
      }),
    );

    const surface = await version.getSurfaceStatus();

    expect(surface.capabilities['version:proposal']).toEqual({ enabled: true });
  });

  it('returns capability errors before dispatch when host policy denies proposal access', async () => {
    const proposalService = createCompleteProposalService();
    const version = new WorkbookVersionImpl(
      createMockCtx({
        hostPolicy: {
          decisions: [{ capability: 'version:proposal', decision: 'denied' }],
        },
        versioning: { proposalService },
      }),
    );

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

  it('keeps acceptProposal disabled by default without dynamic merge capabilities', async () => {
    const proposalService = createCompleteProposalService();
    const version = new WorkbookVersionImpl(
      createMockCtx({
        versioning: { proposalService },
      }),
    );

    const result = await version.acceptProposal(acceptInput('accept-default-disabled') as any);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'version_capability_unavailable',
        capability: 'version:mergePreview',
        dependency: 'VC-07',
      },
    });
    expect(proposalService.acceptProposal).not.toHaveBeenCalled();
  });

  it('does not treat generic ref administration as merge apply capability', async () => {
    const proposalService = createCompleteProposalService();
    const fastForwardRef = jest.fn();
    const version = new WorkbookVersionImpl(
      createMockCtx({
        versioning: {
          proposalService,
          mergeService: { merge: jest.fn() },
          refAdmin: { fastForwardRef },
        },
      }),
    );

    const result = await version.acceptProposal(acceptInput('accept-no-ref-admin-leak') as any);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'version_capability_unavailable',
        capability: 'version:mergeApply',
        dependency: 'VC-07',
      },
    });
    expect(proposalService.acceptProposal).not.toHaveBeenCalled();
    expect(fastForwardRef).not.toHaveBeenCalled();
  });

  it('dispatches acceptProposal only when proposal, merge preview, and merge apply are attached', async () => {
    const acceptResult = {
      status: 'stale',
      proposalId: PROPOSAL_ID,
      expectedTargetHeadId: BASE_COMMIT_ID,
      actualTargetHeadId: HEAD_COMMIT_ID,
    };
    const proposalService = createCompleteProposalService({
      acceptProposal: jest.fn(async () => acceptResult),
    });
    const version = new WorkbookVersionImpl(
      createMockCtx({
        versioning: {
          proposalService,
          mergeService: { merge: jest.fn() },
          applyMergeService: { applyMerge: jest.fn() },
        },
      }),
    );
    const input = acceptInput('accept-dispatch');

    const result = await version.acceptProposal(input as any);

    expect(result).toEqual({ ok: true, value: acceptResult });
    expect(proposalService.acceptProposal).toHaveBeenCalledWith(input);
  });
});

function acceptInput(clientRequestId: string) {
  return {
    clientRequestId,
    proposalId: PROPOSAL_ID,
    expectedRevision: 1,
    expectedTargetHeadId: BASE_COMMIT_ID,
    actor: ACTOR,
    resolutionPolicy: 'fastForwardOnly',
  };
}

function targetUnavailable(operation: string, diagnostics: readonly unknown[]) {
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: `workbook.version.${operation}`,
      diagnostics,
    },
  };
}

function storeDiagnostic(
  issueCode: string,
  safeMessage: string,
  payload: Record<string, unknown>,
  options: { readonly recoverability?: string; readonly severity?: string } = {},
) {
  return {
    issueCode,
    severity: options.severity ?? 'error',
    recoverability: options.recoverability ?? 'none',
    messageTemplateId: `version.proposal.${issueCode}`,
    safeMessage,
    payload,
    redacted: true,
    mutationGuarantee: 'no-write-attempted',
  };
}
