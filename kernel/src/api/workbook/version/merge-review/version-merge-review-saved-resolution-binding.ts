import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import type { ResolvedMergeAttemptArtifactPayload } from '../../../../document/version-store/merge-attempt-artifacts';
import type { VersionMergePublicOperation } from '../../version-merge-capability';
import { mergeReviewDiagnostic } from './version-merge-review-artifacts';
import type { NormalizedGetMergeConflictDetailInput } from './version-merge-review-normalization';
import { canonicalJson, digestsEqual } from './version-merge-review-saved-resolution-utils';

export function validateResolvedAttemptBinding(
  operation: VersionMergePublicOperation,
  input: NormalizedGetMergeConflictDetailInput,
  payload: ResolvedMergeAttemptArtifactPayload,
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!digestsEqual(payload.resultDigest, input.resultDigest)) {
    diagnostics.push(
      mergeReviewDiagnostic(
        operation,
        'VERSION_MERGE_RESOLUTION_MISMATCH',
        'resolved merge attempt does not match the merge preview digest.',
      ),
    );
  }
  if (input.targetRef && payload.targetRef !== input.targetRef) {
    diagnostics.push(
      mergeReviewDiagnostic(
        operation,
        'VERSION_MERGE_RESOLUTION_MISMATCH',
        'resolved merge attempt targetRef does not match.',
      ),
    );
  }
  if (
    input.expectedTargetHead &&
    canonicalJson(payload.expectedTargetHead) !== canonicalJson(input.expectedTargetHead)
  ) {
    diagnostics.push(
      mergeReviewDiagnostic(
        operation,
        'VERSION_MERGE_RESOLUTION_MISMATCH',
        'resolved merge attempt expectedTargetHead does not match.',
      ),
    );
  }
  return diagnostics;
}
