import {
  createPersistedMergeScenario,
  PERSISTED_ARTIFACT_TARGET_REF,
} from './version-apply-merge-persisted-artifact-test-utils';

describe('WorkbookVersion persisted clean merge preview artifacts', () => {
  it('applies a review-only clean preview artifact through the production merge materializer', async () => {
    const fixture = await createPersistedMergeScenario({
      graphId: 'graph-clean-artifact',
      branchName: 'scenario/persisted-clean-artifact',
      ours: [{ cell: 'B1', value: 'ours' }],
      theirs: [{ cell: 'C1', value: 'theirs' }],
    });

    try {
      const { sourceWb, provider, namespace, baseCommit, oursCommit, theirsCommit } = fixture;
      const preview = await sourceWb.version.merge(
        {
          base: baseCommit.id,
          ours: oursCommit.id,
          theirs: theirsCommit.id,
        },
        {
          mode: 'preview',
          targetRef: PERSISTED_ARTIFACT_TARGET_REF,
          expectedTargetHead: fixture.expectedTargetHead,
          persistReviewRecord: true,
        },
      );
      if (!preview.ok) throw new Error(`expected persisted clean preview: ${preview.error.code}`);
      expect(preview.value).toMatchObject({
        status: 'clean',
        resultId: expect.stringMatching(/^merge-result:[0-9a-f]{64}$/),
        attemptPersistence: 'persisted',
        attemptKind: 'reviewOnly',
        targetRef: 'refs/heads/main',
      });
      if (
        preview.value.status !== 'clean' ||
        !preview.value.resultId ||
        !preview.value.resultDigest ||
        !preview.value.previewArtifactDigest
      ) {
        throw new Error('expected clean preview to expose persisted artifact metadata');
      }
      expect(preview.value.resultDigest).toEqual(preview.value.previewArtifactDigest);

      const replayedPreview = await sourceWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
        },
        { mode: 'preview' },
      );
      if (!replayedPreview.ok) {
        throw new Error(`expected persisted preview replay success: ${replayedPreview.error.code}`);
      }
      expect(replayedPreview.value).toMatchObject({
        status: 'planned',
        base: baseCommit.id,
        ours: oursCommit.id,
        theirs: theirsCommit.id,
        resultId: preview.value.resultId,
        resultDigest: preview.value.resultDigest,
        previewArtifactDigest: preview.value.previewArtifactDigest,
        changes: preview.value.changes,
        conflicts: [],
        resolutionCount: 0,
        mutationGuarantee: 'preview-only',
      });

      const applied = await sourceWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
          previewArtifactDigest: preview.value.previewArtifactDigest,
        },
        {
          targetRef: PERSISTED_ARTIFACT_TARGET_REF,
          expectedTargetHead: fixture.expectedTargetHead,
        },
      );
      if (!applied.ok) {
        throw new Error(`expected persisted clean apply success: ${applied.error.code}`);
      }
      expect(applied.value).toMatchObject({
        status: 'applied',
        ours: oursCommit.id,
        theirs: theirsCommit.id,
        resultId: preview.value.resultId,
        resultDigest: preview.value.resultDigest,
        previewArtifactDigest: preview.value.previewArtifactDigest,
        targetRef: 'refs/heads/main',
        headBefore: oursCommit.id,
        mutationGuarantee: 'merge-commit-created',
        commitRef: {
          refName: 'refs/heads/main',
          resolvedFrom: 'refs/heads/main',
        },
      });

      const mergeCommitId = applied.value.commitRef.id;
      const graph = await provider.openGraph(namespace, provider.accessContext);
      await expect(graph.readCommit(mergeCommitId)).resolves.toMatchObject({
        status: 'success',
        commit: {
          payload: {
            resolvedMergeAttemptDigest: applied.value.resolvedAttemptDigest,
          },
        },
      });
      await expect(sourceWb.version.listCommits()).resolves.toMatchObject({
        ok: true,
        value: {
          items: expect.arrayContaining([
            expect.objectContaining({
              id: mergeCommitId,
              parents: [oursCommit.id, theirsCommit.id],
            }),
          ]),
        },
      });
      const mergedWb = await fixture.openMergedWorkbook();
      const checkoutMerged = await mergedWb.version.checkout({
        kind: 'commit',
        id: mergeCommitId,
      });
      if (!checkoutMerged.ok) {
        throw new Error(`expected merged checkout success: ${checkoutMerged.error.code}`);
      }
      await expect(mergedWb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'base' });
      await expect(mergedWb.activeSheet.getCell('B1')).resolves.toMatchObject({ value: 'ours' });
      await expect(mergedWb.activeSheet.getCell('C1')).resolves.toMatchObject({
        value: 'theirs',
      });
    } finally {
      await fixture.cleanup();
    }
  });
});
