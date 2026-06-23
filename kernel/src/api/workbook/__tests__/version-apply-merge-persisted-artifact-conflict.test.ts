import { mergeResolutionSetArtifactRef } from '../../../document/version-store/merge-attempt-artifacts';
import {
  conflictDigestObject,
  createPersistedMergeScenario,
  PERSISTED_ARTIFACT_TARGET_REF,
  resolutionFor,
} from './version-apply-merge-persisted-artifact-test-utils';

describe('WorkbookVersion persisted conflicted merge preview artifacts', () => {
  it('replays a persisted conflicted review artifact without an apply intent', async () => {
    const fixture = await createPersistedMergeScenario({
      graphId: 'graph-conflict-artifact',
      branchName: 'scenario/persisted-conflict-artifact',
      ours: [{ cell: 'A1', value: 'ours' }],
      theirs: [{ cell: 'A1', value: 'theirs' }],
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
      if (!preview.ok) {
        throw new Error(`expected persisted conflicted preview: ${preview.error.code}`);
      }
      if (
        preview.value.status !== 'conflicted' ||
        !preview.value.resultId ||
        !preview.value.resultDigest ||
        !preview.value.previewArtifactDigest
      ) {
        throw new Error('expected conflicted preview to expose persisted artifact metadata');
      }

      const replayedPreview = await sourceWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
          previewArtifactDigest: preview.value.previewArtifactDigest,
        },
        { mode: 'preview' },
      );
      if (!replayedPreview.ok) {
        throw new Error(`expected conflicted replay success: ${replayedPreview.error.code}`);
      }
      expect(replayedPreview.value).toMatchObject({
        status: 'conflicted',
        base: baseCommit.id,
        ours: oursCommit.id,
        theirs: theirsCommit.id,
        resultId: preview.value.resultId,
        resultDigest: preview.value.resultDigest,
        previewArtifactDigest: preview.value.previewArtifactDigest,
        changes: preview.value.changes,
        conflicts: expect.arrayContaining([
          expect.objectContaining({
            conflictId: preview.value.conflicts[0].conflictId,
            conflictDigest: preview.value.conflicts[0].conflictDigest,
            resolutionOptions: expect.arrayContaining([
              expect.objectContaining({ kind: 'acceptOurs' }),
              expect.objectContaining({ kind: 'acceptTheirs' }),
              expect.objectContaining({ kind: 'acceptBase' }),
            ]),
          }),
        ]),
        requiredResolutionCount: preview.value.conflicts.length,
        mutationGuarantee: 'preview-only',
      });
      if (replayedPreview.value.status !== 'conflicted') {
        throw new Error('expected replayed preview to remain conflicted');
      }

      const conflict = replayedPreview.value.conflicts[0];
      const option = conflict.resolutionOptions.find(
        (candidate) => candidate.kind === 'acceptTheirs',
      );
      if (!option) throw new Error('expected acceptTheirs option');
      const payload = await sourceWb.version.putMergeResolutionPayload({
        resultId: preview.value.resultId,
        resultDigest: preview.value.resultDigest,
        redactionPolicyDigest: preview.value.resultDigest,
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
        optionId: option.optionId,
        kind: option.kind,
        targetRef: PERSISTED_ARTIFACT_TARGET_REF,
        expectedTargetHead: fixture.expectedTargetHead,
        value: option.value as any,
        purpose: 'chooseValue',
      });
      if (!payload.ok) throw new Error(`expected payload put success: ${payload.error.code}`);
      const sealedResolution = {
        ...resolutionFor(conflict, 'acceptTheirs'),
        sealedPayloadRef: payload.value,
      };

      const applied = await sourceWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
          previewArtifactDigest: preview.value.previewArtifactDigest,
          resolutions: [sealedResolution],
        },
        {
          targetRef: PERSISTED_ARTIFACT_TARGET_REF,
          expectedTargetHead: fixture.expectedTargetHead,
        },
      );
      if (!applied.ok) {
        throw new Error(`expected persisted conflict apply success: ${applied.error.code}`);
      }
      expect(applied.value).toMatchObject({
        status: 'applied',
        ours: oursCommit.id,
        theirs: theirsCommit.id,
        resultId: preview.value.resultId,
        resultDigest: preview.value.resultDigest,
        previewArtifactDigest: preview.value.previewArtifactDigest,
        resolutionSetDigest: {
          algorithm: 'sha256',
          digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
        resolvedAttemptDigest: {
          algorithm: 'sha256',
          digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
        targetRef: 'refs/heads/main',
        resolutionCount: 1,
        mutationGuarantee: 'merge-commit-created',
      });
      if (!applied.value.resolutionSetDigest) {
        throw new Error('expected applied merge to expose a resolution set digest');
      }
      const graph = await provider.openGraph(namespace, provider.accessContext);
      await expect(
        graph.getObjectRecord(mergeResolutionSetArtifactRef(applied.value.resolutionSetDigest)),
      ).resolves.toMatchObject({
        preimage: {
          payload: {
            resolutions: [expect.objectContaining({ sealedPayloadRef: payload.value })],
          },
        },
      });

      const mergeCommitId = applied.value.commitRef.id;
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
      await expect(mergedWb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'theirs' });

      const repeated = await sourceWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
          previewArtifactDigest: preview.value.previewArtifactDigest,
          resolutions: [sealedResolution],
        },
        {
          targetRef: PERSISTED_ARTIFACT_TARGET_REF,
          expectedTargetHead: fixture.expectedTargetHead,
        },
      );
      if (!repeated.ok) {
        throw new Error(
          `expected repeated persisted conflict apply success: ${repeated.error.code}`,
        );
      }
      expect(repeated.value).toMatchObject({
        status: 'alreadyApplied',
        ours: oursCommit.id,
        theirs: theirsCommit.id,
        resultId: preview.value.resultId,
        resultDigest: preview.value.resultDigest,
        previewArtifactDigest: preview.value.previewArtifactDigest,
        resolutionSetDigest: applied.value.resolutionSetDigest,
        resolvedAttemptDigest: applied.value.resolvedAttemptDigest,
        targetRef: 'refs/heads/main',
        headBefore: oursCommit.id,
        headAfter: mergeCommitId,
        commitRef: {
          id: mergeCommitId,
          refName: 'refs/heads/main',
          resolvedFrom: 'refs/heads/main',
        },
        changes: [],
        resolutionCount: 0,
        mutationGuarantee: 'ref-not-mutated',
      });
    } finally {
      await fixture.cleanup();
    }
  });
});
