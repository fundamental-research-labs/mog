import {
  TARGET_REF,
  conflictDigestObject,
  expectMergeReviewFailure,
  expectNoDiagnosticLeaks,
  requireResolutionOption,
  resolutionFor,
  withReviewFixture,
} from './version-merge-review-saved-resolution-test-utils';

export function registerSavedResolutionPayloadMissingTargetReviewTests(): void {
  it('rejects saved sealed payload refs without a replay target binding', async () => {
    await withReviewFixture(
      'sealed-payload-ref-missing-target',
      async ({ version, preview, target }) => {
        const conflict = preview.conflicts[0];
        const option = requireResolutionOption(conflict, 'acceptTheirs');
        const payload = await version.putMergeResolutionPayload({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
          optionId: option.optionId,
          kind: option.kind,
          targetRef: TARGET_REF,
          expectedTargetHead: target,
          value: option.value as any,
          purpose: 'chooseValue',
        });
        if (!payload.ok) throw new Error(`expected sealed payload: ${payload.error.code}`);

        const saved = await version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          targetRef: TARGET_REF,
          expectedTargetHead: target,
          resolutions: [
            {
              ...resolutionFor(conflict, 'acceptTheirs'),
              sealedPayloadRef: payload.value,
            },
          ],
        });
        if (!saved.ok || !saved.value.resolutionSetDigest) {
          throw new Error('expected saved sealed payload resolution set');
        }

        const result = await version.getMergeConflictDetail({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
          valueRole: 'resolved',
          purpose: 'resolution',
          resolutionSetDigest: saved.value.resolutionSetDigest,
        });

        expectMergeReviewFailure(result, 'VERSION_MERGE_RESOLUTION_MISMATCH');
        expectNoDiagnosticLeaks(result, [
          conflict.conflictId,
          conflict.conflictDigest,
          option.optionId,
          payload.value.payloadDigest.digest,
          saved.value.resolutionSetDigest.digest,
          preview.resultDigest.digest,
        ]);
      },
    );
  });
}
