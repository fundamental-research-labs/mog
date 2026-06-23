import { expect, it } from '@jest/globals';

import {
  createCommit,
  expectPublicSafeMergeFailure,
  graphWithRoot,
  mergeServiceMustNotRun,
  publicWorkbookVersion,
} from './version-merge-base-gate-test-utils';

export function registerPublicMergeBaseGateUnrelatedHistoriesScenarios() {
  it('blocks public no-base histories before invoking the merge service', async () => {
    const graph = await graphWithRoot('graph-public-no-merge-base');
    const unrelatedRoot = await createCommit(graph, {
      label: 'unrelated-root',
      parentCommitIds: [],
    });
    const ours = await createCommit(graph, {
      label: 'ours-related-to-main-root',
      parentCommitIds: [graph.rootCommitId],
    });
    const theirs = await createCommit(graph, {
      label: 'theirs-related-to-unrelated-root',
      parentCommitIds: [unrelatedRoot],
    });
    const merge = mergeServiceMustNotRun();
    const version = publicWorkbookVersion(graph.provider, merge);

    const result = await version.merge({ base: graph.rootCommitId, ours, theirs });

    expectPublicSafeMergeFailure(result, 'VERSION_MERGE_UNRELATED_HISTORIES', {
      diagnosticCode: 'unrelatedHistories',
    });
    expect(merge).not.toHaveBeenCalled();
  });
}
