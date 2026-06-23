import { intentIdForMergeResultId } from '../merge-apply-intent-store';
import { mergePreviewArtifactRef } from '../merge-attempt-artifacts';
import { createWorkbookVersionMergeService } from '../merge-service';
import {
  fastForwardPreviewPersistenceOptions,
  graphWithTheirsDescendantFastForward,
} from './merge-service-ancestry-test-helpers';

export function registerMergeServiceAncestryPersistenceScenarios() {
  it('persists applyable fast-forward preview intents when requested', async () => {
    const { graph, theirsDescendantCommitId } = await graphWithTheirsDescendantFastForward();
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    const result = await service.merge(
      {
        base: graph.rootCommitId,
        ours: graph.oursCommitId,
        theirs: theirsDescendantCommitId,
      },
      fastForwardPreviewPersistenceOptions(graph),
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
        fastForwardPreviewPersistenceOptions(graph),
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
        fastForwardPreviewPersistenceOptions(graph),
      ),
    ).resolves.toMatchObject({
      status: 'fastForward',
      resultId: result.resultId,
      resultDigest: result.resultDigest,
      attemptPersistence: 'persisted',
      attemptKind: 'applyable',
    });
  });
}
