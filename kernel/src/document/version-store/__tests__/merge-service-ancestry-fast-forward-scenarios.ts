import { createWorkbookVersionMergeService } from '../merge-service';
import { graphWithTheirsDescendantFastForward } from './merge-service-ancestry-test-helpers';

export function registerMergeServiceAncestryFastForwardScenarios() {
  it('classifies descendant theirs commits as fast-forward previews', async () => {
    const { graph, theirsDescendantCommitId } = await graphWithTheirsDescendantFastForward();
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    await expect(
      service.merge({
        base: graph.rootCommitId,
        ours: graph.oursCommitId,
        theirs: theirsDescendantCommitId,
      }),
    ).resolves.toMatchObject({
      status: 'fastForward',
      base: graph.rootCommitId,
      ours: graph.oursCommitId,
      theirs: theirsDescendantCommitId,
      changes: [],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    });
  });
}
