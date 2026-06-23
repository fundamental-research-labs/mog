import { expect, it, jest } from '@jest/globals';

import type { VersionMergeInput } from '@mog-sdk/contracts/api';

import { createWorkbookVersionMergeService } from '../../../document/version-store/merge-service';
import {
  commitId,
  createCommit,
  expectPublicSafeMergeFailure,
  graphWithRoot,
  mergeServiceMustNotRun,
  providerWithClosureSubstitution,
  publicWorkbookVersion,
} from './version-merge-base-gate-test-utils';

export function describePublicMergeBaseGateScenarios() {
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

  it.each(['base', 'ours', 'theirs'] as const)(
    'blocks public %s closure ref mismatches with redacted diagnostics',
    async (mergeRef) => {
      const graph = await graphWithRoot('graph-public-ref-mismatch');
      const unrelatedRoot = await createCommit(graph, {
        label: 'unrelated-root',
        parentCommitIds: [],
      });
      const ours = await createCommit(graph, {
        label: 'ours-related-to-main-root',
        parentCommitIds: [graph.rootCommitId],
      });
      const theirs = await createCommit(graph, {
        label: 'theirs-related-to-main-root',
        parentCommitIds: [graph.rootCommitId],
      });
      const merge = mergeServiceMustNotRun();
      const input = { base: graph.rootCommitId, ours, theirs };
      const provider = providerWithClosureSubstitution(
        graph.provider,
        input[mergeRef],
        mergeRef === 'base' ? unrelatedRoot : graph.rootCommitId,
      );
      const version = publicWorkbookVersion(provider, merge);

      const result = await version.merge(input);

      const diagnostic = expectPublicSafeMergeFailure(result, 'VERSION_UNMATERIALIZABLE_COMMIT', {
        diagnosticCode: 'commitClosureRefMismatch',
        mergeRef: 'redacted',
      });
      expect(diagnostic.data).toMatchObject({
        operation: 'merge',
        redacted: true,
        payload: {
          operation: 'merge',
          diagnosticCode: 'commitClosureRefMismatch',
          mergeRef: 'redacted',
        },
      });
      expect(JSON.stringify(diagnostic.data.payload)).not.toContain('commit:sha256:');
      expect(merge).not.toHaveBeenCalled();
    },
  );

  it('allows public already-merged ancestor previews to reach the merge service', async () => {
    const graph = await graphWithRoot('graph-public-already-merged-ancestor');
    const theirs = await createCommit(graph, {
      label: 'theirs-ancestor',
      parentCommitIds: [graph.rootCommitId],
    });
    const ours = await createCommit(graph, {
      label: 'ours-descendant',
      parentCommitIds: [theirs],
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });
    const merge = jest.fn(
      (input: VersionMergeInput, options?: Parameters<typeof service.merge>[1]) =>
        service.merge(input, options),
    );
    const version = publicWorkbookVersion(graph.provider, merge);

    await expect(version.merge({ base: graph.rootCommitId, ours, theirs })).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'alreadyMerged',
        base: graph.rootCommitId,
        ours,
        theirs,
        changes: [],
        conflicts: [],
        diagnostics: [],
        mutationGuarantee: 'preview-only',
      },
    });
    expect(merge).toHaveBeenCalledTimes(1);
  });
}
