import type { VersionMergeResultId } from '@mog-sdk/contracts/api';

import {
  conflictDigestObject,
  expectInvalidMergeReviewOptions,
  expectInvalidMergeReviewRequest,
  expectMergeReviewFailure,
  expectNoDiagnosticLeaks,
  requireResolutionOption,
  resolutionFor,
  TARGET_REF,
  withReviewArtifact,
} from './version-merge-review-endpoints-contracts-test-utils';

describe('WorkbookVersion merge review endpoint request contracts', () => {
  it('rejects result id and digest mismatches for every review endpoint', async () => {
    await withReviewArtifact('result-id-digest-mismatch', async ({ version, preview, target }) => {
      const conflict = preview.conflicts[0];
      const option = requireResolutionOption(conflict, 'acceptTheirs');
      const mismatchedResultId = `merge-result:${'0'.repeat(64)}` as VersionMergeResultId;
      const base = {
        resultId: mismatchedResultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
      };

      const detail = await version.getMergeConflictDetail({
        ...base,
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
        valueRole: 'theirs',
        purpose: 'review',
      });
      const saved = await version.saveMergeResolutions({
        ...base,
        targetRef: TARGET_REF,
        expectedTargetHead: target,
        resolutions: [resolutionFor(conflict, 'acceptTheirs')],
      });
      const payload = await version.putMergeResolutionPayload({
        ...base,
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
        optionId: option.optionId,
        kind: option.kind,
        targetRef: TARGET_REF,
        expectedTargetHead: target,
        value: option.value as any,
        purpose: 'chooseValue',
      });

      for (const [result, operation] of [
        [detail, 'getMergeConflictDetail'],
        [saved, 'saveMergeResolutions'],
        [payload, 'putMergeResolutionPayload'],
      ] as const) {
        expectMergeReviewFailure(result, operation, 'VERSION_MERGE_RESOLUTION_MISMATCH');
      }
    });
  });

  it('rejects partial target proof and malformed conflict digests during normalization', async () => {
    await withReviewArtifact('normalization-target-digest', async ({ version, preview, target }) => {
      const conflict = preview.conflicts[0];
      const option = requireResolutionOption(conflict, 'acceptTheirs');
      const malformedDetailDigest = 'sha256:not-a-digest-sk_live_detail_secret';
      const malformedResolutionDigest = 'sha256:not-a-digest-sk_live_resolution_secret';

      const partialTarget = await version.getMergeConflictDetail({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
        valueRole: 'theirs',
        purpose: 'review',
        targetRef: TARGET_REF,
      });
      const malformedDetail = await version.getMergeConflictDetail({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        conflictId: conflict.conflictId,
        expectedConflictDigest: malformedDetailDigest as any,
        valueRole: 'theirs',
        purpose: 'review',
      });
      const malformedSave = await version.saveMergeResolutions({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        targetRef: TARGET_REF,
        expectedTargetHead: target,
        resolutions: [
          {
            ...resolutionFor(conflict, 'acceptTheirs'),
            expectedConflictDigest: malformedResolutionDigest,
          },
        ],
      });
      const malformedPayload = await version.putMergeResolutionPayload({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        conflictId: conflict.conflictId,
        expectedConflictDigest: malformedDetailDigest as any,
        optionId: option.optionId,
        kind: option.kind,
        targetRef: TARGET_REF,
        expectedTargetHead: target,
        value: option.value as any,
        purpose: 'chooseValue',
      });

      expectInvalidMergeReviewOptions(partialTarget, 'getMergeConflictDetail', ['targetRef']);
      expectInvalidMergeReviewOptions(malformedDetail, 'getMergeConflictDetail', [
        'expectedConflictDigest',
      ]);
      expectInvalidMergeReviewRequest(malformedSave, 'saveMergeResolutions');
      expectInvalidMergeReviewOptions(malformedPayload, 'putMergeResolutionPayload', [
        'expectedConflictDigest',
      ]);
      expectNoDiagnosticLeaks(
        [malformedDetail, malformedSave, malformedPayload],
        [malformedDetailDigest, malformedResolutionDigest],
      );
    });
  });

  it('rejects unknown valueRole and purpose aliases during normalization', async () => {
    await withReviewArtifact('normalization-aliases', async ({ version, preview, target }) => {
      const conflict = preview.conflicts[0];
      const option = requireResolutionOption(conflict, 'acceptTheirs');
      const detail = await version.getMergeConflictDetail({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
        valueRole: 'incoming' as any,
        purpose: 'reviewValue' as any,
      });
      const payload = await version.putMergeResolutionPayload({
        resultId: preview.resultId,
        resultDigest: preview.resultDigest,
        redactionPolicyDigest: preview.resultDigest,
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
        optionId: option.optionId,
        kind: option.kind,
        targetRef: TARGET_REF,
        expectedTargetHead: target,
        value: option.value as any,
        purpose: 'choose-value' as any,
      });

      expectInvalidMergeReviewOptions(detail, 'getMergeConflictDetail', ['valueRole', 'purpose']);
      expectInvalidMergeReviewOptions(payload, 'putMergeResolutionPayload', ['purpose']);
      expectNoDiagnosticLeaks([detail, payload], ['incoming', 'reviewValue', 'choose-value']);
    });
  });

  it('rejects ancestry-only merge artifacts across review endpoints', async () => {
    await withReviewArtifact(
      'ancestry-artifact',
      async ({ version, preview, target }) => {
        const conflict = preview.conflicts[0];
        const option = requireResolutionOption(conflict, 'acceptTheirs');
        const detail = await version.getMergeConflictDetail({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
          valueRole: 'theirs',
          purpose: 'review',
        });
        const saved = await version.saveMergeResolutions({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          targetRef: TARGET_REF,
          expectedTargetHead: target,
          resolutions: [resolutionFor(conflict, 'acceptTheirs')],
        });
        const payload = await version.putMergeResolutionPayload({
          resultId: preview.resultId,
          resultDigest: preview.resultDigest,
          redactionPolicyDigest: preview.resultDigest,
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflictDigestObject(conflict.conflictDigest),
          optionId: option.optionId,
          kind: option.kind,
          targetRef: TARGET_REF,
          expectedTargetHead: target,
          value: option.value as any,
          purpose: 'chooseValue',
        });

        for (const [result, operation] of [
          [detail, 'getMergeConflictDetail'],
          [saved, 'saveMergeResolutions'],
          [payload, 'putMergeResolutionPayload'],
        ] as const) {
          expectMergeReviewFailure(result, operation, 'VERSION_MERGE_RESOLUTION_MISMATCH');
        }
      },
      { status: 'fastForward' },
    );
  });
});
