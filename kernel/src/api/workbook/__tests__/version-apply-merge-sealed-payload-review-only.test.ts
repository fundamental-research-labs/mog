import {
  expectResolutionSetArtifactMissing,
  expectStableResolutionMismatchDiagnostics,
  putResolutionPayload,
  requireResolutionOption,
  resolutionFor,
  withPersistedConflictPreview,
} from './version-apply-merge-sealed-payload-test-utils';

describe('WorkbookVersion sealed payload review-only saves', () => {
  it('rejects sealed payload refs when a targeted save remains review-only', async () => {
    await withPersistedConflictPreview(
      'reject-review-only-sealed-ref',
      async ({ provider, graphId, documentScope, sourceWb, preview, expectedTargetHead }) => {
        expect(preview.conflicts.length).toBeGreaterThan(1);
        const conflict = preview.conflicts[0];
        const option = requireResolutionOption(conflict, 'acceptTheirs');
        const payload = await putResolutionPayload({
          sourceWb,
          preview,
          conflict,
          option,
          expectedTargetHead,
          redactionPolicyDigest: preview.resultDigest,
          value: option.value as any,
          purpose: 'chooseValue',
        });
        const resolution = {
          ...resolutionFor(conflict, 'acceptTheirs'),
          sealedPayloadRef: payload,
        };

        const reviewOnlySaved = await sourceWb.version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          resolutions: [resolution],
        });
        expect(reviewOnlySaved).toMatchObject({
          ok: false,
          error: {
            code: 'target_unavailable',
            target: 'workbook.version.saveMergeResolutions',
          },
        });
        if (reviewOnlySaved.ok) throw new Error('expected review-only sealed save rejection');
        expectStableResolutionMismatchDiagnostics({
          diagnostics: reviewOnlySaved.error.diagnostics,
          operation: 'saveMergeResolutions',
          messages: ['review-only merge attempts cannot save sealed resolution payload refs.'],
          leakCanaries: [conflict.conflictId, conflict.conflictDigest, option.optionId, 'theirs'],
        });

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
            target: 'workbook.version.saveMergeResolutions',
          },
        });
        if (saved.ok) throw new Error('expected sealed resolution save to be rejected');
        expectStableResolutionMismatchDiagnostics({
          diagnostics: saved.error.diagnostics,
          operation: 'saveMergeResolutions',
          messages: ['review-only merge attempts cannot save sealed resolution payload refs.'],
          leakCanaries: [conflict.conflictId, conflict.conflictDigest, option.optionId, 'theirs'],
        });

        await expectResolutionSetArtifactMissing({
          provider,
          graphId,
          documentScope,
          resolutions: [resolution],
        });
      },
      {},
      ['A1', 'B1'],
    );
  });
});
