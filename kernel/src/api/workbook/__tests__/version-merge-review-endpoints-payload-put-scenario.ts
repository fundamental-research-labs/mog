import { namespaceForDocumentScope } from '../../../document/version-store/provider';
import { withPersistedConflictPreview } from './version-merge-review-endpoints-test-utils';
import {
  acceptTheirsOption,
  firstPreviewConflict,
  mergeResolutionPayloadRequest,
} from './version-merge-review-endpoints-payload-helpers';

export function registerMergeReviewEndpointPayloadPutScenario(): void {
  it('stores a matching sealed resolution payload through the provider graph', async () => {
    await withPersistedConflictPreview(
      'payload-put',
      async ({ provider, graphId, documentScope, sourceWb, preview, expectedTargetHead }) => {
        const conflict = firstPreviewConflict(preview);
        const option = acceptTheirsOption(conflict);
        const request = mergeResolutionPayloadRequest({
          preview,
          conflict,
          option,
          expectedTargetHead,
          value: option.value as any,
        });

        await expect(
          sourceWb.version.putMergeResolutionPayload({
            ...request,
            value: { kind: 'value', value: 'tampered' },
          }),
        ).resolves.toMatchObject({
          ok: false,
          error: {
            diagnostics: [expect.objectContaining({ code: 'VERSION_MERGE_RESOLUTION_MISMATCH' })],
          },
        });

        const put = await sourceWb.version.putMergeResolutionPayload(request);
        if (!put.ok) throw new Error(`expected payload put success: ${put.error.code}`);

        expect(put.value).toMatchObject({
          schemaVersion: 1,
          kind: 'sealedResolutionPayload',
          payloadId: expect.stringMatching(/^merge-payload:[0-9a-f]{64}$/),
          payloadDigest: {
            algorithm: 'sha256',
            digest: expect.stringMatching(/^[0-9a-f]{64}$/),
          },
          storageMode: 'serverEncrypted',
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          optionId: option.optionId,
          resolutionKind: option.kind,
        });
        const graph = await provider.openGraph(
          namespaceForDocumentScope(documentScope, graphId),
          provider.accessContext,
        );
        await expect(
          graph.getObjectRecord({
            kind: 'object',
            objectType: 'workbook.reviewExtension.v1',
            digest: put.value.payloadDigest,
          }),
        ).resolves.toMatchObject({
          preimage: {
            objectType: 'workbook.reviewExtension.v1',
            payload: {
              schemaVersion: 1,
              recordKind: 'mergeResolutionPayload',
              resultId: preview.resultId,
              conflictId: conflict.conflictId,
              optionId: option.optionId,
              purpose: 'chooseValue',
            },
          },
        });
      },
    );
  });
}
