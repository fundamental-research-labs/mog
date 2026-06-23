import { expect, it, jest } from '@jest/globals';

import {
  ACTOR,
  AGENT,
  BASE_COMMIT_ID,
  HEAD_COMMIT_ID,
  PROPOSAL_ID,
  REDACTION_POLICY,
  acceptInput,
  createCompleteProposalService,
  createProposalRuntimeVersion,
  storeDiagnostic,
  targetUnavailable,
} from './version-proposal-runtime-test-utils';

export function registerProposalRuntimeDiagnosticsServiceScenarios(): void {
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
}
