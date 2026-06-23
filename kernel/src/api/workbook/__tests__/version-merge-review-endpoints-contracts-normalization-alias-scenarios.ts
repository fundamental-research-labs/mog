import {
  conflictDigestObject,
  expectInvalidMergeReviewOptions,
  expectNoDiagnosticLeaks,
  requireResolutionOption,
  TARGET_REF,
  withReviewArtifact,
} from './version-merge-review-endpoints-contracts-test-utils';

export function registerMergeReviewEndpointContractsNormalizationAliasScenarios(): void {
  it('rejects unknown valueRole and purpose aliases during normalization', async () => {
    await withReviewArtifact('normalization-aliases', async ({ version, preview, target }) => {
      const conflict = preview.conflicts[0];
      const option = requireResolutionOption(conflict, 'acceptTheirs');
      const detail = await version.getMergeConflictDetail({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
        valueRole: 'incoming' as any,
        purpose: 'reviewValue' as any,
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
        purpose: 'choose-value' as any,
      });

      expectInvalidMergeReviewOptions(detail, 'getMergeConflictDetail', ['valueRole', 'purpose']);
      expectInvalidMergeReviewOptions(payload, 'putMergeResolutionPayload', ['purpose']);
      expectNoDiagnosticLeaks([detail, payload], ['incoming', 'reviewValue', 'choose-value']);
    });
  });
}
