import {
  DRIFTED_TARGET_REF,
  TARGET_REF,
  driftExpectedHead,
  expectMergeReviewFailure,
  expectNoDiagnosticLeaks,
  resolutionFor,
  resolvedDetailInput,
  withReviewFixture,
} from './version-merge-review-saved-resolution-test-utils';

export function registerSavedResolutionResolvedAttemptReviewTests(): void {
  it('rejects targetRef and expectedHead drift on resolved-attempt reads without leaking refs', async () => {
    await withReviewFixture('resolved-attempt-drift', async ({ version, preview, target }) => {
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

      const targetRefDrift = await version.getMergeConflictDetail({
        ...resolvedDetailInput(preview, conflict, saved.value),
        targetRef: DRIFTED_TARGET_REF as any,
        expectedTargetHead: target,
      });
      const expectedHeadDrift = await version.getMergeConflictDetail({
        ...resolvedDetailInput(preview, conflict, saved.value),
        targetRef: TARGET_REF,
        expectedTargetHead: driftExpectedHead(target),
      });

      for (const result of [targetRefDrift, expectedHeadDrift]) {
        expectMergeReviewFailure(result, 'VERSION_MERGE_RESOLUTION_MISMATCH');
        expectNoDiagnosticLeaks(result, [
          conflict.conflictId,
          conflict.conflictDigest,
          saved.value.resolutionSetDigest.digest,
          saved.value.resolvedAttemptDigest.digest,
          preview.resultDigest.digest,
          DRIFTED_TARGET_REF,
        ]);
      }
    });
  });

  it('rejects resolved-attempt detail reads without target proof', async () => {
    await withReviewFixture(
      'resolved-attempt-missing-target',
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

        const result = await version.getMergeConflictDetail(
          resolvedDetailInput(preview, conflict, saved.value),
        );

        expectMergeReviewFailure(result, 'VERSION_MERGE_RESOLUTION_MISMATCH');
        expectNoDiagnosticLeaks(result, [
          conflict.conflictId,
          conflict.conflictDigest,
          saved.value.resolutionSetDigest.digest,
          saved.value.resolvedAttemptDigest.digest,
          preview.resultDigest.digest,
        ]);
      },
    );
  });
}
