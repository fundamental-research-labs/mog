import { expect, it } from '@jest/globals';

import {
  ACTOR,
  commitRef,
  createReadyReviewedProposal,
  graphCommittingWorkspaceService,
  graphWithRoot,
  versionForProvider,
} from './version-proposal-accept-provider-test-utils';

export function registerTargetHeadStaleScenarios(): void {
  it('marks a reviewed proposal stale when the target branch head moved', async () => {
    const graph = await graphWithRoot();
    const version = versionForProvider(
      graph.provider,
      graphCommittingWorkspaceService(graph.provider),
    );
    const ready = await createReadyReviewedProposal(version, graph, 'target-stale');
    const movedMainCommitId = await commitRef(
      graph.provider,
      'refs/heads/main',
      graph.rootCommitId,
    );

    const accepted = await version.acceptProposal({
      clientRequestId: 'proposal-accept-target-stale',
      proposalId: ready.proposalId,
      expectedRevision: 5,
      expectedTargetHeadId: graph.rootCommitId,
      actor: ACTOR,
      resolutionPolicy: 'fastForwardOnly',
    });

    expect(accepted).toMatchObject({
      ok: true,
      value: {
        status: 'stale',
        proposalId: ready.proposalId,
        expectedTargetHeadId: graph.rootCommitId,
        actualTargetHeadId: movedMainCommitId,
      },
    });
    await expect(version.readRef('refs/heads/main')).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: { commitId: movedMainCommitId },
      },
    });
    await expect(version.getProposal({ proposalId: ready.proposalId })).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'stale',
        revision: 6,
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'stale_head',
            data: expect.objectContaining({
              expectedTargetHeadId: graph.rootCommitId,
              actualTargetHeadId: movedMainCommitId,
            }),
          }),
        ]),
      },
    });
  });

  it('replays stale target-head accept retries from durable proposal diagnostics', async () => {
    const graph = await graphWithRoot();
    const version = versionForProvider(
      graph.provider,
      graphCommittingWorkspaceService(graph.provider),
    );
    const ready = await createReadyReviewedProposal(version, graph, 'target-stale-retry');
    const movedMainCommitId = await commitRef(
      graph.provider,
      'refs/heads/main',
      graph.rootCommitId,
    );
    const acceptInput = {
      clientRequestId: 'proposal-accept-target-stale-retry',
      proposalId: ready.proposalId,
      expectedRevision: 5,
      expectedTargetHeadId: graph.rootCommitId,
      actor: ACTOR,
      resolutionPolicy: 'fastForwardOnly',
    } as const;

    const accepted = await version.acceptProposal(acceptInput);
    const retry = await version.acceptProposal(acceptInput);

    expect(retry).toEqual(accepted);
    await expect(version.getProposal({ proposalId: ready.proposalId })).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'stale',
        revision: 6,
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'stale_head',
            data: expect.objectContaining({
              acceptClientRequestId: acceptInput.clientRequestId,
              expectedTargetHeadId: graph.rootCommitId,
              actualTargetHeadId: movedMainCommitId,
            }),
          }),
        ]),
      },
    });
    await expect(version.readRef('refs/heads/main')).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'success',
        ref: { commitId: movedMainCommitId },
      },
    });
  });
}
