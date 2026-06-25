import { expect, it } from '@jest/globals';

import {
  ACTOR,
  createProposalInput,
  versionForProvider,
} from './version-proposal-provider-fixtures';
import { commitMain, graphWithRoot } from './version-proposal-provider-graph-fixtures';
import { graphCommittingWorkspaceService } from './version-proposal-provider-workspace-fixtures';

export function registerProposalProviderCreationScenarios(): void {
  it('auto-attaches provider-backed proposal metadata without advertising workspace lifecycle', async () => {
    const graph = await graphWithRoot();
    const version = versionForProvider(graph.provider);

    const created = await version.createProposal(createProposalInput('proposal-create-1'));
    expect(created).toMatchObject({
      ok: true,
      value: {
        status: 'draft',
        revision: 1,
        targetRef: 'refs/heads/main',
        baseCommitId: graph.rootCommitId,
        targetHeadIdAtCreation: graph.rootCommitId,
        targetRefRevisionAtCreation: { kind: 'counter', value: '0' },
        proposalBranchName: expect.stringMatching(/^agent\/agent-run-1\//),
      },
    });
    if (!created.ok) throw new Error(`expected proposal create success: ${created.error.code}`);

    await expect(version.getProposal({ proposalId: created.value.id })).resolves.toMatchObject({
      ok: true,
      value: { id: created.value.id, status: 'draft' },
    });
    await expect(version.listProposals({ targetRef: 'refs/heads/main' })).resolves.toMatchObject({
      ok: true,
      value: { items: [{ id: created.value.id }], totalEstimate: 1 },
    });
    await expect(version.getRef(created.value.proposalBranchName)).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: {
          name: `refs/heads/${created.value.proposalBranchName}`,
          commitId: graph.rootCommitId,
        },
      },
    });
    await expect(
      version.startProposalWorkspace({
        clientRequestId: 'workspace-open-unavailable',
        proposalId: created.value.id,
        expectedRevision: 1,
        actor: ACTOR,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.startProposalWorkspace',
        diagnostics: [expect.objectContaining({ code: 'VERSION_PROPOSAL_WORKSPACE_UNAVAILABLE' })],
      },
    });

    const surface = await version.getSurfaceStatus();
    expect(surface.capabilities['version:proposal']).toMatchObject({
      enabled: false,
      dependency: 'VC-05',
    });
  });

  it('rejects proposal creation when an explicit base is not the target head', async () => {
    const graph = await graphWithRoot();
    const version = versionForProvider(graph.provider);
    const movedMainCommitId = await commitMain(graph.provider, graph.rootCommitId);

    await expect(
      version.createProposal({
        ...createProposalInput('proposal-create-stale-base'),
        baseCommitId: graph.rootCommitId,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'invalid_state',
        state: 'proposal_base_mismatch',
        allowed: ['current_target_head'],
      },
    });
    await expect(version.listProposals({ targetRef: 'refs/heads/main' })).resolves.toMatchObject({
      ok: true,
      value: { items: [], totalEstimate: 0 },
    });
    await expect(version.readRef('refs/heads/main')).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: { commitId: movedMainCommitId },
      },
    });
  });

  it('rejects workspace start after the proposal target advances', async () => {
    const graph = await graphWithRoot();
    const version = versionForProvider(graph.provider, {
      proposalWorkspaceService: graphCommittingWorkspaceService(graph.provider),
    });
    const created = await version.createProposal(
      createProposalInput('proposal-create-before-target-move'),
    );
    if (!created.ok) throw new Error(`expected proposal create success: ${created.error.code}`);
    const movedMainCommitId = await commitMain(graph.provider, graph.rootCommitId);

    await expect(
      version.startProposalWorkspace({
        clientRequestId: 'workspace-open-after-target-move',
        proposalId: created.value.id,
        expectedRevision: 1,
        expectedTargetHeadId: created.value.targetHeadIdAtCreation,
        expectedTargetRefRevision: created.value.targetRefRevisionAtCreation,
        actor: ACTOR,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.startProposalWorkspace',
        diagnostics: [
          expect.objectContaining({
            code: 'stale_proposal_target_head',
            data: expect.objectContaining({
              proposalId: created.value.id,
              expectedTargetHeadId: graph.rootCommitId,
              actualTargetHeadId: movedMainCommitId,
            }),
          }),
        ],
      },
    });
    await expect(version.getProposal({ proposalId: created.value.id })).resolves.toMatchObject({
      ok: true,
      value: { status: 'draft', revision: 1 },
    });
  });
}
