import { createWorkbookVersionMergeService } from '../merge-service';
import {
  createDetachedChild,
  graphWithRootAndDetachedChildren,
  validSemanticPayload,
  valueChange,
} from './merge-service-fixtures';

export function registerMergeServiceAncestryBlockingScenarios() {
  it('classifies incoming commits already reachable from ours as already merged', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        valueChange('ancestor-a1', 'cell', 'sheet-1!A1', ['value'], 1, 2),
      ]),
      theirsSemanticPayload: validSemanticPayload([]),
    });
    const oursDescendantCommitId = await createDetachedChild(graph, {
      label: 'ours-descendant',
      parentCommitId: graph.oursCommitId,
      semanticPayload: validSemanticPayload([
        valueChange('ours-descendant-b1', 'cell', 'sheet-1!B1', ['value'], null, 'kept'),
      ]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    await expect(
      service.merge({
        base: graph.rootCommitId,
        ours: oursDescendantCommitId,
        theirs: graph.oursCommitId,
      }),
    ).resolves.toMatchObject({
      status: 'alreadyMerged',
      base: graph.rootCommitId,
      ours: oursDescendantCommitId,
      theirs: graph.oursCommitId,
      changes: [],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    });
  });

  it('blocks commits that are not direct children of the requested base', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        valueChange('ours-a1', 'cell', 'sheet-1!A1', ['value'], 1, 2),
      ]),
      theirsSemanticPayload: validSemanticPayload([]),
    });
    const grandchildCommitId = await createDetachedChild(graph, {
      label: 'grandchild',
      parentCommitId: graph.oursCommitId,
      semanticPayload: validSemanticPayload([
        valueChange('grandchild-a1', 'cell', 'sheet-1!A1', ['value'], 2, 4),
      ]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    await expect(
      service.merge({
        base: graph.rootCommitId,
        ours: grandchildCommitId,
        theirs: graph.theirsCommitId,
      }),
    ).resolves.toMatchObject({
      status: 'blocked',
      changes: [],
      conflicts: [],
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_MERGE_UNSUPPORTED_ANCESTRY' })],
    });
  });
}
