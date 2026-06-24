import {
  conflictDigestObject,
  expectMergeReviewFailure,
  multiSheetRangeConflicts,
  mutateDigest,
  requireResolutionOption,
  resolutionFor,
  TARGET_REF,
  withReviewArtifact,
} from './version-merge-review-endpoints-contracts-test-utils';

export function registerSavedResolutionArtifactScenarios(): void {
  it('reads resolved conflict detail from saved resolution artifacts', async () => {
    await withReviewArtifact('saved-resolution-readback', async ({ version, preview, target }) => {
      const conflict = preview.conflicts[0];
      const saved = await version.saveMergeResolutions({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        targetRef: TARGET_REF,
        expectedTargetHead: target,
        resolutions: [resolutionFor(conflict, 'acceptTheirs')],
      });
      if (!saved.ok || !saved.value.resolutionSetDigest || !saved.value.resolvedAttemptDigest) {
        throw new Error('expected saved resolution artifact digests');
      }

      const detail = await version.getMergeConflictDetail({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
        valueRole: 'resolved',
        purpose: 'resolution',
        resolutionSetDigest: saved.value.resolutionSetDigest,
        resolvedAttemptDigest: saved.value.resolvedAttemptDigest,
        targetRef: TARGET_REF,
        expectedTargetHead: target,
      });

      expect(detail).toMatchObject({
        ok: true,
        value: {
          schemaVersion: 1,
          kind: 'resolutionPayload',
          valueRole: 'resolved',
          value: { kind: 'value', value: 'theirs' },
        },
      });
    });
  });

  it('saves partial and complete resolutions for multi-sheet range conflicts', async () => {
    const conflicts = multiSheetRangeConflicts();
    await withReviewArtifact(
      'saved-resolution-multi-sheet-ranges',
      async ({ version, preview, target }) => {
        const [alphaRange, betaRange, gammaRange] = preview.conflicts;
        if (!alphaRange || !betaRange || !gammaRange) {
          throw new Error('expected multi-sheet range conflict fixture');
        }

        const partial = await version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          targetRef: TARGET_REF,
          expectedTargetHead: target,
          resolutions: [
            resolutionFor(alphaRange, 'acceptTheirs'),
            resolutionFor(gammaRange, 'acceptBase'),
          ],
        });
        if (!partial.ok || !partial.value.resolutionSetDigest) {
          throw new Error('expected partial saved resolution artifact digest');
        }
        expect(partial.value).toMatchObject({
          schemaVersion: 1,
          kind: 'mergeResolutionsSaved',
          status: 'partiallyResolved',
          attemptKind: 'reviewOnly',
          attemptPersistence: 'persisted',
          savedResolutionCount: 2,
        });
        expect(partial.value.resolvedAttemptDigest).toBeUndefined();

        const saved = await version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          targetRef: TARGET_REF,
          expectedTargetHead: target,
          resolutions: [
            resolutionFor(alphaRange, 'acceptTheirs'),
            resolutionFor(betaRange, 'acceptOurs'),
            resolutionFor(gammaRange, 'acceptBase'),
          ],
        });
        if (!saved.ok || !saved.value.resolutionSetDigest || !saved.value.resolvedAttemptDigest) {
          throw new Error('expected complete saved resolution artifact digests');
        }
        expect(saved.value).toMatchObject({
          schemaVersion: 1,
          kind: 'mergeResolutionsSaved',
          status: 'readyToApply',
          attemptKind: 'applyable',
          attemptPersistence: 'persisted',
          savedResolutionCount: 3,
        });

        for (const [conflict, kind] of [
          [alphaRange, 'acceptTheirs'],
          [betaRange, 'acceptOurs'],
          [gammaRange, 'acceptBase'],
        ] as const) {
          const option = requireResolutionOption(conflict, kind);
          const detail = await version.getMergeConflictDetail({
            resultId: preview.resultId,
            resultDigest: preview.resultDigest,
            redactionPolicyDigest: preview.resultDigest,
            conflictId: conflict.conflictId,
            expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
            valueRole: 'resolved',
            purpose: 'resolution',
            resolutionSetDigest: saved.value.resolutionSetDigest,
            resolvedAttemptDigest: saved.value.resolvedAttemptDigest,
            targetRef: TARGET_REF,
            expectedTargetHead: target,
          });

          expect(detail).toMatchObject({
            ok: true,
            value: {
              schemaVersion: 1,
              kind: 'resolutionPayload',
              valueRole: 'resolved',
              value: option.value,
            },
          });
        }
      },
      { conflicts },
    );
  });

  it('rejects mismatched saved-resolution artifact digests', async () => {
    await withReviewArtifact(
      'saved-resolution-digest-mismatch',
      async ({ version, preview, target }) => {
        const conflict = preview.conflicts[0];
        const saved = await version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          targetRef: TARGET_REF,
          expectedTargetHead: target,
          resolutions: [resolutionFor(conflict, 'acceptTheirs')],
        });
        if (!saved.ok || !saved.value.resolutionSetDigest || !saved.value.resolvedAttemptDigest) {
          throw new Error('expected saved resolution artifact digests');
        }

        const detail = await version.getMergeConflictDetail({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
          valueRole: 'resolved',
          purpose: 'resolution',
          resolutionSetDigest: mutateDigest(saved.value.resolutionSetDigest),
          resolvedAttemptDigest: saved.value.resolvedAttemptDigest,
        });

        expectMergeReviewFailure(
          detail,
          'getMergeConflictDetail',
          'VERSION_MERGE_RESOLUTION_MISMATCH',
        );
      },
    );
  });
}
