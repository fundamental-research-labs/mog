import {
  createDetachedChild,
  graphWithRootAndDetachedChildren,
  validSemanticPayload,
  valueChange,
} from './merge-service-fixtures';

export type MergeServiceAncestryGraph = Awaited<
  ReturnType<typeof graphWithRootAndDetachedChildren>
>;

export async function graphWithTheirsDescendantFastForward() {
  const graph = await graphWithRootAndDetachedChildren({
    oursSemanticPayload: validSemanticPayload([
      valueChange('ours-a1', 'cell', 'sheet-1!A1', ['value'], 1, 2),
    ]),
    theirsSemanticPayload: validSemanticPayload([]),
  });
  const theirsDescendantCommitId = await createDetachedChild(graph, {
    label: 'theirs-descendant',
    parentCommitId: graph.oursCommitId,
    semanticPayload: validSemanticPayload([
      valueChange('theirs-descendant-b1', 'cell', 'sheet-1!B1', ['value'], null, 'ready'),
    ]),
  });

  return { graph, theirsDescendantCommitId };
}

export function fastForwardPreviewPersistenceOptions(graph: MergeServiceAncestryGraph) {
  return {
    mode: 'preview' as const,
    targetRef: 'refs/heads/main' as any,
    expectedTargetHead: {
      commitId: graph.oursCommitId,
      revision: { kind: 'counter' as const, value: '1' },
    },
    persistReviewRecord: true,
  };
}
