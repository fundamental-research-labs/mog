import { mergeResolutionSetV2ArtifactRef } from '../../../document/version-store/merge-attempt-artifacts';
import { namespaceForDocumentScope } from '../../../document/version-store/provider';
import {
  resolutionFor,
  withPersistedConflictPreview,
} from './version-merge-review-endpoints-test-utils';
import {
  firstPreviewConflict,
  MAIN_TARGET_REF,
  putAcceptTheirsPayload,
} from './version-merge-review-endpoints-payload-helpers';

export function registerMergeReviewEndpointPayloadSaveRefScenario(): void {
  it('persists a verified sealed resolution payload ref in the resolution set', async () => {
    await withPersistedConflictPreview(
      'payload-save-ref',
      async ({ provider, graphId, documentScope, sourceWb, preview, expectedTargetHead }) => {
        const conflict = firstPreviewConflict(preview);
        const { option, payload } = await putAcceptTheirsPayload({
          sourceWb,
          preview,
          conflict,
          expectedTargetHead,
        });

        const resolution = {
          ...resolutionFor(conflict, 'acceptTheirs'),
          sealedPayloadRef: payload,
        };
        const saved = await sourceWb.version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          targetRef: MAIN_TARGET_REF,
          expectedTargetHead,
          resolutions: [resolution],
        });
        if (!saved.ok || !saved.value.resolutionSetDigest) {
          throw new Error('expected sealed payload resolution save success');
        }

        const graph = await provider.openGraph(
          namespaceForDocumentScope(documentScope, graphId),
          provider.accessContext,
        );
        await expect(
          graph.getObjectRecord(mergeResolutionSetV2ArtifactRef(saved.value.resolutionSetDigest)),
        ).resolves.toMatchObject({
          preimage: {
            objectType: 'workbook.mergeResolutionSet.v2',
            payload: {
              schemaVersion: 2,
              recordKind: 'mergeResolutionSet',
              resultId: preview.resultId,
              resultDigest: preview.resultDigest,
              previewArtifactDigest: preview.previewArtifactDigest,
              resolutions: [
                expect.objectContaining({
                  conflictId: conflict.conflictId,
                  optionId: option.optionId,
                  kind: 'acceptTheirs',
                  sealedPayloadRef: payload,
                }),
              ],
            },
          },
        });
      },
    );
  });
}
