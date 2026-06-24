import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import type { MergeResolutionSetArtifactPayload } from '../../../../document/version-store/merge-attempt-artifacts';
import type { VersionGraphStore } from '../../../../document/version-store/provider-graph-store';
import type { VersionMergePublicOperation } from '../merge/version-merge-capability';
import type { NormalizedMergeReviewConflictSet } from './version-merge-review-conflicts';
import type { NormalizedGetMergeConflictDetailInput } from './version-merge-review-normalization';
import type { SavedResolutionPayloadTarget } from './version-merge-review-saved-resolution-types';
import { validateSealedResolutionPayloadRefs } from './version-merge-sealed-payload';

export async function validateSavedResolutionPayloadRefs(
  graph: VersionGraphStore,
  operation: VersionMergePublicOperation,
  input: NormalizedGetMergeConflictDetailInput,
  attemptTarget: SavedResolutionPayloadTarget | undefined,
  conflictSet: NormalizedMergeReviewConflictSet,
  resolutions: readonly MergeResolutionSetArtifactPayload['resolutions'][number][],
): Promise<readonly VersionStoreDiagnostic[]> {
  if (!resolutions.some((resolution) => resolution.sealedPayloadRef)) return [];
  const target =
    input.targetRef && input.expectedTargetHead
      ? { targetRef: input.targetRef, expectedTargetHead: input.expectedTargetHead }
      : attemptTarget;

  return validateSealedResolutionPayloadRefs({
    graph,
    operation,
    allowExecutablePayloadRefs: true,
    resultId: input.resultId,
    resultDigest: input.resultDigest,
    redactionPolicyDigest: input.redactionPolicyDigest,
    ...(target
      ? { targetRef: target.targetRef, expectedTargetHead: target.expectedTargetHead }
      : {}),
    conflicts: conflictSet.conflicts,
    resolutions,
  });
}
