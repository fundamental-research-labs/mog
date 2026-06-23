import { expect, it } from '@jest/globals';

import {
  createCommit,
  expectPublicSafeMergeFailure,
  graphWithRoot,
  mergeServiceMustNotRun,
  publicWorkbookVersion,
} from './version-merge-base-gate-test-utils';

export function registerPublicMergeBaseGateAmbiguousHistoriesScenarios() {
  it('blocks public multiple-base histories before invoking the merge service', async () => {
    const graph = await graphWithRoot('graph-public-ambiguous-merge-base');
    const baseA = await createCommit(graph, {
      label: 'base-a',
      parentCommitIds: [graph.rootCommitId],
    });
    const baseB = await createCommit(graph, {
      label: 'base-b',
      parentCommitIds: [graph.rootCommitId],
    });
    const ours = await createCommit(graph, {
      label: 'ours-criss-cross',
      parentCommitIds: [baseA, baseB],
    });
    const theirs = await createCommit(graph, {
      label: 'theirs-criss-cross',
      parentCommitIds: [baseB, baseA],
    });
    const merge = mergeServiceMustNotRun();
    const version = publicWorkbookVersion(graph.provider, merge);

    const result = await version.merge({ base: baseA, ours, theirs });

    expectPublicSafeMergeFailure(result, 'VERSION_MERGE_BASE_AMBIGUOUS', {
      diagnosticCode: 'mergeBaseAmbiguous',
      lowestCommonAncestorCount: 2,
    });
    expect(merge).not.toHaveBeenCalled();
  });
}
