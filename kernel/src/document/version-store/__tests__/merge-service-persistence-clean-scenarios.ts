import { mergePreviewArtifactRef } from '../merge-attempt-artifacts';
import { createWorkbookVersionMergeService } from '../merge-service';
import {
  expectNoIntentForReviewResult,
  graphWithRootAndDetachedChildren,
  validSemanticPayload,
  valueChange,
} from './merge-service-persistence-test-helpers';

export function registerMergeServicePersistenceCleanScenarios() {
  it('persists clean divergent previews as durable review artifacts', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        valueChange('ours-a1', 'cell', 'sheet-1!A1', ['value'], 1, 2),
      ]),
      theirsSemanticPayload: validSemanticPayload([
        valueChange('theirs-b1', 'cells.values', 'sheet-1!B1', [], null, 'ready'),
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
      status: 'clean',
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
    if (result.status !== 'clean' || !previewArtifactDigest || !result.resultId) {
      throw new Error('expected a persisted clean review artifact');
    }
    if (previewArtifactDigest.algorithm !== 'sha256') {
      throw new Error('expected a sha256 clean review artifact digest');
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
          status: 'clean',
          changes: expect.arrayContaining([
            expect.objectContaining({
              structural: expect.objectContaining({ entityId: 'sheet-1!A1' }),
            }),
            expect.objectContaining({
              structural: expect.objectContaining({ entityId: 'sheet-1!B1' }),
            }),
          ]),
          conflicts: [],
        },
      },
    });

    await expectNoIntentForReviewResult(graph, result.resultId);
  });
}
