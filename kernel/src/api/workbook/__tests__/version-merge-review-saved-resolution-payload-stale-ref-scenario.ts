import {
  TARGET_REF,
  conflictDigestObject,
  driftExpectedHead,
  expectMergeReviewFailure,
  expectNoDiagnosticLeaks,
  requireResolutionOption,
  resolutionFor,
  withReviewFixture,
} from './version-merge-review-saved-resolution-test-utils';

export function registerSavedResolutionPayloadStaleRefReviewTests(): void {
  it('rejects stale saved-resolution sealed payload refs without leaking payload bindings', async () => {
    await withReviewFixture('stale-sealed-payload-ref', async ({ version, preview, target }) => {
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
        targetRef: TARGET_REF,
        expectedTargetHead: driftExpectedHead(target),
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
    });
  });
}
