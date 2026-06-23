import { jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';

const BASE_COMMIT_ID = `commit:sha256:${'1'.repeat(64)}`;
const HEAD_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}`;
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
    id: 'proposal:sha256:abc',
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

    const result = await version.getProposal({ proposalId: 'proposal-1' } as any);

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

    const result = await version.getProposal({ proposalId: 'proposal-1' } as any);

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

    const result = await version.getProposal({ proposalId: 'proposal-1' } as any);

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
      proposalId: 'proposal:sha256:abc',
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
    proposalId: 'proposal:sha256:abc',
    expectedRevision: 1,
    expectedTargetHeadId: BASE_COMMIT_ID,
    actor: ACTOR,
    resolutionPolicy: 'fastForwardOnly',
  };
}
