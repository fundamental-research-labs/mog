import {
  conflictDigestObject,
  expectMergeReviewFailure,
  mutateDigest,
  resolutionFor,
  TARGET_REF,
  withReviewArtifact,
} from './version-merge-review-endpoints-contracts-test-utils';

export function registerSavedResolutionArtifactScenarios(): void {
  it('reads resolved conflict detail from saved resolution artifacts', async () => {
    await withReviewArtifact('saved-resolution-readback', async ({ version, preview, target }) => {
      const conflict = preview.conflicts[0];
      const saved = await version.saveMergeResolutions({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        targetRef: TARGET_REF,
        expectedTargetHead: target,
        resolutions: [resolutionFor(conflict, 'acceptTheirs')],
      });
      if (!saved.ok || !saved.value.resolutionSetDigest || !saved.value.resolvedAttemptDigest) {
        throw new Error('expected saved resolution artifact digests');
      }

      const detail = await version.getMergeConflictDetail({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
        valueRole: 'resolved',
        purpose: 'resolution',
        resolutionSetDigest: saved.value.resolutionSetDigest,
        resolvedAttemptDigest: saved.value.resolvedAttemptDigest,
        targetRef: TARGET_REF,
        expectedTargetHead: target,
      });

      expect(detail).toMatchObject({
        ok: true,
        value: {
          schemaVersion: 1,
          kind: 'resolutionPayload',
          valueRole: 'resolved',
          value: { kind: 'value', value: 'theirs' },
        },
      });
    });
  });

  it('rejects mismatched saved-resolution artifact digests', async () => {
    await withReviewArtifact(
      'saved-resolution-digest-mismatch',
      async ({ version, preview, target }) => {
        const conflict = preview.conflicts[0];
        const saved = await version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          targetRef: TARGET_REF,
          expectedTargetHead: target,
          resolutions: [resolutionFor(conflict, 'acceptTheirs')],
        });
        if (!saved.ok || !saved.value.resolutionSetDigest || !saved.value.resolvedAttemptDigest) {
          throw new Error('expected saved resolution artifact digests');
        }

        const detail = await version.getMergeConflictDetail({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
          valueRole: 'resolved',
          purpose: 'resolution',
          resolutionSetDigest: mutateDigest(saved.value.resolutionSetDigest),
          resolvedAttemptDigest: saved.value.resolvedAttemptDigest,
        });

        expectMergeReviewFailure(
          detail,
          'getMergeConflictDetail',
          'VERSION_MERGE_RESOLUTION_MISMATCH',
        );
      },
    );
  });
}
