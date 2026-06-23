import { expect, it } from '@jest/globals';

import { createWorkbookVersionMergeService } from '../../../document/version-store/merge-service';
import { createCommit, graphWithRoot } from './version-merge-base-gate-test-utils';

export function describeMergeBaseServiceScenarios() {
  it('blocks criss-cross histories with ambiguous lowest common merge bases', async () => {
    const graph = await graphWithRoot('graph-ambiguous-merge-base');
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
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    const result = await service.merge({ base: baseA, ours, theirs });

    expect(result).toMatchObject({
      status: 'blocked',
      base: baseA,
      ours,
      theirs,
      changes: [],
      conflicts: [],
      mutationGuarantee: 'preview-only',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_MERGE_BASE_AMBIGUOUS',
          payload: expect.objectContaining({
            diagnosticCode: 'mergeBaseAmbiguous',
            lowestCommonAncestorCount: 2,
          }),
          redacted: true,
        }),
      ],
    });
  });

  it('blocks unrelated histories that have no common merge base', async () => {
    const graph = await graphWithRoot('graph-unrelated-histories');
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
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    const result = await service.merge({ base: graph.rootCommitId, ours, theirs });

    expect(result).toMatchObject({
      status: 'blocked',
      base: graph.rootCommitId,
      ours,
      theirs,
      changes: [],
      conflicts: [],
      mutationGuarantee: 'preview-only',
      diagnostics: [
        expect.objectContaining({
          issueCode: 'VERSION_MERGE_UNRELATED_HISTORIES',
          payload: expect.objectContaining({ diagnosticCode: 'unrelatedHistories' }),
          redacted: true,
        }),
      ],
    });
  });
}
