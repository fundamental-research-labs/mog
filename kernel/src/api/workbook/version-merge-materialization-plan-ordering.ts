import type { ParsedMergeChange } from './version-merge-materialization-plan-types';

export function compareParsedMergeChanges(
  left: ParsedMergeChange,
  right: ParsedMergeChange,
): number {
  return (
    compareStrings(left.structural.domain, right.structural.domain) ||
    compareStrings(left.structural.entityId, right.structural.entityId) ||
    compareStrings(
      left.structural.propertyPath.join('\u0000'),
      right.structural.propertyPath.join('\u0000'),
    ) ||
    compareStrings(left.structural.changeId, right.structural.changeId) ||
    left.itemIndex - right.itemIndex
  );
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
