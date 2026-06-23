import type { VersionApplyMergeResolution, VersionMergeConflict } from '@mog-sdk/contracts/api';

export function resolutionFor(
  conflict: VersionMergeConflict,
  kind: VersionApplyMergeResolution['kind'],
): VersionApplyMergeResolution {
  const option = requireResolutionOption(conflict, kind);
  return {
    conflictId: conflict.conflictId,
    expectedConflictDigest: conflict.conflictDigest,
    optionId: option.optionId,
    kind,
  };
}

export function requireResolutionOption(
  conflict: VersionMergeConflict,
  kind: VersionApplyMergeResolution['kind'],
) {
  const option = conflict.resolutionOptions.find((candidate) => candidate.kind === kind);
  if (!option) throw new Error(`expected conflict to expose ${kind} resolution option`);
  return option;
}
