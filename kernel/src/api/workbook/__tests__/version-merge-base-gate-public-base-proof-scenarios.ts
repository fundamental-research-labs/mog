import { expect, it } from '@jest/globals';

import {
  createCommit,
  expectPublicSafeMergeFailure,
  graphWithRoot,
  mergeServiceMustNotRun,
  publicWorkbookVersion,
} from './version-merge-base-gate-test-utils';

export function registerPublicMergeBaseGateBaseProofScenarios() {
  it('blocks public ancestry shortcuts without a base proof before invoking the merge service', async () => {
    const graph = await graphWithRoot('graph-public-missing-base-proof');
    const staleBase = await createCommit(graph, {
      label: 'stale-base',
      parentCommitIds: [],
    });
    const ours = await createCommit(graph, {
      label: 'ours-related-to-main-root',
      parentCommitIds: [graph.rootCommitId],
    });
    const merge = mergeServiceMustNotRun();
    const version = publicWorkbookVersion(graph.provider, merge);

    const result = await version.merge({ base: staleBase, ours, theirs: ours });

    expectPublicSafeMergeFailure(result, 'VERSION_MERGE_BASE_MISMATCH', {
      diagnosticCode: 'missingBaseProof',
      baseInOurs: false,
      baseInTheirs: false,
    });
    expect(merge).not.toHaveBeenCalled();
  });
}
