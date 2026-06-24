import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import type { VersionMergePublicOperation } from '../merge/version-merge-capability';
import { mergeReviewDiagnostic } from './version-merge-review-artifacts';

export function invalidReviewArtifactDiagnostic(
  operation: VersionMergePublicOperation,
  safeMessage: string,
): VersionStoreDiagnostic {
  return mergeReviewDiagnostic(operation, 'VERSION_INVALID_COMMIT_PAYLOAD', safeMessage, {
    recoverability: 'repair',
  });
}

export function invalidArtifactDigestDiagnostic(
  operation: VersionMergePublicOperation,
  option: string,
): VersionStoreDiagnostic {
  return mergeReviewDiagnostic(
    operation,
    'VERSION_INVALID_OPTIONS',
    `${option} must be a sha256 merge review artifact digest.`,
    { payload: { option } },
  );
}
