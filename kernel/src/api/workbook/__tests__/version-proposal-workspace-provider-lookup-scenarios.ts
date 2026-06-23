import { expect, it } from '@jest/globals';

import {
  ACTOR,
  graphWithRoot,
  misbasedLookupService,
  misboundLookupService,
  openProposalWorkspace,
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
