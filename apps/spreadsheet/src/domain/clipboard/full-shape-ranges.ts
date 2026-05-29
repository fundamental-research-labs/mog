import { MAX_COLS, MAX_ROWS, type CellRange } from '@mog-sdk/contracts/core';
import { normalizeRange } from './clipboard-utils';

export function isFullColumnRange(range: CellRange): boolean {
  const normalized = normalizeRange(range);
  return (
    range.isFullColumn === true || (normalized.startRow === 0 && normalized.endRow === MAX_ROWS - 1)
  );
}

export function isFullRowRange(range: CellRange): boolean {
  const normalized = normalizeRange(range);
  return (
    range.isFullRow === true || (normalized.startCol === 0 && normalized.endCol === MAX_COLS - 1)
  );
}

export function isFullShapeRange(range: CellRange): boolean {
  return isFullColumnRange(range) || isFullRowRange(range);
}

export function hasFullShapeIntent(ranges: readonly CellRange[]): boolean {
  return ranges.some(isFullShapeRange);
}

export function isMatchingFullShapePaste(
  sourceRanges: readonly CellRange[] | undefined,
  targetRange: CellRange,
): boolean {
  if (!sourceRanges || sourceRanges.length !== 1) return false;

  const source = normalizeRange(sourceRanges[0]);
  const target = normalizeRange(targetRange);

  if (isFullColumnRange(source) && isFullColumnRange(target)) {
    return rangeWidth(source) === rangeWidth(target);
  }

  if (isFullRowRange(source) && isFullRowRange(target)) {
    return rangeHeight(source) === rangeHeight(target);
  }

  return false;
}

export function isDenseCoreCopyUnsafeForSource(sourceRanges: readonly CellRange[]): boolean {
  return sourceRanges.some(isFullShapeRange);
}

function rangeHeight(range: CellRange): number {
  return range.endRow - range.startRow + 1;
}

function rangeWidth(range: CellRange): number {
  return range.endCol - range.startCol + 1;
}
