import type {
  VersionDiffValue,
  VersionMergeConflict,
  VersionMergeConflictResolutionOptionKind,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import type { VersionMergePublicOperation } from '../merge/version-merge-capability';
import { findResolutionOptionForConflictSet } from './version-merge-review-conflicts-lookup';
import type { NormalizedMergeReviewConflictSet } from './version-merge-review-conflicts-set';
import { projectReviewValue } from './version-merge-review-conflicts-projection';
import { mergeReviewDiagnostic } from './version-merge-review-artifacts';
import { invalidInputDiagnostic } from './version-merge-review-normalization-helpers';
import type { NormalizedGetMergeConflictDetailInput } from './version-merge-review-normalization-phases-conflict-detail';

type VersionMergeConflictDetailResolutionOption = {
  readonly optionId: string;
  readonly conflictId: string;
  readonly kind: VersionMergeConflictResolutionOptionKind;
  readonly value: VersionDiffValue;
  readonly recalcRequired: boolean;
};

export function selectConflictDetailValue(
  operation: VersionMergePublicOperation,
  conflictSet: NormalizedMergeReviewConflictSet,
  conflict: VersionMergeConflict,
  input: Pick<NormalizedGetMergeConflictDetailInput, 'valueRole' | 'purpose' | 'optionId' | 'kind'>,
):
  | { readonly ok: true; readonly value: VersionDiffValue }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] } {
  switch (input.valueRole) {
    case 'base':
      return authorizeConflictDetailValue(operation, input, conflict.base);
    case 'ours':
      return authorizeConflictDetailValue(operation, input, conflict.ours);
    case 'theirs':
      return authorizeConflictDetailValue(operation, input, conflict.theirs);
    case 'resolved': {
      if (!input.optionId || !input.kind) {
        return {
          ok: false,
          diagnostics: [
            invalidInputDiagnostic(
              operation,
              'optionId',
              'optionId and kind are required for resolved conflict detail values.',
            ),
          ],
        };
      }
      const option = findResolutionOptionForConflictSet(
        conflictSet,
        conflict,
        input.optionId,
        input.kind,
      );
      return option
        ? authorizeConflictDetailValue(operation, input, option.value)
        : {
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
}

export function projectResolutionOptions(
  operation: VersionMergePublicOperation,
  conflict: VersionMergeConflict,
):
  | {
      readonly ok: true;
      readonly options: readonly VersionMergeConflictDetailResolutionOption[];
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] } {
  const options: VersionMergeConflictDetailResolutionOption[] = [];
  for (const option of conflict.resolutionOptions) {
    const value = projectReviewValue(operation, conflict.structural, option.value);
    if (!value.ok) return value;
    options.push({
      optionId: option.optionId,
      conflictId: option.conflictId,
      kind: option.kind,
      value: value.value,
      recalcRequired: option.recalcRequired,
    });
  }
  return { ok: true, options };
}

function authorizeConflictDetailValue(
  operation: VersionMergePublicOperation,
  input: Pick<NormalizedGetMergeConflictDetailInput, 'purpose'>,
  value: VersionDiffValue,
):
  | { readonly ok: true; readonly value: VersionDiffValue }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] } {
  if (input.purpose !== 'resolution' || value.kind !== 'redacted') {
    return { ok: true, value };
  }
  return {
    ok: false,
    diagnostics: [
      mergeReviewDiagnostic(
        operation,
        'VERSION_PERMISSION_DENIED',
        'Redacted conflict values are not authorized as resolution payloads.',
        { recoverability: 'unsupported' },
      ),
    ],
  };
}
