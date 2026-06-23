import { intentIdForMergeResultId } from '../merge-apply-intent-store';
import { mergePreviewArtifactRef } from '../merge-attempt-artifacts';
import { createWorkbookVersionMergeService } from '../merge-service';
import {
  createDetachedChild,
  graphWithRootAndDetachedChildren,
  validSemanticPayload,
  valueChange,
} from './merge-service-fixtures';

describe('WorkbookVersionMergeService ancestry and fast-forward previews', () => {
  it('classifies descendant theirs commits as fast-forward previews', async () => {
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

  it('persists applyable fast-forward preview intents when requested', async () => {
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
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    const result = await service.merge(
      {
        base: graph.rootCommitId,
        ours: graph.oursCommitId,
        theirs: theirsDescendantCommitId,
      },
      {
        mode: 'preview',
        targetRef: 'refs/heads/main' as any,
        expectedTargetHead: {
          commitId: graph.oursCommitId,
          revision: { kind: 'counter', value: '1' },
        },
        persistReviewRecord: true,
      },
    );

    expect(result).toMatchObject({
      status: 'fastForward',
      base: graph.rootCommitId,
      ours: graph.oursCommitId,
      theirs: theirsDescendantCommitId,
      attemptPersistence: 'persisted',
      attemptKind: 'applyable',
      targetRef: 'refs/heads/main',
      expectedTargetHead: {
        commitId: graph.oursCommitId,
        revision: { kind: 'counter', value: '1' },
      },
      resultDigest: {
        algorithm: 'sha256',
        digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      previewArtifactDigest: {
        algorithm: 'sha256',
        digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      resultId: expect.stringMatching(/^merge-result:[0-9a-f]{64}$/),
    });
    if (
      result.status !== 'fastForward' ||
      !result.resultId ||
      !result.resultDigest ||
      !result.previewArtifactDigest
    ) {
      throw new Error('expected a persisted fast-forward merge result id and digest');
    }
    const opened = await graph.provider.openGraph(graph.namespace);
    await expect(
      opened.getObjectRecord(mergePreviewArtifactRef(result.previewArtifactDigest)),
    ).resolves.toMatchObject({
      preimage: {
        payload: {
          recordKind: 'mergePreview',
          status: 'fastForward',
          base: graph.rootCommitId,
          ours: graph.oursCommitId,
          theirs: theirsDescendantCommitId,
        },
      },
    });

    const intentId = intentIdForMergeResultId(result.resultId);
    if (!intentId) throw new Error('expected persisted result id to map to an intent id');
    const resolvedAttemptDigest = result.resultId.slice('merge-result:'.length);
    const store = await graph.provider.openMergeApplyIntentStore(graph.namespace);
    const read = await store.readByIntentId(intentId);
    expect(read).toMatchObject({
      status: 'found',
      record: {
        intentId,
        applyKind: 'fastForward',
        base: graph.rootCommitId,
        ours: graph.oursCommitId,
        theirs: theirsDescendantCommitId,
        targetRef: 'refs/heads/main',
        expectedTargetHead: {
          commitId: graph.oursCommitId,
          revision: { kind: 'counter', value: '1' },
        },
        resultDigest: result.resultDigest,
        resolutionSetDigest: {
          algorithm: 'sha256',
          digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
        resolvedAttemptDigest: {
          algorithm: 'sha256',
          digest: resolvedAttemptDigest,
        },
      },
    });

    await expect(
      service.merge(
        {
          base: graph.rootCommitId,
          ours: graph.oursCommitId,
          theirs: theirsDescendantCommitId,
        },
        {
          mode: 'preview',
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead: {
            commitId: graph.oursCommitId,
            revision: { kind: 'counter', value: '1' },
          },
          persistReviewRecord: true,
        },
      ),
    ).resolves.toMatchObject({
      status: 'fastForward',
      resultId: result.resultId,
      resultDigest: result.resultDigest,
      attemptPersistence: 'persisted',
      attemptKind: 'applyable',
    });

    await expect(
      store.completeIntent({
        intentId,
        resolvedAttemptDigest: {
          algorithm: 'sha256',
          digest: resolvedAttemptDigest,
        },
        completedAt: '2026-06-21T00:00:01.000Z',
        terminal: {
          status: 'fastForwarded',
          headBefore: graph.oursCommitId,
          headAfter: theirsDescendantCommitId,
          commitId: theirsDescendantCommitId,
        },
      }),
    ).resolves.toMatchObject({ status: 'completed' });
    await expect(
      service.merge(
        {
          base: graph.rootCommitId,
          ours: graph.oursCommitId,
          theirs: theirsDescendantCommitId,
        },
        {
          mode: 'preview',
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead: {
            commitId: graph.oursCommitId,
            revision: { kind: 'counter', value: '1' },
          },
          persistReviewRecord: true,
        },
      ),
    ).resolves.toMatchObject({
      status: 'fastForward',
      resultId: result.resultId,
      resultDigest: result.resultDigest,
      attemptPersistence: 'persisted',
      attemptKind: 'applyable',
    });
  });

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
});
