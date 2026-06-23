import { mergeResolutionSetArtifactRef } from '../../../document/version-store/merge-attempt-artifacts';
import { namespaceForDocumentScope } from '../../../document/version-store/provider';
import {
  conflictDigestObject,
  resolutionFor,
  withPersistedConflictPreview,
} from './version-merge-review-endpoints-test-utils';

export function registerMergeReviewEndpointPayloadScenarios(): void {
  it('stores a matching sealed resolution payload through the provider graph', async () => {
    await withPersistedConflictPreview(
      'payload-put',
      async ({ provider, graphId, documentScope, sourceWb, preview, expectedTargetHead }) => {
        const conflict = preview.conflicts[0];
        const option = conflict.resolutionOptions.find(
          (candidate) => candidate.kind === 'acceptTheirs',
        );
        if (!option) throw new Error('expected acceptTheirs option');
        const request = {
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
          optionId: option.optionId,
          kind: option.kind,
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
          purpose: 'chooseValue',
        };

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

        const put = await sourceWb.version.putMergeResolutionPayload({
          ...request,
          value: option.value as any,
        });
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

  it('persists a verified sealed resolution payload ref in the resolution set', async () => {
    await withPersistedConflictPreview(
      'payload-save-ref',
      async ({ provider, graphId, documentScope, sourceWb, preview, expectedTargetHead }) => {
        const conflict = preview.conflicts[0];
        const option = conflict.resolutionOptions.find(
          (candidate) => candidate.kind === 'acceptTheirs',
        );
        if (!option) throw new Error('expected acceptTheirs option');
        const payload = await sourceWb.version.putMergeResolutionPayload({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
          optionId: option.optionId,
          kind: option.kind,
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
          value: option.value as any,
          purpose: 'chooseValue',
        });
        if (!payload.ok) throw new Error(`expected payload put success: ${payload.error.code}`);

        const resolution = {
          ...resolutionFor(conflict, 'acceptTheirs'),
          sealedPayloadRef: payload.value,
        };
        const saved = await sourceWb.version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          targetRef: 'refs/heads/main' as any,
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
          graph.getObjectRecord(mergeResolutionSetArtifactRef(saved.value.resolutionSetDigest)),
        ).resolves.toMatchObject({
          preimage: {
            objectType: 'workbook.mergeResolutionSet.v1',
            payload: {
              resolutions: [
                expect.objectContaining({
                  conflictId: conflict.conflictId,
                  optionId: option.optionId,
                  kind: 'acceptTheirs',
                  sealedPayloadRef: payload.value,
                }),
              ],
            },
          },
        });
      },
    );
  });

  it('fails closed when a saved resolution references a missing sealed payload object', async () => {
    await withPersistedConflictPreview(
      'payload-save-missing-ref',
      async ({ sourceWb, preview, expectedTargetHead }) => {
        const conflict = preview.conflicts[0];
        const option = conflict.resolutionOptions.find(
          (candidate) => candidate.kind === 'acceptTheirs',
        );
        if (!option) throw new Error('expected acceptTheirs option');
        const payload = await sourceWb.version.putMergeResolutionPayload({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
          optionId: option.optionId,
          kind: option.kind,
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
          value: option.value as any,
          purpose: 'chooseValue',
        });
        if (!payload.ok) throw new Error(`expected payload put success: ${payload.error.code}`);
        const missingDigest = { algorithm: 'sha256', digest: 'f'.repeat(64) } as const;
        const resolution = {
          ...resolutionFor(conflict, 'acceptTheirs'),
          sealedPayloadRef: {
            ...payload.value,
            payloadId: `merge-payload:${missingDigest.digest}` as const,
            payloadDigest: missingDigest,
          },
        };

        const saved = await sourceWb.version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          targetRef: 'refs/heads/main' as any,
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
