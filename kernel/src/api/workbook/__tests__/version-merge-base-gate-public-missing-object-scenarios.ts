import { expect, it } from '@jest/globals';

import {
  commitId,
  createCommit,
  expectPublicSafeMergeFailure,
  graphWithRoot,
  mergeServiceMustNotRun,
  publicWorkbookVersion,
} from './version-merge-base-gate-test-utils';

export function registerPublicMergeBaseGateMissingObjectScenarios() {
  it('blocks public missing base objects before invoking the merge service', async () => {
    const graph = await graphWithRoot('graph-public-missing-base-object');
    const ours = await createCommit(graph, {
      label: 'ours-related-to-main-root',
      parentCommitIds: [graph.rootCommitId],
    });
    const theirs = await createCommit(graph, {
      label: 'theirs-related-to-main-root',
      parentCommitIds: [graph.rootCommitId],
    });
    const merge = mergeServiceMustNotRun();
    const version = publicWorkbookVersion(graph.provider, merge);

    const result = await version.merge({ base: commitId('f'), ours, theirs });

    expectPublicSafeMergeFailure(result, 'VERSION_MISSING_OBJECT');
    expect(merge).not.toHaveBeenCalled();
  });

  it('reports every missing public merge ref before invoking the merge service', async () => {
    const graph = await graphWithRoot('graph-public-missing-all-refs');
    const merge = mergeServiceMustNotRun();
    const version = publicWorkbookVersion(graph.provider, merge);

    const result = await version.merge({
      base: commitId('d'),
      ours: commitId('e'),
      theirs: commitId('f'),
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.merge',
      },
    });
    if (result.ok) throw new Error('expected public merge failure');
    expect(
      result.error.diagnostics
        .filter((diagnostic) => diagnostic.code === 'VERSION_MISSING_OBJECT')
        .map((diagnostic) => diagnostic.data.payload?.mergeRef)
        .sort(),
    ).toEqual(['redacted', 'redacted', 'redacted']);
    expect(JSON.stringify(result.error.diagnostics)).not.toContain('commit:sha256:');
    expect(merge).not.toHaveBeenCalled();
  });
}
