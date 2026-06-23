import type { LiveRefRecord, TombstoneRefRecord } from './ref-store';

export function compareLiveRefs(left: LiveRefRecord, right: LiveRefRecord): number {
  return compareAscii(left.name, right.name);
}

export function compareTombstoneRefs(left: TombstoneRefRecord, right: TombstoneRefRecord): number {
  const leftDeletedAt = Date.parse(left.deletedAt);
  const rightDeletedAt = Date.parse(right.deletedAt);
  if (leftDeletedAt !== rightDeletedAt) {
    return rightDeletedAt - leftDeletedAt;
  }

  const nameCompare = compareAscii(left.name, right.name);
  if (nameCompare !== 0) {
    return nameCompare;
  }

  return compareCounterValues(left.refVersion.value, right.refVersion.value);
}

export function compareAscii(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareCounterValues(left: string, right: string): number {
  const trimmedLeft = left.replace(/^0+(?=\d)/, '');
  const trimmedRight = right.replace(/^0+(?=\d)/, '');
  if (trimmedLeft.length !== trimmedRight.length) {
    return trimmedLeft.length - trimmedRight.length;
  }
  return compareAscii(trimmedLeft, trimmedRight);
}
