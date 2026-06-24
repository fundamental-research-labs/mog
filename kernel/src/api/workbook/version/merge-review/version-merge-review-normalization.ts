import type {
  VersionApplyMergeResolution,
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionMergeConflict,
  VersionRefName,
  VersionSaveMergeResolutionsResult,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import type { VersionMergePublicOperation } from '../merge/version-merge-capability';
import { mergeReviewDiagnostic } from './version-merge-review-artifacts';
import {
  cloneJson,
  findResolutionOption,
  invalidInputDiagnostic,
} from './version-merge-review-normalization-helpers';

export { cloneJson, invalidInputDiagnostic };
export {
  normalizeGetMergeConflictDetailInput,
  normalizePutMergeResolutionPayloadInput,
  normalizeSaveMergeResolutionsInput,
} from './version-merge-review-normalization-phases';
export type {
  NormalizedGetMergeConflictDetailInput,
  NormalizedPutMergeResolutionPayloadInput,
  NormalizedSaveMergeResolutionsInput,
} from './version-merge-review-normalization-phases';

type ResolutionValidationResult =
  | {
      readonly ok: true;
      readonly status: VersionSaveMergeResolutionsResult['status'];
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export function validateOptionalTarget(
  operation: VersionMergePublicOperation,
  ours: VersionCommitExpectedHead['commitId'],
  targetRef: VersionMainRefName | VersionRefName | undefined,
  expectedTargetHead: VersionCommitExpectedHead | undefined,
): readonly VersionStoreDiagnostic[] {
  if (!targetRef && !expectedTargetHead) return [];
  if (!targetRef || !expectedTargetHead) {
    return [
      invalidInputDiagnostic(
        operation,
        'targetRef',
        'targetRef and expectedTargetHead must be supplied together.',
      ),
    ];
  }
  return validateRequiredTarget(operation, ours, targetRef, expectedTargetHead);
}

export function validateRequiredTarget(
  operation: VersionMergePublicOperation,
  ours: VersionCommitExpectedHead['commitId'],
  _targetRef: VersionMainRefName | VersionRefName,
  expectedTargetHead: VersionCommitExpectedHead,
): readonly VersionStoreDiagnostic[] {
  if (expectedTargetHead.commitId === ours) return [];
  return [
    mergeReviewDiagnostic(
      operation,
      'VERSION_MERGE_RESOLUTION_MISMATCH',
      'expectedTargetHead must match the merge preview ours commit.',
    ),
  ];
}

export function validateResolutionsForPreview(
  operation: VersionMergePublicOperation,
  payload: {
    readonly status: 'clean' | 'conflicted';
    readonly conflicts: readonly VersionMergeConflict[];
  },
  resolutions: readonly VersionApplyMergeResolution[],
): ResolutionValidationResult {
  if (payload.status === 'clean') {
    return resolutions.length === 0
      ? { ok: true, status: 'readyToApply' }
      : {
          ok: false,
          diagnostics: [
            mergeReviewDiagnostic(
              operation,
              'VERSION_MERGE_RESOLUTION_MISMATCH',
              'clean merge preview artifacts do not accept resolutions.',
            ),
          ],
        };
  }

  const conflictsById = new Map(
    payload.conflicts.map((conflict) => [conflict.conflictId, conflict]),
  );
  const seen = new Set<string>();
  for (const resolution of resolutions) {
    if (seen.has(resolution.conflictId)) {
      return {
        ok: false,
        diagnostics: [
          mergeReviewDiagnostic(
            operation,
            'VERSION_MERGE_RESOLUTION_MISMATCH',
            'duplicate conflict resolution supplied.',
          ),
        ],
      };
    }
    seen.add(resolution.conflictId);
    const conflict = conflictsById.get(resolution.conflictId);
    if (!conflict || resolution.expectedConflictDigest !== conflict.conflictDigest) {
      return {
        ok: false,
        diagnostics: [
          mergeReviewDiagnostic(
            operation,
            'VERSION_MERGE_RESOLUTION_MISMATCH',
            'resolution does not match the merge conflict.',
          ),
        ],
      };
    }
    if (!findResolutionOption(conflict, resolution.optionId, resolution.kind)) {
      return {
        ok: false,
        diagnostics: [
          mergeReviewDiagnostic(
            operation,
            'VERSION_MERGE_RESOLUTION_MISMATCH',
            'resolution option does not match the conflict.',
          ),
        ],
      };
    }
  }

  if (resolutions.length === 0) return { ok: true, status: 'reviewOnly' };
  return {
    ok: true,
    status: resolutions.length === payload.conflicts.length ? 'readyToApply' : 'partiallyResolved',
  };
}
