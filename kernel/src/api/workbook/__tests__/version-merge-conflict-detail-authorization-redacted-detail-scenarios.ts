import {
  conflictDigestObject,
  redactedOptionConflict,
  withReviewArtifact,
} from './version-merge-conflict-detail-authorization-test-utils';

export function registerRedactedDetailValueScenarios(): void {
  describe('redacted detail values', () => {
    it('keeps redacted conflict option values redacted in detail responses', async () => {
      await withReviewArtifact(
        'redacted-option-values',
        async ({ version, preview }) => {
          const conflict = preview.conflicts[0];
          const detail = await version.getMergeConflictDetail({
            resultId: preview.resultId,
            resultDigest: preview.resultDigest,
            redactionPolicyDigest: preview.resultDigest,
            conflictId: conflict.conflictId,
            expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
            valueRole: 'theirs',
            purpose: 'review',
          });
          if (!detail.ok) throw new Error(`expected redacted detail success: ${detail.error.code}`);

          expect(detail.value.value).toEqual({ kind: 'redacted', reason: 'permission-denied' });
          expect(detail.value.resolutionOptions).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                kind: 'acceptTheirs',
                value: { kind: 'redacted', reason: 'permission-denied' },
              }),
            ]),
          );
        },
        { conflicts: [redactedOptionConflict()] },
      );
    });
  });
}
