import type { VersionRef } from '@mog-sdk/contracts/api';

import type { VersionMergeTarget } from './merge';

export function firstDisabledAvailability<T extends { readonly enabled: boolean }>(
  ...availabilities: readonly (T & { readonly disabledReason?: string })[]
): T & { readonly disabledReason?: string } {
  return availabilities.find((availability) => !availability.enabled) ?? availabilities[0]!;
}

export function mergeTargetsMatch(
  current: VersionMergeTarget | undefined,
  expected: VersionMergeTarget,
): boolean {
  return (
    current !== undefined &&
    current.commitId === expected.commitId &&
    (current.refName ?? undefined) === (expected.refName ?? undefined)
  );
}

export function mergeSourcesMatch(current: VersionRef | undefined, expected: VersionRef): boolean {
  return (
    current !== undefined &&
    current.name === expected.name &&
    current.commitId === expected.commitId
  );
}
