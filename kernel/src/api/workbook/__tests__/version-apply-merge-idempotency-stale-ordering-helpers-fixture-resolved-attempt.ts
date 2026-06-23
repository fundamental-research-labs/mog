import type { VersionApplyMergeResolution } from '@mog-sdk/contracts/api';

import {
  createMergeResolutionSetArtifactRecord,
  createResolvedMergeAttemptArtifactRecord,
} from '../../../document/version-store/merge-attempt-artifacts';
import { idempotencyKeyForResolvedAttempt } from '../../../document/version-store/merge-apply-intent-store';
import type { ObjectDigest } from '../../../document/version-store/object-digest';
import {
  TARGET_REF,
  type CleanReviewFixture,
} from './version-apply-merge-idempotency-stale-ordering-helpers-core';

export async function expectedResolvedAttempt(
  fixture: CleanReviewFixture,
  resolutions: readonly VersionApplyMergeResolution[],
): Promise<{
  readonly resolutionSetDigest: ObjectDigest;
  readonly resolvedAttemptDigest: ObjectDigest;
  readonly idempotencyKey: ReturnType<typeof idempotencyKeyForResolvedAttempt>;
}> {
  const resolutionSet = await createMergeResolutionSetArtifactRecord(
    fixture.namespace,
    resolutions,
  );
  const resolvedAttempt = await createResolvedMergeAttemptArtifactRecord(fixture.namespace, {
    resultDigest: fixture.preview.resultDigest as ObjectDigest,
    resolutionSetDigest: resolutionSet.digest,
    targetRef: TARGET_REF,
    expectedTargetHead: fixture.expectedTargetHead,
  });
  return {
    resolutionSetDigest: resolutionSet.digest,
    resolvedAttemptDigest: resolvedAttempt.digest,
    idempotencyKey: idempotencyKeyForResolvedAttempt({
      resolvedAttemptDigest: resolvedAttempt.digest,
      targetRef: TARGET_REF,
      expectedTargetHead: fixture.expectedTargetHead,
    }),
  };
}
