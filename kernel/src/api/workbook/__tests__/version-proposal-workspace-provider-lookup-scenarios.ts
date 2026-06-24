import { expect, it } from '@jest/globals';

import {
  ACTOR,
  commitRef,
  graphWithRoot,
  misbasedLookupService,
  misboundLookupService,
  openProposalWorkspace,
  staleHeadCheckingWorkspaceService,
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

  it('blocks stale workspace handles after the proposal target advances', async () => {
    const graph = await graphWithRoot();
    const workspaceService = workspaceLookupService();
    const version = versionForProvider(graph.provider, workspaceService);
    const opened = await openProposalWorkspace(version, 'workspace-target-advanced');
    const movedMainCommitId = await commitRef(
      graph.provider,
      'refs/heads/main',
      graph.rootCommitId,
    );

    await expect(
      version.getProposalWorkspace({
        workspaceId: opened.workspaceId,
        expectedTargetHeadId: opened.targetHeadIdAtCreation,
        expectedTargetRefRevision: opened.targetRefRevisionAtCreation,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.getProposalWorkspace',
        diagnostics: [
          expect.objectContaining({
            code: 'stale_proposal_target_head',
            data: expect.objectContaining({
              proposalId: opened.proposalId,
              expectedTargetHeadId: graph.rootCommitId,
              actualTargetHeadId: movedMainCommitId,
            }),
          }),
        ],
      },
    });

    await expect(
      version.disposeProposalWorkspace({
        clientRequestId: 'workspace-dispose-target-advanced',
        workspaceId: opened.workspaceId,
        expectedTargetHeadId: opened.targetHeadIdAtCreation,
        expectedTargetRefRevision: opened.targetRefRevisionAtCreation,
        actor: ACTOR,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.disposeProposalWorkspace',
        diagnostics: [expect.objectContaining({ code: 'stale_proposal_target_head' })],
      },
    });
  });

  it('rejects stale proposal workspace handles after the workspace commit closes the proposal workspace', async () => {
    const graph = await graphWithRoot();
    const workspaceService = staleHeadCheckingWorkspaceService(graph.provider);
    const version = versionForProvider(graph.provider, workspaceService);
    const opened = await openProposalWorkspace(version, 'workspace-committed-handle');

    const committed = await version.commitProposalWorkspace({
      clientRequestId: 'workspace-commit-before-stale-handle-lookup',
      proposalId: opened.proposalId,
      workspaceId: opened.workspaceId,
      expectedRevision: 2,
      expectedTargetHeadId: opened.targetHeadIdAtCreation,
      expectedTargetRefRevision: opened.targetRefRevisionAtCreation,
      actor: ACTOR,
      message: 'Commit proposal workspace before stale handle lookup',
    });
    expect(committed).toMatchObject({
      ok: true,
      value: { id: opened.proposalId, status: 'committed', revision: 3 },
    });

    await expect(
      version.getProposalWorkspace({
        workspaceId: opened.workspaceId,
        expectedTargetHeadId: opened.targetHeadIdAtCreation,
        expectedTargetRefRevision: opened.targetRefRevisionAtCreation,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'invalid_state',
        state: 'proposal_workspace_not_open',
        allowed: ['workspace_open'],
      },
    });
    await expect(
      version.disposeProposalWorkspace({
        clientRequestId: 'workspace-dispose-after-committed-handle',
        workspaceId: opened.workspaceId,
        expectedTargetHeadId: opened.targetHeadIdAtCreation,
        expectedTargetRefRevision: opened.targetRefRevisionAtCreation,
        actor: ACTOR,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'invalid_state',
        state: 'proposal_workspace_not_open',
        allowed: ['workspace_open'],
      },
    });
  });
}
