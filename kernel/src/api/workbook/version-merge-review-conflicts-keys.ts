import type {
  VersionMergeConflict,
  VersionMergeConflictResolutionOption,
  VersionMergeConflictResolutionOptionKind,
} from '@mog-sdk/contracts/api';

export function compareNormalizedMergeReviewConflicts(
  left: VersionMergeConflict,
  right: VersionMergeConflict,
): number {
  return compareStrings(
    [left.conflictId, left.conflictDigest].join('\u0000'),
    [right.conflictId, right.conflictDigest].join('\u0000'),
  );
}

export function conflictRequestKey(conflictId: string, conflictDigest: string): string {
  return `${conflictId}\u0000${conflictDigest}`;
}

export function shouldAddOriginalConflictAlias(
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

export function addConflictRequestAlias(
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

export function optionRequestKey(
  conflictId: string,
  optionId: string,
  kind: VersionMergeConflictResolutionOptionKind,
): string {
  return `${conflictId}\u0000${optionId}\u0000${kind}`;
}

export function shouldAddOriginalOptionAlias(originalOptionId: string, optionId: string): boolean {
  return originalOptionId === optionId || !isStableOptionId(originalOptionId);
}

export function addOptionRequestAlias(
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
