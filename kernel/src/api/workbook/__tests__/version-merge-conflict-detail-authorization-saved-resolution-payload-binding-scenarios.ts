import {
  TARGET_REF,
  expectDiagnosticMessages,
  expectMergeReviewFailure,
  expectNoDiagnosticLeaks,
  mutateDigest,
  putResolutionPayload,
  requireResolutionOption,
  resolutionFor,
  withReviewArtifact,
} from './version-merge-conflict-detail-authorization-test-utils';

export function registerSavedResolutionPayloadBindingScenarios(): void {
  it('rejects sealed payload refs when purpose or redaction access policy does not match', async () => {
    await withReviewArtifact(
      'payload-purpose-access-mismatch',
      async ({ version, preview, target }) => {
        const conflict = preview.conflicts[0];
        const option = requireResolutionOption(conflict, 'acceptTheirs');
        const resolution = resolutionFor(conflict, 'acceptTheirs');

        const customPayload = await putResolutionPayload({
          version,
          preview,
          conflict,
          option,
          redactionPolicyDigest: preview.resultDigest,
          target,
          value: { kind: 'value', value: 'custom' },
          purpose: 'custom',
          domainPayloadSchema: 'w9-06.custom-resolution.v1',
        });
        const customSave = await version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          targetRef: TARGET_REF,
          expectedTargetHead: target,
          resolutions: [{ ...resolution, sealedPayloadRef: customPayload }],
        });
        expectMergeReviewFailure(
          customSave,
          'saveMergeResolutions',
          'VERSION_MERGE_RESOLUTION_MISMATCH',
        );
        expectDiagnosticMessages(customSave, [
          'sealed payload purpose is not executable.',
          'sealed payload value does not match resolution option.',
        ]);

        const chooseValuePayload = await putResolutionPayload({
          version,
          preview,
          conflict,
          option,
          redactionPolicyDigest: preview.resultDigest,
          target,
          value: option.value as any,
          purpose: 'chooseValue',
        });
        const accessMismatchSave = await version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: mutateDigest(preview.resultDigest),
          targetRef: TARGET_REF,
          expectedTargetHead: target,
          resolutions: [{ ...resolution, sealedPayloadRef: chooseValuePayload }],
        });
        expectMergeReviewFailure(
          accessMismatchSave,
          'saveMergeResolutions',
          'VERSION_MERGE_RESOLUTION_MISMATCH',
        );
        expectDiagnosticMessages(accessMismatchSave, [
          'sealed payload object binding does not match.',
        ]);
        expectNoDiagnosticLeaks(accessMismatchSave, [
          conflict.conflictId,
          conflict.conflictDigest,
          option.optionId,
          'theirs',
        ]);
      },
    );
  });
}
