import type {
  VersionApplyMergeResolution,
  VersionMergeConflict,
  VersionMergeConflictResolutionOption,
  VersionSaveMergeResolutionsResult,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import type { VersionMergePublicOperation } from '../merge/version-merge-capability';
import type { NormalizedMergeReviewConflictSet } from './version-merge-review-conflicts-set';
import {
  findExpectedConflict,
  findResolutionOptionForConflictSet,
} from './version-merge-review-conflicts-lookup';
import { canonicalJson, projectReviewValue } from './version-merge-review-conflicts-projection';
import { mergeReviewDiagnostic } from './version-merge-review-artifacts';
import { invalidInputDiagnostic } from './version-merge-review-normalization-helpers';
import type { NormalizedPutMergeResolutionPayloadInput } from './version-merge-review-normalization-phases-resolution-payload';

type ResolutionValidationResult =
  | {
      readonly ok: true;
      readonly status: VersionSaveMergeResolutionsResult['status'];
      readonly resolutions: readonly VersionApplyMergeResolution[];
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export function validateResolutionsForConflictSet(
  operation: VersionMergePublicOperation,
  payload: {
    readonly status: 'clean' | 'conflicted';
  },
  conflictSet: NormalizedMergeReviewConflictSet,
  resolutions: readonly VersionApplyMergeResolution[],
): ResolutionValidationResult {
  if (payload.status === 'clean') {
    return resolutions.length === 0
      ? { ok: true, status: 'readyToApply', resolutions: [] }
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

  const seen = new Set<string>();
  const canonicalResolutions: VersionApplyMergeResolution[] = [];
  for (const resolution of resolutions) {
    const conflict = findExpectedConflict(
      operation,
      conflictSet,
      resolution.conflictId,
      resolution.expectedConflictDigest,
    );
    if (!conflict.ok) {
      return conflict;
    }
    if (seen.has(conflict.conflict.conflictId)) {
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
    seen.add(conflict.conflict.conflictId);
    const option = findResolutionOptionForConflictSet(
      conflictSet,
      conflict.conflict,
      resolution.optionId,
      resolution.kind,
    );
    if (!option) {
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
    canonicalResolutions.push({
      ...resolution,
      conflictId: conflict.conflict.conflictId,
      expectedConflictDigest: conflict.conflict.conflictDigest,
      optionId: option.optionId,
      kind: option.kind,
    });
  }

  if (canonicalResolutions.length === 0) {
    return { ok: true, status: 'reviewOnly', resolutions: [] };
  }
  return {
    ok: true,
    status:
      canonicalResolutions.length === conflictSet.conflicts.length
        ? 'readyToApply'
        : 'partiallyResolved',
    resolutions: canonicalResolutions,
  };
}

export function validateResolutionPayloadPurpose(
  conflict: VersionMergeConflict,
  option: VersionMergeConflictResolutionOption,
  input: NormalizedPutMergeResolutionPayloadInput,
): readonly VersionStoreDiagnostic[] {
  if (input.purpose === 'custom') {
    return input.domainPayloadSchema
      ? []
      : [
          invalidInputDiagnostic(
            'putMergeResolutionPayload',
            'domainPayloadSchema',
            'custom resolution payloads require a domainPayloadSchema.',
          ),
        ];
  }

  const projected = projectReviewValue(
    'putMergeResolutionPayload',
    conflict.structural,
    option.value,
  );
  if (!projected.ok) return projected.diagnostics;
  if (canonicalJson(projected.value) === canonicalJson(input.value)) return [];
  return [
    mergeReviewDiagnostic(
      'putMergeResolutionPayload',
      'VERSION_MERGE_RESOLUTION_MISMATCH',
      'chooseValue payload does not match the selected resolution option.',
    ),
  ];
}
