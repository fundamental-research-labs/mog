import { expect, it } from '@jest/globals';

import {
  ACTOR,
  commitRef,
  createReadyReviewedProposal,
  graphCommittingWorkspaceService,
  graphWithRoot,
  versionForProvider,
} from './version-proposal-accept-provider-test-utils';

export function registerTargetHeadCapabilityScenarios(): void {
  it('keeps target-head drift acceptance disabled without merge apply capability', async () => {
    const graph = await graphWithRoot();
    const version = versionForProvider(
      graph.provider,
      graphCommittingWorkspaceService(graph.provider),
      { proposalAcceptMergeApplyCapability: false },
    );
    const ready = await createReadyReviewedProposal(version, graph, 'target-stale-disabled');
    const movedMainCommitId = await commitRef(
      graph.provider,
      'refs/heads/main',
      graph.rootCommitId,
    );

    const accepted = await version.acceptProposal({
      clientRequestId: 'proposal-accept-target-stale-disabled',
      proposalId: ready.proposalId,
      expectedRevision: 5,
      expectedTargetHeadId: graph.rootCommitId,
      actor: ACTOR,
      resolutionPolicy: 'fastForwardOnly',
    });

    expect(accepted).toMatchObject({
      ok: false,
      error: {
        code: 'version_capability_unavailable',
        capability: 'version:mergeApply',
        dependency: 'VC-07',
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
      value: { status: 'ready_for_review', revision: 5 },
    });
  });
}
