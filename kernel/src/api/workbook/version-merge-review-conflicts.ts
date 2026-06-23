import type {
  VersionApplyMergeResolution,
  VersionDiffValue,
  VersionMergeConflict,
  VersionMergeConflictResolutionOption,
  VersionMergeConflictResolutionOptionKind,
  VersionSaveMergeResolutionsResult,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import type { VersionMergePublicOperation } from './version-merge-capability';
import { normalizeMergeReviewConflict } from './version-merge-review-conflicts-normalization';
import { canonicalJson, projectReviewValue } from './version-merge-review-conflicts-projection';
import {
  invalidPreviewArtifactDiagnostic,
  mergeReviewDiagnostic,
} from './version-merge-review-artifacts';
import {
  invalidInputDiagnostic,
  type NormalizedGetMergeConflictDetailInput,
  type NormalizedPutMergeResolutionPayloadInput,
} from './version-merge-review-normalization';

export { projectReviewValue } from './version-merge-review-conflicts-projection';

type VersionMergeConflictDetailResolutionOption = {
  readonly optionId: string;
  readonly conflictId: string;
  readonly kind: VersionMergeConflictResolutionOptionKind;
  readonly value: VersionDiffValue;
  readonly recalcRequired: boolean;
};

export type NormalizedMergeReviewConflictSet = {
  readonly conflicts: readonly VersionMergeConflict[];
  readonly conflictsByRequestKey: ReadonlyMap<string, VersionMergeConflict>;
  readonly optionsByRequestKey: ReadonlyMap<string, VersionMergeConflictResolutionOption>;
};

type ResolutionValidationResult =
  | {
      readonly ok: true;
      readonly status: VersionSaveMergeResolutionsResult['status'];
      readonly resolutions: readonly VersionApplyMergeResolution[];
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export async function normalizeMergeReviewConflicts(
  operation: VersionMergePublicOperation,
  conflicts: readonly unknown[],
): Promise<
  | { readonly ok: true; readonly conflictSet: NormalizedMergeReviewConflictSet }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  if (!Array.isArray(conflicts)) {
    return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
  }

  const normalized: VersionMergeConflict[] = [];
  const conflictsByRequestKey = new Map<string, VersionMergeConflict>();
  const optionsByRequestKey = new Map<string, VersionMergeConflictResolutionOption>();
  const conflictIds = new Set<string>();
  const conflictDigests = new Set<string>();
  for (const conflict of conflicts) {
    const mapped = await normalizeMergeReviewConflict(operation, conflict);
    if (!mapped.ok) return mapped;
    if (
      conflictIds.has(mapped.conflict.conflictId) ||
      conflictDigests.has(mapped.conflict.conflictDigest)
    ) {
      return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
    }
    conflictIds.add(mapped.conflict.conflictId);
    conflictDigests.add(mapped.conflict.conflictDigest);
    normalized.push(mapped.conflict);
    if (
      !addConflictRequestAlias(
        conflictsByRequestKey,
        mapped.conflict.conflictId,
        mapped.conflict.conflictDigest,
        mapped.conflict,
      )
    ) {
      return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
    }
    const allowOriginalConflictAlias = shouldAddOriginalConflictAlias(
      mapped.originalConflictId,
      mapped.originalConflictDigest,
      mapped.conflict,
    );
    if (
      allowOriginalConflictAlias &&
      !addConflictRequestAlias(
        conflictsByRequestKey,
        mapped.originalConflictId,
        mapped.originalConflictDigest,
        mapped.conflict,
      )
    ) {
      return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
    }
    for (const option of mapped.conflict.resolutionOptions) {
      if (
        !addOptionRequestAlias(
          optionsByRequestKey,
          mapped.conflict.conflictId,
          option.optionId,
          option.kind,
          option,
        )
      ) {
        return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
      }
      const originalOptionId = mapped.originalOptionIds.get(option.kind);
      if (originalOptionId && shouldAddOriginalOptionAlias(originalOptionId, option.optionId)) {
        if (
          allowOriginalConflictAlias &&
          !addOptionRequestAlias(
            optionsByRequestKey,
            mapped.originalConflictId,
            originalOptionId,
            option.kind,
            option,
          )
        ) {
          return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
        }
        if (
          !addOptionRequestAlias(
            optionsByRequestKey,
            mapped.conflict.conflictId,
            originalOptionId,
            option.kind,
            option,
          )
        ) {
          return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
        }
      }
    }
  }

  return {
    ok: true,
    conflictSet: {
      conflicts: [...normalized].sort(compareNormalizedMergeReviewConflicts),
      conflictsByRequestKey,
      optionsByRequestKey,
    },
  };
}

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

export function findResolutionOption(
  conflict: VersionMergeConflict,
  optionId: string,
  kind: VersionMergeConflictResolutionOptionKind,
): VersionMergeConflictResolutionOption | undefined {
  return conflict.resolutionOptions.find(
    (candidate) => candidate.optionId === optionId && candidate.kind === kind,
  );
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

function compareNormalizedMergeReviewConflicts(
  left: VersionMergeConflict,
  right: VersionMergeConflict,
): number {
  return compareStrings(
    [left.conflictId, left.conflictDigest].join('\u0000'),
    [right.conflictId, right.conflictDigest].join('\u0000'),
  );
}

function conflictRequestKey(conflictId: string, conflictDigest: string): string {
  return `${conflictId}\u0000${conflictDigest}`;
}

function shouldAddOriginalConflictAlias(
  originalConflictId: string,
  originalConflictDigest: string,
  conflict: VersionMergeConflict,
): boolean {
  if (
    originalConflictId === conflict.conflictId &&
    originalConflictDigest === conflict.conflictDigest
  ) {
    return true;
  }
  return !isStableConflictId(originalConflictId);
}

function addConflictRequestAlias(
  aliases: Map<string, VersionMergeConflict>,
  conflictId: string,
  conflictDigest: string,
  conflict: VersionMergeConflict,
): boolean {
  const key = conflictRequestKey(conflictId, conflictDigest);
  const existing = aliases.get(key);
  if (existing && existing !== conflict) return false;
  aliases.set(key, conflict);
  return true;
}

function optionRequestKey(
  conflictId: string,
  optionId: string,
  kind: VersionMergeConflictResolutionOptionKind,
): string {
  return `${conflictId}\u0000${optionId}\u0000${kind}`;
}

function shouldAddOriginalOptionAlias(originalOptionId: string, optionId: string): boolean {
  return originalOptionId === optionId || !isStableOptionId(originalOptionId);
}

function addOptionRequestAlias(
  aliases: Map<string, VersionMergeConflictResolutionOption>,
  conflictId: string,
  optionId: string,
  kind: VersionMergeConflictResolutionOptionKind,
  option: VersionMergeConflictResolutionOption,
): boolean {
  const key = optionRequestKey(conflictId, optionId, kind);
  const existing = aliases.get(key);
  if (existing && existing !== option) return false;
  aliases.set(key, option);
  return true;
}

function isStableConflictId(value: string): boolean {
  return /^conflict:sha256:[0-9a-f]{64}$/.test(value);
}

function isStableOptionId(value: string): boolean {
  return /^option:sha256:[0-9a-f]{64}$/.test(value);
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
