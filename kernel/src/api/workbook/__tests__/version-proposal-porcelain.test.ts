import { jest } from '@jest/globals';

import { createReviewRecord } from './version-review-test-utils';
import {
  ACTOR,
  AGENT,
  BASE_COMMIT_ID,
  HEAD_COMMIT_ID,
  PROPOSAL_ID,
  REDACTION_POLICY,
  createCompleteProposalService,
  createProposalRecord,
  createProposalRuntimeVersion,
} from './version-proposal-runtime-test-utils';

const TARGET_REF_REVISION = { kind: 'counter', value: '7' } as const;

describe('WorkbookVersion proposal porcelain', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates proposal handles with trusted defaults', async () => {
    const proposalService = createCompleteProposalService({
      createProposal: jest.fn(async (input: any) =>
        createProposalRecord({
          title: input.title,
          targetRef: input.targetRef,
          agentRunId: input.agentRunId,
          agent: input.agent,
        }),
      ),
    });
    const version = createProposalRuntimeVersion({
      versioning: { proposalService },
    });

    const result = await version.proposals.create({
      title: 'Clean forecast formulas',
      into: 'analysis' as any,
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        id: PROPOSAL_ID,
        status: 'draft',
        proposal: {
          title: 'Clean forecast formulas',
          targetRef: 'refs/heads/analysis',
        },
      },
    });
    const input = (proposalService.createProposal as jest.Mock).mock.calls[0][0] as any;
    expect(input).toMatchObject({
      title: 'Clean forecast formulas',
      targetRef: 'refs/heads/analysis',
      redactionPolicy: REDACTION_POLICY,
      agent: {
        kind: 'agent',
        trust: 'trusted',
        principalId: 'user-1',
        displayName: 'user-1',
      },
    });
    expect(input.clientRequestId).toEqual(expect.stringMatching(/^proposal-create:/));
    expect(input.agentRunId).toEqual(expect.stringMatching(/^agent-run:proposal-create:/));
    expect(input.agent.agentRunId).toBe(input.agentRunId);
  });

  it('opens, commits, and disposes proposal workspaces from a handle', async () => {
    const workbookSession = { id: 'proposal-workbook-session' };
    const workspace = {
      workspaceId: 'workspace-1',
      proposalId: PROPOSAL_ID,
      proposalBranchName: 'agent/agent-run-1/proposal-one',
      baseCommitId: BASE_COMMIT_ID,
      targetRef: 'refs/heads/main',
      targetHeadIdAtCreation: HEAD_COMMIT_ID,
      targetRefRevisionAtCreation: TARGET_REF_REVISION,
      providerIdentity: 'provider-1',
      workbookSessionId: 'session-proposal-1',
      getWorkbook: () => workbookSession,
    };
    const proposalService = createCompleteProposalService({
      getProposal: jest.fn(async () =>
        createProposalRecord({
          revision: 3,
          targetRefRevisionAtCreation: TARGET_REF_REVISION,
        }),
      ),
      startProposalWorkspace: jest.fn(async () => workspace),
      commitProposalWorkspace: jest.fn(async (input: any) =>
        createProposalRecord({
          status: 'committed',
          revision: input.expectedRevision + 1,
          proposalCommitId: HEAD_COMMIT_ID,
        }),
      ),
      disposeProposalWorkspace: jest.fn(async () => ({ disposed: true })),
    });
    const version = createProposalRuntimeVersion({
      versioning: { proposalService },
    });
    const handleResult = await version.proposals.get(PROPOSAL_ID);
    if (!handleResult.ok) throw new Error('expected proposal handle');

    const workspaceResult = await handleResult.value.openWorkspace();
    if (!workspaceResult.ok) throw new Error('expected proposal workspace handle');
    expect(await workspaceResult.value.workbook()).toBe(workbookSession);
    const commitResult = await workspaceResult.value.commit({ message: 'Apply forecast cleanup' });
    const disposeResult = await workspaceResult.value.dispose();

    expect(workspaceResult.value.proposal.id).toBe(PROPOSAL_ID);
    expect(commitResult).toMatchObject({
      ok: true,
      value: { status: 'committed', revision: 5 },
    });
    expect(disposeResult).toEqual({ ok: true, value: { disposed: true } });
    expect(proposalService.startProposalWorkspace).toHaveBeenCalledWith({
      clientRequestId: expect.stringMatching(/^proposal-workspace-open:/),
      proposalId: PROPOSAL_ID,
      expectedRevision: 3,
      expectedTargetHeadId: HEAD_COMMIT_ID,
      expectedTargetRefRevision: TARGET_REF_REVISION,
      actor: expect.objectContaining({
        kind: 'user',
        trust: 'trusted',
        principalId: 'user-1',
      }),
    });
    expect(proposalService.commitProposalWorkspace).toHaveBeenCalledWith({
      clientRequestId: expect.stringMatching(/^proposal-workspace-commit:/),
      proposalId: PROPOSAL_ID,
      workspaceId: 'workspace-1',
      expectedRevision: 4,
      expectedTargetHeadId: HEAD_COMMIT_ID,
      expectedTargetRefRevision: TARGET_REF_REVISION,
      actor: expect.objectContaining({
        kind: 'user',
        trust: 'trusted',
        principalId: 'user-1',
      }),
      message: 'Apply forecast cleanup',
    });
    expect(proposalService.disposeProposalWorkspace).toHaveBeenCalledWith({
      clientRequestId: expect.stringMatching(/^proposal-workspace-dispose:/),
      workspaceId: 'workspace-1',
      expectedTargetHeadId: HEAD_COMMIT_ID,
      expectedTargetRefRevision: TARGET_REF_REVISION,
      actor: expect.objectContaining({
        kind: 'user',
        trust: 'trusted',
        principalId: 'user-1',
      }),
    });
  });

  it('accepts handles with the provider-supported fast-forward policy by default', async () => {
    const acceptResult = {
      status: 'fast_forwarded',
      proposalId: PROPOSAL_ID,
      appliedCommitId: HEAD_COMMIT_ID,
      targetRef: 'refs/heads/main',
      newHeadId: HEAD_COMMIT_ID,
      refUpdateReceiptId: 'receipt-1',
    };
    const proposalService = createCompleteProposalService({
      getProposal: jest.fn(async () => createProposalRecord()),
      acceptProposal: jest.fn(async () => acceptResult),
    });
    const version = createProposalRuntimeVersion({
      versioning: {
        proposalService,
        mergeService: { merge: jest.fn() },
        applyMergeService: { applyMerge: jest.fn() },
      },
    });
    const handleResult = await version.proposals.get(PROPOSAL_ID);
    if (!handleResult.ok) throw new Error('expected proposal handle');

    const result = await handleResult.value.accept();

    expect(result).toEqual({ ok: true, value: acceptResult });
    expect(proposalService.acceptProposal).toHaveBeenCalledWith({
      clientRequestId: expect.stringMatching(/^proposal-accept:/),
      proposalId: PROPOSAL_ID,
      expectedRevision: 1,
      expectedTargetHeadId: HEAD_COMMIT_ID,
      actor: expect.objectContaining({
        kind: 'user',
        trust: 'trusted',
        principalId: 'user-1',
      }),
      resolutionPolicy: 'fastForwardOnly',
    });
  });

  it('wraps verification, review, reject, and supersede operations back into handles', async () => {
    const verification = {
      status: 'passed',
      checks: [
        {
          name: 'unit',
          status: 'passed',
          command: 'pnpm test',
          diagnostics: [],
        },
      ],
      createdAt: '2026-06-22T00:00:00.000Z',
    } as const;
    const proposalService = createCompleteProposalService({
      getProposal: jest.fn(async () => createProposalRecord()),
      markProposalVerified: jest.fn(async () =>
        createProposalRecord({ status: 'verified', verification }),
      ),
      openProposalReview: jest.fn(async () =>
        createReviewRecord({
          id: 'review-proposal-1',
          subject: {
            kind: 'proposal',
            proposalId: PROPOSAL_ID,
            baseCommitId: BASE_COMMIT_ID,
            headCommitId: HEAD_COMMIT_ID,
          },
          proposalId: PROPOSAL_ID,
        }),
      ),
      rejectProposal: jest.fn(async () => createProposalRecord({ status: 'rejected' })),
      supersedeProposal: jest.fn(async () => createProposalRecord({ status: 'superseded' })),
    });
    const version = createProposalRuntimeVersion({
      versioning: { proposalService },
    });
    const handleResult = await version.proposals.get(PROPOSAL_ID);
    if (!handleResult.ok) throw new Error('expected proposal handle');

    const verified = await handleResult.value.markVerified({ verification, actor: ACTOR });
    const review = await handleResult.value.markReadyForReview({ actor: ACTOR });
    const rejected = await handleResult.value.reject({ actor: ACTOR, reason: 'Needs revision' });
    const superseded = await handleResult.value.supersede({
      actor: ACTOR,
      supersededByProposalId: `proposal:sha256:${'b'.repeat(64)}`,
      reason: 'Replaced by newer run',
    });

    expect(verified).toMatchObject({ ok: true, value: { status: 'verified' } });
    expect(review).toMatchObject({ ok: true, value: { id: 'review-proposal-1' } });
    expect(rejected).toMatchObject({ ok: true, value: { status: 'rejected' } });
    expect(superseded).toMatchObject({ ok: true, value: { status: 'superseded' } });
    expect(proposalService.markProposalVerified).toHaveBeenCalledWith({
      clientRequestId: expect.stringMatching(/^proposal-verify:/),
      proposalId: PROPOSAL_ID,
      expectedRevision: 1,
      verification,
      actor: ACTOR,
    });
    expect(proposalService.openProposalReview).toHaveBeenCalledWith({
      clientRequestId: expect.stringMatching(/^proposal-review-open:/),
      proposalId: PROPOSAL_ID,
      expectedRevision: 1,
      actor: ACTOR,
    });
    expect(proposalService.rejectProposal).toHaveBeenCalledWith({
      clientRequestId: expect.stringMatching(/^proposal-reject:/),
      proposalId: PROPOSAL_ID,
      expectedRevision: 1,
      actor: ACTOR,
      reason: 'Needs revision',
    });
    expect(proposalService.supersedeProposal).toHaveBeenCalledWith({
      clientRequestId: expect.stringMatching(/^proposal-supersede:/),
      proposalId: PROPOSAL_ID,
      expectedRevision: 1,
      actor: ACTOR,
      supersededByProposalId: `proposal:sha256:${'b'.repeat(64)}`,
      reason: 'Replaced by newer run',
    });
  });

  it('keeps advanced methods as exact low-level delegates', async () => {
    const proposalService = createCompleteProposalService();
    const version = createProposalRuntimeVersion({
      versioning: { proposalService },
    });
    const input = {
      clientRequestId: 'create-advanced',
      title: 'Advanced proposal',
      targetRef: 'refs/heads/main',
      baseCommitId: BASE_COMMIT_ID,
      agentRunId: 'agent-run-advanced',
      agent: AGENT,
      proposalBranchNameHint: 'agent/agent-run-advanced/proposal',
      redactionPolicy: REDACTION_POLICY,
    };

    const result = await version.proposals.advanced.createProposal(input as any);

    expect(result).toMatchObject({ ok: true, value: { id: PROPOSAL_ID } });
    expect(proposalService.createProposal).toHaveBeenCalledWith(input);
  });

  it('fails closed instead of fabricating a default author from untrusted scope', async () => {
    const proposalService = createCompleteProposalService();
    const version = createProposalRuntimeVersion({
      workbookLinkScope: () => ({
        requestingDocumentId: 'document-1',
        requestingSessionId: 'session-1',
        actor: 'user-1',
        principal: { tags: ['team:finance'] },
      }),
      versioning: { proposalService },
    });

    const result = await version.proposals.create({ title: 'Denied default author' });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.proposals.advanced.createProposal',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PERMISSION_DENIED',
            message: 'agent is not authorized for proposal createProposal.',
          }),
        ],
      },
    });
    expect(proposalService.createProposal).not.toHaveBeenCalled();
  });
});
