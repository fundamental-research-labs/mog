import {
  conflictDigestObject,
  expectMergeReviewFailure,
  expectNoDiagnosticLeaks,
  TARGET_REF,
  withReviewArtifact,
} from './version-merge-review-endpoints-contracts-test-utils';

export function registerSealedRefArtifactScenarios(): void {
  it('rejects non-replayable sealed payload refs without leaking binding values', async () => {
    await withReviewArtifact('sealed-ref-contract', async ({ version, preview, target }) => {
      const conflict = preview.conflicts[0];
      const canonical = await version.getMergeConflictDetail({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
        valueRole: 'theirs',
        purpose: 'review',
      });
      if (!canonical.ok) throw new Error('expected canonical conflict detail');
      const option = canonical.value.resolutionOptions.find(
        (candidate) => candidate.kind === 'acceptTheirs',
      );
      if (!option) throw new Error('expected canonical acceptTheirs option');
      const sealedPayloadRef = {
        schemaVersion: 1,
        kind: 'sealedResolutionPayload',
        payloadId: `merge-payload:${preview.resultDigest.digest}`,
        payloadDigest: preview.resultDigest,
        storageMode: 'localOnly',
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        conflictId: canonical.value.conflictId,
        optionId: option.optionId,
        resolutionKind: option.kind,
      } as const;

      const saved = await version.saveMergeResolutions({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        targetRef: TARGET_REF,
        expectedTargetHead: target,
        resolutions: [
          {
            conflictId: canonical.value.conflictId,
            expectedConflictDigest: canonical.value.conflictDigest,
            optionId: option.optionId,
            kind: option.kind,
            sealedPayloadRef,
          },
        ],
      });

      expectMergeReviewFailure(saved, 'saveMergeResolutions', 'VERSION_MERGE_RESOLUTION_MISMATCH');
      expectNoDiagnosticLeaks(saved, [
        canonical.value.conflictId,
        canonical.value.conflictDigest,
        option.optionId,
        preview.resultDigest.digest,
      ]);
    });
  });
}
