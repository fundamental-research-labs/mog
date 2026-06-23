import { expect, it } from '@jest/globals';

import {
  ACTOR,
  commitRef,
  createProposalInput,
  createReadyReviewedProposal,
  graphWithRoot,
  misbasedLookupService,
  misboundLookupService,
  missingLinkedReviewService,
  openProposalWorkspace,
  staleHeadCheckingWorkspaceService,
  unsafeStartDiagnosticWorkspaceService,
  versionForProvider,
  workspaceLookupService,
} from './version-proposal-workspace-provider-fixtures';

export function registerProposalWorkspaceLookupScenarios(): void {
  it('validates proposal workspace lookup handles before returning them', async () => {
    const graph = await graphWithRoot();
    const workspaceService = workspaceLookupService();
    const version = versionForProvider(graph.provider, workspaceService);
    const opened = await openProposalWorkspace(version, 'workspace-get');

    await expect(
      version.getProposalWorkspace({ workspaceId: opened.workspaceId }),
    ).resolves.toEqual({
      ok: true,
      value: opened,
    });
    await expect(
      version.getProposalWorkspace({ workspaceId: 'workspace:missing' }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'not_found', target: 'workbook.version.proposal' },
    });
  });

  it('rejects proposal workspace lookup handles that do not match stored metadata', async () => {
    const graph = await graphWithRoot();
    const workspaceService = misboundLookupService();
    const version = versionForProvider(graph.provider, workspaceService);
    const opened = await openProposalWorkspace(version, 'misbound-get');

    await expect(
      version.getProposalWorkspace({ workspaceId: opened.workspaceId }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'invalid_state',
        state: 'proposal_workspace_branch_mismatch',
        allowed: ['matching_proposal_workspace'],
      },
    });
  });

  it('rejects proposal workspace lookup handles with a mismatched base commit binding', async () => {
    const graph = await graphWithRoot();
    const workspaceService = misbasedLookupService();
    const version = versionForProvider(graph.provider, workspaceService);
    const opened = await openProposalWorkspace(version, 'misbased-get');

    await expect(
      version.getProposalWorkspace({ workspaceId: opened.workspaceId }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'invalid_state',
        state: 'proposal_workspace_base_mismatch',
        allowed: ['matching_proposal_workspace'],
      },
    });
  });

  it('validates workspace bindings before disposal', async () => {
    const graph = await graphWithRoot();
    const workspaceService = workspaceLookupService();
    const version = versionForProvider(graph.provider, workspaceService);
    const opened = await openProposalWorkspace(version, 'workspace-dispose');

    await expect(
      version.disposeProposalWorkspace({
        clientRequestId: 'workspace-dispose-missing',
        workspaceId: 'workspace:missing',
        actor: ACTOR,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'not_found', target: 'workbook.version.proposal' },
    });
    await expect(
      version.disposeProposalWorkspace({
        clientRequestId: 'workspace-dispose-ok',
        workspaceId: opened.workspaceId,
        actor: ACTOR,
      }),
    ).resolves.toEqual({ ok: true, value: { disposed: true } });
  });
}

export function registerProposalWorkspaceCommitScenarios(): void {
  it('fails closed when a proposal workspace commit observes a stale branch head', async () => {
    const graph = await graphWithRoot();
    const workspaceService = staleHeadCheckingWorkspaceService(graph.provider);
    const version = versionForProvider(graph.provider, workspaceService);
    const opened = await openProposalWorkspace(version, 'workspace-stale-head');
    const movedProposalBranchHeadId = await commitRef(
      graph.provider,
      `refs/heads/${opened.proposalBranchName}`,
      graph.rootCommitId,
    );
    const safeProposalBranchName = opened.proposalBranchName.replace(
      'agent-run-1',
      'redacted-principal',
    );

    const committed = await version.commitProposalWorkspace({
      clientRequestId: 'workspace-commit-stale-head',
      proposalId: opened.proposalId,
      workspaceId: opened.workspaceId,
      expectedRevision: 2,
      actor: ACTOR,
      message: 'Stale workspace commit',
    });
    expect(committed).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.commitProposalWorkspace',
        diagnostics: [
          expect.objectContaining({
            code: 'stale_proposal_workspace_head',
            data: expect.objectContaining({
              proposalId: opened.proposalId,
              proposalBranchName: safeProposalBranchName,
              expectedWorkspaceHeadId: graph.rootCommitId,
              actualProposalBranchHeadId: movedProposalBranchHeadId,
            }),
          }),
        ],
      },
    });
    if (committed.ok) throw new Error('expected stale workspace commit to fail');
    expect(committed.error.diagnostics[0]?.data).not.toHaveProperty('workspaceId');
    expect(JSON.stringify(committed)).not.toContain('agent-run-1');
    expect(JSON.stringify(committed)).not.toContain(opened.workspaceId);
    await expect(version.getProposal({ proposalId: opened.proposalId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'workspace_open', revision: 2 },
    });
  });
}

