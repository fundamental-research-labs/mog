import { it } from '@jest/globals';

import {
  expectAppliedConflictMerge,
  expectMergeCommitAndResolvedCell,
  expectPersistedResolutionSetArtifact,
  expectRepeatedConflictApply,
  expectReplayedConflictedPreview,
  requirePersistedConflictedPreview,
} from './version-apply-merge-persisted-artifact-conflict-assertions';
import { sealAcceptTheirsResolution } from './version-apply-merge-persisted-artifact-conflict-resolutions';
import {
  createPersistedMergeScenario,
  PERSISTED_ARTIFACT_TARGET_REF,
} from './version-apply-merge-persisted-artifact-test-utils';

export function registerPersistedConflictArtifactScenario(): void {
  it('replays a persisted conflicted review artifact without an apply intent', async () => {
    const fixture = await createPersistedMergeScenario({
      graphId: 'graph-conflict-artifact',
      branchName: 'scenario/persisted-conflict-artifact',
      ours: [{ cell: 'A1', value: 'ours' }],
      theirs: [{ cell: 'A1', value: 'theirs' }],
    });

    try {
      const { sourceWb, baseCommit, oursCommit, theirsCommit } = fixture;
      const previewResult = await sourceWb.version.merge(
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
      if (!previewResult.ok) {
        throw new Error(`expected persisted conflicted preview: ${previewResult.error.code}`);
      }
      const preview = requirePersistedConflictedPreview(previewResult.value);

      const replayedPreviewResult = await sourceWb.version.applyMerge(
        {
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          previewArtifactDigest: preview.previewArtifactDigest,
        },
        { mode: 'preview' },
      );
      if (!replayedPreviewResult.ok) {
        throw new Error(`expected conflicted replay success: ${replayedPreviewResult.error.code}`);
      }
      const replayedPreview = expectReplayedConflictedPreview({
        replayedPreview: replayedPreviewResult.value,
        preview,
        baseCommit,
        oursCommit,
        theirsCommit,
      });

      const { sealedResolution, sealedPayloadRef } = await sealAcceptTheirsResolution({
        fixture,
        preview,
        conflict: replayedPreview.conflicts[0],
      });

      const appliedResult = await sourceWb.version.applyMerge(
        {
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          previewArtifactDigest: preview.previewArtifactDigest,
          resolutions: [sealedResolution],
        },
        {
          targetRef: PERSISTED_ARTIFACT_TARGET_REF,
          expectedTargetHead: fixture.expectedTargetHead,
        },
      );
      if (!appliedResult.ok) {
        throw new Error(`expected persisted conflict apply success: ${appliedResult.error.code}`);
      }
      const applied = expectAppliedConflictMerge({
        applied: appliedResult.value,
        preview,
        oursCommit,
        theirsCommit,
      });
      await expectPersistedResolutionSetArtifact(fixture, applied, sealedPayloadRef);

      const mergeCommitId = applied.commitRef.id;
      await expectMergeCommitAndResolvedCell({
        fixture,
        mergeCommitId,
        oursCommit,
        theirsCommit,
      });

      const repeated = await sourceWb.version.applyMerge(
        {
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          previewArtifactDigest: preview.previewArtifactDigest,
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
      expectRepeatedConflictApply({
        repeated: repeated.value,
        preview,
        applied,
        mergeCommitId,
        oursCommit,
        theirsCommit,
      });
    } finally {
      await fixture.cleanup();
    }
  });
}
