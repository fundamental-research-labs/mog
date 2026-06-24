import {
  mergeResolutionSetV2ArtifactRef,
  resolvedMergeAttemptArtifactRef,
} from '../../../document/version-store/merge-attempt-artifacts';
import { namespaceForDocumentScope } from '../../../document/version-store/provider';
import {
  resolutionFor,
  withPersistedConflictPreview,
} from './version-merge-review-endpoints-test-utils';

export function registerMergeReviewEndpointResolutionScenarios(): void {
  it('persists saved resolutions as resolution-set and resolved-attempt artifacts', async () => {
    await withPersistedConflictPreview(
      'save-persistence',
      async ({ provider, graphId, documentScope, sourceWb, preview, expectedTargetHead }) => {
        const conflict = preview.conflicts[0];
        const resolution = resolutionFor(conflict, 'acceptTheirs');

        const saved = await sourceWb.version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
          resolutions: [resolution],
        });
        if (!saved.ok || !saved.value.resolutionSetDigest || !saved.value.resolvedAttemptDigest) {
          throw new Error('expected saved merge resolutions to expose artifact digests');
        }
        expect(saved.value).toMatchObject({
          schemaVersion: 1,
          kind: 'mergeResolutionsSaved',
          status: 'readyToApply',
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          attemptKind: 'applyable',
          attemptPersistence: 'persisted',
          targetRef: 'refs/heads/main',
          savedResolutionCount: 1,
        });

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
              resolutions: [resolution],
            },
          },
        });
        await expect(
          graph.getObjectRecord(resolvedMergeAttemptArtifactRef(saved.value.resolvedAttemptDigest)),
        ).resolves.toMatchObject({
          preimage: {
            objectType: 'workbook.resolvedMergeAttempt.v1',
            payload: {
              schemaVersion: 1,
              recordKind: 'resolvedMergeAttempt',
              resultDigest: preview.resultDigest,
              resolutionSetDigest: saved.value.resolutionSetDigest,
              targetRef: 'refs/heads/main',
              expectedTargetHead,
            },
          },
        });
      },
    );
  });
}
