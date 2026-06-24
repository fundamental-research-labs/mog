import type {
  VersionMergeConflict,
  VersionMergeConflictResolutionOption,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import type { VersionMergePublicOperation } from '../merge/version-merge-capability';
import {
  addConflictRequestAlias,
  addOptionRequestAlias,
  compareNormalizedMergeReviewConflicts,
  shouldAddOriginalConflictAlias,
  shouldAddOriginalOptionAlias,
} from './version-merge-review-conflicts-keys';
import { normalizeMergeReviewConflict } from './version-merge-review-conflicts-normalization';
import { invalidPreviewArtifactDiagnostic } from './version-merge-review-artifacts';

export type NormalizedMergeReviewConflictSet = {
  readonly conflicts: readonly VersionMergeConflict[];
  readonly conflictsByRequestKey: ReadonlyMap<string, VersionMergeConflict>;
  readonly optionsByRequestKey: ReadonlyMap<string, VersionMergeConflictResolutionOption>;
};

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
