import { expect, it } from '@jest/globals';

import {
  createCommit,
  expectPublicSafeMergeFailure,
  graphWithRoot,
  mergeServiceMustNotRun,
  providerWithClosureSubstitution,
  publicWorkbookVersion,
} from './version-merge-base-gate-test-utils';

export function registerPublicMergeBaseGateClosureRefMismatchScenarios() {
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
}
