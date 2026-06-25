import { mergePreviewArtifactRef } from '../merge-attempt-artifacts';
import { createWorkbookVersionMergeService } from '../merge-service';
import {
  expectNoIntentForReviewResult,
  graphWithRootAndDetachedChildren,
  validSemanticPayload,
  valueChange,
} from './merge-service-persistence-test-helpers';

export function registerMergeServicePersistenceConflictedScenarios() {
  it('persists conflicted previews as durable review artifacts without apply intents', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        valueChange('ours-a1', 'cell', 'sheet-1!A1', ['value'], 1, 2),
      ]),
      theirsSemanticPayload: validSemanticPayload([
        valueChange('theirs-a1', 'cell', 'sheet-1!A1', ['value'], 1, 3),
      ]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    const result = await service.merge(
      {
        base: graph.rootCommitId,
        ours: graph.oursCommitId,
        theirs: graph.theirsCommitId,
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
      status: 'conflicted',
      attemptPersistence: 'persisted',
      attemptKind: 'reviewOnly',
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
    const previewArtifactDigest = result.previewArtifactDigest;
    if (result.status !== 'conflicted' || !previewArtifactDigest || !result.resultId) {
      throw new Error('expected a persisted conflicted review artifact');
    }
    if (previewArtifactDigest.algorithm !== 'sha256') {
      throw new Error('expected a sha256 conflicted review artifact digest');
    }
    expect(result.resultDigest).toEqual(result.previewArtifactDigest);

    const opened = await graph.provider.openGraph(graph.namespace);
    const artifactRef = mergePreviewArtifactRef({
      algorithm: 'sha256',
      digest: previewArtifactDigest.digest,
    });
    await expect(opened.getObjectRecord(artifactRef)).resolves.toMatchObject({
      preimage: {
        payload: {
          recordKind: 'mergePreview',
          status: 'conflicted',
          changes: [],
          conflicts: [
            expect.objectContaining({
              conflictKind: 'same-property',
              structural: expect.objectContaining({ entityId: 'sheet-1!A1' }),
            }),
          ],
        },
      },
    });

    await expectNoIntentForReviewResult(graph, result.resultId);
  });
}
