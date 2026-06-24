import type {
  VersionApplyMergeResolution,
  VersionMergeChange,
  VersionMergeConflict,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import { resolutionMismatchDiagnostic } from './version-apply-merge-results';

export type ResolutionPlanResult =
  | {
      readonly ok: true;
      readonly changes: readonly VersionMergeChange[];
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

export function planResolvedConflicts(
  conflicts: readonly VersionMergeConflict[],
  resolutions: readonly VersionApplyMergeResolution[],
): ResolutionPlanResult {
  if (resolutions.length !== conflicts.length) {
    return {
      ok: false,
      diagnostics: [
        resolutionMismatchDiagnostic(
          'applyMerge preview requires exactly one resolution per conflict.',
        ),
      ],
    };
  }

  const conflictsById = new Map(conflicts.map((conflict) => [conflict.conflictId, conflict]));
  const seenConflictIds = new Set<string>();
  const changes: VersionMergeChange[] = [];

  for (const resolution of resolutions) {
    if (seenConflictIds.has(resolution.conflictId)) {
      return {
        ok: false,
        diagnostics: [resolutionMismatchDiagnostic('duplicate conflict resolution supplied.')],
      };
    }
    seenConflictIds.add(resolution.conflictId);

    const conflict = conflictsById.get(resolution.conflictId);
    if (!conflict || resolution.expectedConflictDigest !== conflict.conflictDigest) {
      return {
        ok: false,
        diagnostics: [
          resolutionMismatchDiagnostic('resolution does not match the merge conflict.'),
        ],
      };
    }

    const option = conflict.resolutionOptions.find(
      (candidate) =>
        candidate.optionId === resolution.optionId && candidate.kind === resolution.kind,
    );
    if (!option) {
      return {
        ok: false,
        diagnostics: [
          resolutionMismatchDiagnostic('resolution option does not match the conflict.'),
        ],
      };
    }

    changes.push({
      structural: conflict.structural,
      base: conflict.base,
      ours: conflict.ours,
      theirs: conflict.theirs,
      merged: option.value,
      ...(conflict.display ? { display: conflict.display } : {}),
      ...(option.diagnostics && option.diagnostics.length > 0
        ? { diagnostics: option.diagnostics }
        : {}),
    });
  }

  return { ok: true, changes };
}
