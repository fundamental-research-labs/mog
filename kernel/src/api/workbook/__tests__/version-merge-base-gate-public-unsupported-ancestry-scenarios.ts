import { expect, it } from '@jest/globals';

import {
  createCommit,
  expectPublicSafeMergeFailure,
  graphWithRoot,
  mergeServiceMustNotRun,
  publicWorkbookVersion,
} from './version-merge-base-gate-test-utils';

export function registerPublicMergeBaseGateUnsupportedAncestryScenarios() {
  it('blocks divergent non-direct ancestry before invoking the merge service', async () => {
    const graph = await graphWithRoot('graph-public-divergent-non-direct-ancestry');
    const base = await createCommit(graph, {
      label: 'base',
      parentCommitIds: [graph.rootCommitId],
    });
    const intermediate = await createCommit(graph, {
      label: 'ours-intermediate',
      parentCommitIds: [base],
    });
    const ours = await createCommit(graph, {
      label: 'ours-grandchild',
      parentCommitIds: [intermediate],
    });
    const theirs = await createCommit(graph, {
      label: 'theirs-direct-child',
      parentCommitIds: [base],
    });
    const merge = mergeServiceMustNotRun();
    const version = publicWorkbookVersion(graph.provider, merge);

    const result = await version.merge({ base, ours, theirs });

    expectPublicSafeMergeFailure(result, 'VERSION_MERGE_UNSUPPORTED_ANCESTRY', {
      mergeRef: 'redacted',
      parentCount: 1,
      parentMatchesBase: false,
    });
    expect(merge).not.toHaveBeenCalled();
  });
}
