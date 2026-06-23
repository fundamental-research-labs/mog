import type { VersionMergeResultId } from '@mog-sdk/contracts/api';

import {
  conflictDigestObject,
  expectMergeReviewFailure,
  requireResolutionOption,
  resolutionFor,
  TARGET_REF,
  withReviewArtifact,
} from './version-merge-review-endpoints-contracts-test-utils';

export function registerMergeReviewEndpointContractsResultIdDigestMismatchScenarios(): void {
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
}
