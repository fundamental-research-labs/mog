import {
  conflictDigestObject,
  expectMergeReviewFailure,
  requireResolutionOption,
  resolutionFor,
  TARGET_REF,
  withReviewArtifact,
} from './version-merge-review-endpoints-contracts-test-utils';

export function registerMergeReviewEndpointContractsAncestryArtifactScenarios(): void {
  it('rejects ancestry-only merge artifacts across review endpoints', async () => {
    await withReviewArtifact(
      'ancestry-artifact',
      async ({ version, preview, target }) => {
        const conflict = preview.conflicts[0];
        const option = requireResolutionOption(conflict, 'acceptTheirs');
        const detail = await version.getMergeConflictDetail({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
          valueRole: 'theirs',
          purpose: 'review',
        });
        const saved = await version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          targetRef: TARGET_REF,
          expectedTargetHead: target,
          resolutions: [resolutionFor(conflict, 'acceptTheirs')],
        });
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

        for (const [result, operation] of [
          [detail, 'getMergeConflictDetail'],
          [saved, 'saveMergeResolutions'],
          [payload, 'putMergeResolutionPayload'],
        ] as const) {
          expectMergeReviewFailure(result, operation, 'VERSION_MERGE_RESOLUTION_MISMATCH');
        }
      },
      { status: 'fastForward' },
    );
  });
}
