import {
  TARGET_REF,
  resolutionFor,
  withReviewArtifact,
} from './version-merge-conflict-detail-authorization-test-utils';

export function registerSavedResolutionReviewOnlyApplyScenarios(): void {
  it('denies applying review-only saved resolution artifacts without replayable resolutions', async () => {
    let mergeCommitCallCount = 0;
    await withReviewArtifact(
      'review-only-apply-denial',
      async ({ version, preview, target }) => {
        const conflict = preview.conflicts[0];
        const saved = await version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          resolutions: [resolutionFor(conflict, 'acceptTheirs')],
        });
        if (!saved.ok || !saved.value.resolutionSetDigest) {
          throw new Error('expected review-only saved resolution artifact');
        }
        expect(saved.value).toMatchObject({ attemptKind: 'reviewOnly' });

        const applied = await version.applyMerge(
          {
            resultId: preview.resultId,
            resultDigest: preview.resultDigest,
            resolutionSetDigest: saved.value.resolutionSetDigest,
          },
          { targetRef: TARGET_REF, expectedTargetHead: target },
        );

        expect(applied).toMatchObject({
          ok: false,
          error: {
            target: 'workbook.version.applyMerge',
            diagnostics: [
              expect.objectContaining({
                code: 'VERSION_MERGE_RESOLUTION_MISMATCH',
                message: 'applyMerge apply mode requires resolutions for conflicted previews.',
              }),
            ],
          },
        });
        expect(mergeCommitCallCount).toBe(0);
      },
      {
        versioning: {
          applyMergeService: {
            mergeCommit: async () => {
              mergeCommitCallCount += 1;
            },
          },
        },
      },
    );
  });
}
