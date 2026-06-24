import type {
  VersionApplyMergeResolution,
  VersionMergeChange,
  VersionMergeConflict,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import type { MergePreviewArtifactPayload } from '../../../../../document/version-store/merge-attempt-artifacts';
import type { ObjectDigest as InternalObjectDigest } from '../../../../../document/version-store/object-digest';
import type {
  NormalizedPersistedApplyMergeInput,
  NormalizedPersistedApplyMergeOptions,
} from '../version-apply-merge-persisted';
import { resolutionMismatchDiagnostic } from './version-apply-merge-persisted-artifact-diagnostics';
import {
  digestsEqual,
  isInternalSha256Digest,
} from './version-apply-merge-persisted-artifact-sealed-payload';

type ResolutionPlanResult =
  | {
      readonly ok: true;
      readonly changes: readonly VersionMergeChange[];
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

export function validatePreviewDigestInput(
  input: NormalizedPersistedApplyMergeInput,
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (
    input.previewArtifactDigest &&
    !digestsEqual(input.previewArtifactDigest, input.resultDigest)
  ) {
    diagnostics.push(
      resolutionMismatchDiagnostic(
        'persisted merge previewArtifactDigest does not match resultDigest.',
      ),
    );
  }
  if (!isInternalSha256Digest(input.resultDigest)) {
    diagnostics.push(
      resolutionMismatchDiagnostic('persisted merge resultDigest is not a merge-preview digest.'),
    );
  }
  if (input.previewArtifactDigest && !isInternalSha256Digest(input.previewArtifactDigest)) {
    diagnostics.push(
      resolutionMismatchDiagnostic(
        'persisted merge previewArtifactDigest is not a merge-preview digest.',
      ),
    );
  }
  return diagnostics;
}

export function planPreviewArtifactApply(
  payload: MergePreviewArtifactPayload,
  resolutions: readonly VersionApplyMergeResolution[],
): ResolutionPlanResult {
  if (payload.status === 'clean') {
    if (resolutions.length > 0) {
      return {
        ok: false,
        diagnostics: [
          resolutionMismatchDiagnostic('clean merge preview artifacts do not accept resolutions.'),
        ],
      };
    }
    if (payload.conflicts.length > 0) {
      return {
        ok: false,
        diagnostics: [
          resolutionMismatchDiagnostic('clean merge preview artifacts must not contain conflicts.'),
        ],
      };
    }
    return { ok: true, changes: [] };
  }

  if (payload.status === 'conflicted') {
    if (resolutions.length === 0) {
      return {
        ok: false,
        diagnostics: [
          resolutionMismatchDiagnostic(
            'applyMerge apply mode requires resolutions for conflicted previews.',
          ),
        ],
      };
    }
    return planResolvedConflicts(payload.conflicts, resolutions);
  }

  return {
    ok: false,
    diagnostics: [
      resolutionMismatchDiagnostic(
        'persisted merge preview artifact is not a review-only applyable result.',
      ),
    ],
  };
}

export function validatePreviewArtifactForApply(
  payload: MergePreviewArtifactPayload,
  options: Extract<NormalizedPersistedApplyMergeOptions, { readonly mode: 'apply' }>,
): readonly VersionStoreDiagnostic[] {
  if (options.expectedTargetHead.commitId === payload.ours) return [];
  return [
    resolutionMismatchDiagnostic('applyMerge expectedTargetHead must match the ours commit.'),
  ];
}

export function validateResolvedAttemptDigests(
  input: NormalizedPersistedApplyMergeInput,
  expected: {
    readonly resolutionSetDigest: InternalObjectDigest;
    readonly resolvedAttemptDigest: InternalObjectDigest;
  },
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (
    input.resolutionSetDigest &&
    !digestsEqual(input.resolutionSetDigest, expected.resolutionSetDigest)
  ) {
    diagnostics.push(
      resolutionMismatchDiagnostic(
        'persisted merge resolutionSetDigest does not match the resolved artifact.',
      ),
    );
  }
  if (
    input.resolvedAttemptDigest &&
    !digestsEqual(input.resolvedAttemptDigest, expected.resolvedAttemptDigest)
  ) {
    diagnostics.push(
      resolutionMismatchDiagnostic(
        'persisted merge resolvedAttemptDigest does not match the resolved artifact.',
      ),
    );
  }
  return diagnostics;
}

function planResolvedConflicts(
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
