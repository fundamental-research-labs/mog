import {
  resolutionFor,
  withPersistedConflictPreview,
} from './version-merge-review-endpoints-test-utils';
import {
  firstPreviewConflict,
  MAIN_TARGET_REF,
  putAcceptTheirsPayload,
} from './version-merge-review-endpoints-payload-helpers';

export function registerMergeReviewEndpointPayloadMissingRefScenario(): void {
  it('fails closed when a saved resolution references a missing sealed payload object', async () => {
    await withPersistedConflictPreview(
      'payload-save-missing-ref',
      async ({ sourceWb, preview, expectedTargetHead }) => {
        const conflict = firstPreviewConflict(preview);
        const { payload } = await putAcceptTheirsPayload({
          sourceWb,
          preview,
          conflict,
          expectedTargetHead,
        });
        const missingDigest = { algorithm: 'sha256', digest: 'f'.repeat(64) } as const;
        const resolution = {
          ...resolutionFor(conflict, 'acceptTheirs'),
          sealedPayloadRef: {
            ...payload,
            payloadId: `merge-payload:${missingDigest.digest}` as const,
            payloadDigest: missingDigest,
          },
        };

        const saved = await sourceWb.version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          targetRef: MAIN_TARGET_REF,
          expectedTargetHead,
          resolutions: [resolution],
        });
        expect(saved).toMatchObject({
          ok: false,
          error: {
            code: 'target_unavailable',
            diagnostics: [expect.objectContaining({ code: 'VERSION_MISSING_OBJECT' })],
          },
        });
      },
    );
  });
}
