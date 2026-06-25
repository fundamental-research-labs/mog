import {
  conflictDigestObject,
  expectInvalidMergeReviewOptions,
  expectInvalidMergeReviewRequest,
  expectNoDiagnosticLeaks,
  requireResolutionOption,
  resolutionFor,
  TARGET_REF,
  withReviewArtifact,
} from './version-merge-review-endpoints-contracts-test-utils';

export function registerMergeReviewEndpointContractsNormalizationTargetDigestScenarios(): void {
  it('rejects partial target proof and malformed conflict digests during normalization', async () => {
    await withReviewArtifact(
      'normalization-target-digest',
      async ({ version, preview, target }) => {
        const conflict = preview.conflicts[0];
        const option = requireResolutionOption(conflict, 'acceptTheirs');
        const malformedDetailDigest = 'sha256:not-a-digest-sk_live_detail_secret';
        const malformedResolutionDigest = 'sha256:not-a-digest-sk_live_resolution_secret';

        const partialTarget = await version.getMergeConflictDetail({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
          valueRole: 'theirs',
          purpose: 'review',
          targetRef: TARGET_REF,
        });
        const malformedDetail = await version.getMergeConflictDetail({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: malformedDetailDigest as any,
          valueRole: 'theirs',
          purpose: 'review',
        });
        const malformedSave = await version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          targetRef: TARGET_REF,
          expectedTargetHead: target,
          resolutions: [
            {
              ...resolutionFor(conflict, 'acceptTheirs'),
              expectedConflictDigest: malformedResolutionDigest,
            },
          ],
        });
        const malformedPayload = await version.putMergeResolutionPayload({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: malformedDetailDigest as any,
          optionId: option.optionId,
          kind: option.kind,
          targetRef: TARGET_REF,
          expectedTargetHead: target,
          value: option.value as any,
          purpose: 'chooseValue',
        });

        expectInvalidMergeReviewOptions(partialTarget, 'getMergeConflictDetail', ['targetRef']);
        expectInvalidMergeReviewOptions(malformedDetail, 'getMergeConflictDetail', [
          'expectedConflictDigest',
        ]);
        expectInvalidMergeReviewRequest(malformedSave, 'saveMergeResolutions');
        expectInvalidMergeReviewOptions(malformedPayload, 'putMergeResolutionPayload', [
          'expectedConflictDigest',
        ]);
        expectNoDiagnosticLeaks(
          [malformedDetail, malformedSave, malformedPayload],
          [malformedDetailDigest, malformedResolutionDigest],
        );
      },
    );
  });
}
