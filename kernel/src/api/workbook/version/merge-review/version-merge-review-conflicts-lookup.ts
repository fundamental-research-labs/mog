import type {
  VersionMergeConflict,
  VersionMergeConflictResolutionOption,
  VersionMergeConflictResolutionOptionKind,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import type { VersionMergePublicOperation } from '../merge/version-merge-capability';
import { conflictRequestKey, optionRequestKey } from './version-merge-review-conflicts-keys';
import type { NormalizedMergeReviewConflictSet } from './version-merge-review-conflicts-set';
import { mergeReviewDiagnostic } from './version-merge-review-artifacts';

export function findExpectedConflict(
  operation: VersionMergePublicOperation,
  conflictSet: NormalizedMergeReviewConflictSet,
  conflictId: string,
  expectedConflictDigest: string,
):
  | { readonly ok: true; readonly conflict: VersionMergeConflict }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] } {
  const conflict = conflictSet.conflictsByRequestKey.get(
    conflictRequestKey(conflictId, expectedConflictDigest),
  );
  if (!conflict) {
    return {
      ok: false,
      diagnostics: [
        mergeReviewDiagnostic(
          operation,
          'VERSION_MERGE_RESOLUTION_MISMATCH',
          'requested conflict does not match the merge preview artifact.',
        ),
      ],
    };
  }
  return { ok: true, conflict };
}

export function findResolutionOptionForConflictSet(
  conflictSet: NormalizedMergeReviewConflictSet,
  conflict: VersionMergeConflict,
  optionId: string,
  kind: VersionMergeConflictResolutionOptionKind,
): VersionMergeConflictResolutionOption | undefined {
  return (
    conflictSet.optionsByRequestKey.get(optionRequestKey(conflict.conflictId, optionId, kind)) ??
    findResolutionOption(conflict, optionId, kind)
  );
}

export function findResolutionOption(
  conflict: VersionMergeConflict,
  optionId: string,
  kind: VersionMergeConflictResolutionOptionKind,
): VersionMergeConflictResolutionOption | undefined {
  return conflict.resolutionOptions.find(
    (candidate) => candidate.optionId === optionId && candidate.kind === kind,
  );
}