export function registerProposalWorkspaceDiagnosticScenarios(): void {
  it('redacts unsafe provider workspace diagnostics before returning public failures', async () => {
    const graph = await graphWithRoot();
    const workspaceService = unsafeStartDiagnosticWorkspaceService();
    const version = versionForProvider(graph.provider, workspaceService);
    const created = await version.createProposal(
      createProposalInput('proposal-create-unsafe-diagnostics'),
    );
    if (!created.ok) throw new Error(`expected proposal create success: ${created.error.code}`);

    const opened = await version.startProposalWorkspace({
      clientRequestId: 'workspace-open-unsafe-diagnostics',
      proposalId: created.value.id,
      expectedRevision: 1,
      actor: ACTOR,
    });

    expect(opened).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.startProposalWorkspace',
        diagnostics: [
          expect.objectContaining({
            code: 'TEST_UNSAFE_WORKSPACE_DIAGNOSTIC',
            message: 'Workspace denied redacted-principal for redacted-principal.',
            data: expect.objectContaining({
              safeNote: 'redacted-principal',
              safeTokens: ['redacted-principal', 'redacted-principal'],
              nested: expect.objectContaining({
                safeStatus: 'kept',
                safeNote: 'redacted-principal',
              }),
            }),
          }),
        ],
      },
    });
    if (opened.ok) throw new Error('expected workspace start to fail');
    const diagnostic = opened.error.diagnostics[0] as any;
    expect(diagnostic.data).not.toHaveProperty('principalId');
    expect(diagnostic.data).not.toHaveProperty('agentRunId');
    expect(diagnostic.data).not.toHaveProperty('safeWorkspaceId');
    expect(diagnostic.data).not.toHaveProperty('workspaceId');
    expect(diagnostic.data).not.toHaveProperty('providerId');
    expect(diagnostic.data).not.toHaveProperty('providerIdentity');
    expect(diagnostic.data).not.toHaveProperty('workspace');
    expect(diagnostic.data.nested).not.toHaveProperty('actorId');
    const serialized = JSON.stringify(opened);
    expect(serialized).not.toContain('principal-secret');
    expect(serialized).not.toContain('agent-run-1');
    expect(serialized).not.toContain('actor-secret');
    expect(serialized).not.toContain('workspace:redaction');
    expect(serialized).not.toContain('workspace-secret');
    expect(serialized).not.toContain('provider-secret');
    expect(serialized).not.toContain('principalId');
    expect(serialized).not.toContain('agentRunId');
    expect(serialized).not.toContain('providerId');
    await expect(version.getProposal({ proposalId: created.value.id })).resolves.toMatchObject({
      ok: true,
      value: { status: 'draft', revision: 1 },
    });
  });
}

export function registerProposalWorkspaceAcceptanceScenarios(): void {
  it('rejects proposal acceptance when the linked review record is missing', async () => {
    const graph = await graphWithRoot();
    const version = versionForProvider(
      graph.provider,
      staleHeadCheckingWorkspaceService(graph.provider),
      { reviewService: missingLinkedReviewService() as any },
    );
    const ready = await createReadyReviewedProposal(version, graph, 'missing-review', false);

    await expect(
      version.acceptProposal({
        clientRequestId: 'proposal-accept-missing-review',
        proposalId: ready.proposalId,
        expectedRevision: 5,
        expectedTargetHeadId: graph.rootCommitId,
        actor: ACTOR,
        resolutionPolicy: 'fastForwardOnly',
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'not_found',
        target: 'workbook.version.review',
        reason: expect.stringContaining(ready.reviewId),
      },
    });
    await expect(version.getProposal({ proposalId: ready.proposalId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'ready_for_review', revision: 5, reviewId: ready.reviewId },
    });
    await expect(version.readRef('refs/heads/main')).resolves.toMatchObject({
      ok: true,
      value: { status: 'success', ref: { commitId: graph.rootCommitId } },
    });
  });

  it('persists public diagnostics when the target head moves before acceptance', async () => {
    const graph = await graphWithRoot();
    const version = versionForProvider(
      graph.provider,
      staleHeadCheckingWorkspaceService(graph.provider),
    );
    const ready = await createReadyReviewedProposal(version, graph, 'stale-target');
    const movedMainCommitId = await commitRef(
      graph.provider,
      'refs/heads/main',
      graph.rootCommitId,
    );

    await expect(
      version.acceptProposal({
        clientRequestId: 'proposal-accept-stale-target',
        proposalId: ready.proposalId,
        expectedRevision: 5,
        expectedTargetHeadId: graph.rootCommitId,
        actor: ACTOR,
        resolutionPolicy: 'fastForwardOnly',
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'stale',
        proposalId: ready.proposalId,
        expectedTargetHeadId: graph.rootCommitId,
        actualTargetHeadId: movedMainCommitId,
      },
    });
    await expect(version.getProposal({ proposalId: ready.proposalId })).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'stale',
        revision: 6,
        diagnostics: [
          expect.objectContaining({
            code: 'stale_head',
            severity: 'warning',
            data: expect.objectContaining({
              expectedTargetHeadId: graph.rootCommitId,
              actualTargetHeadId: movedMainCommitId,
            }),
          }),
        ],
      },
    });
    await expect(version.getReview({ reviewId: ready.reviewId })).resolves.toMatchObject({
      ok: true,
      value: { status: 'approved' },
    });
  });
}
