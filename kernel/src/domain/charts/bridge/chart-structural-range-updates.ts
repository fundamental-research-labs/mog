import { cellRangeToA1, cellRangeToSheetA1, parseCellRange } from '@mog/spreadsheet-utils/a1';

import type { ChartFloatingObject } from '../../../bridges/compute/compute-bridge';

type ParsedChartRange = NonNullable<ReturnType<typeof parseCellRange>>;
export type StructuralAxis = 'row' | 'column';
export type StructuralOperation = 'insert' | 'delete';
type RangeAdjustment = {
  range?: ParsedChartRange;
  changed: boolean;
  deleted: boolean;
};
export type StructuralRangeUpdate = {
  updates: Partial<ChartFloatingObject>;
  invalidate: boolean;
};

const TOP_LEVEL_RANGE_FIELDS = [
  { range: 'dataRange', identity: 'dataRangeIdentity' },
  { range: 'categoryRange', identity: 'categoryRangeIdentity' },
  { range: 'seriesRange', identity: 'seriesRangeIdentity' },
] as const;

const SERIES_RANGE_FIELDS = ['values', 'categories', 'bubbleSize'] as const;

export function buildStructuralRangeUpdate(
  chart: ChartFloatingObject,
  axis: StructuralAxis,
  operation: StructuralOperation,
  start: number,
  count: number,
): StructuralRangeUpdate {
  const updates: Partial<ChartFloatingObject> = {};
  let invalidate = false;

  for (const field of TOP_LEVEL_RANGE_FIELDS) {
    const rangeRef = chart[field.range];
    if (chart[field.identity] || !rangeRef) continue;
    const adjustment = adjustRangeRef(rangeRef, axis, operation, start, count);
    if (adjustment.deleted) invalidate = true;
    if (adjustment.changed && adjustment.range) {
      (updates as Record<string, unknown>)[field.range] = formatParsedRange(adjustment.range);
    }
  }

  if (chart.series) {
    let seriesChanged = false;
    const series = chart.series.map((entry) => {
      let next = entry;
      for (const field of SERIES_RANGE_FIELDS) {
        const rangeRef = entry[field];
        if (!rangeRef) continue;
        const adjustment = adjustRangeRef(rangeRef, axis, operation, start, count);
        if (adjustment.deleted) invalidate = true;
        if (adjustment.changed && adjustment.range) {
          if (next === entry) next = { ...entry };
          next[field] = formatParsedRange(adjustment.range);
          seriesChanged = true;
        }
      }
      return next;
    });

    if (seriesChanged) updates.series = series;
  }

  return { updates, invalidate };
}

function adjustRangeRef(
  rangeRef: string,
  axis: StructuralAxis,
  operation: StructuralOperation,
  start: number,
  count: number,
): RangeAdjustment {
  const range = parseCellRange(rangeRef);
  if (!range) return { changed: false, deleted: false };
  return operation === 'insert'
    ? adjustRangeForInsertion(range, axis, start, count)
    : adjustRangeForDeletion(range, axis, start, count);
}

function adjustRangeForInsertion(
  range: ParsedChartRange,
  axis: StructuralAxis,
  start: number,
  count: number,
): RangeAdjustment {
  const startKey = axis === 'row' ? 'startRow' : 'startCol';
  const endKey = axis === 'row' ? 'endRow' : 'endCol';
  if (start < range[startKey]) {
    return {
      range: {
        ...range,
        [startKey]: range[startKey] + count,
        [endKey]: range[endKey] + count,
      },
      changed: true,
      deleted: false,
    };
  }

  if (start > range[startKey] && start <= range[endKey]) {
    return {
      range: {
        ...range,
        [endKey]: range[endKey] + count,
      },
      changed: true,
      deleted: false,
    };
  }

  return { changed: false, deleted: false };
}

function adjustRangeForDeletion(
  range: ParsedChartRange,
  axis: StructuralAxis,
  start: number,
  count: number,
): RangeAdjustment {
  const startKey = axis === 'row' ? 'startRow' : 'startCol';
  const endKey = axis === 'row' ? 'endRow' : 'endCol';
  const deletionEnd = start + count - 1;

  if (deletionEnd < range[startKey]) {
    return {
      range: {
        ...range,
        [startKey]: range[startKey] - count,
        [endKey]: range[endKey] - count,
      },
      changed: true,
      deleted: false,
    };
  }

  if (start > range[endKey]) {
    return { changed: false, deleted: false };
  }

  const overlapStart = Math.max(start, range[startKey]);
  const overlapEnd = Math.min(deletionEnd, range[endKey]);
  const deletedWithin = overlapEnd - overlapStart + 1;
  const newStart = start < range[startKey] ? start : range[startKey];
  const newEnd = range[endKey] - deletedWithin;

  if (newEnd < newStart) {
    return { changed: false, deleted: true };
  }

  return {
    range: {
      ...range,
      [startKey]: newStart,
      [endKey]: newEnd,
    },
    changed: true,
    deleted: false,
  };
}

function formatParsedRange(range: ParsedChartRange): string {
  return range.sheetName ? cellRangeToSheetA1(range, range.sheetName) : cellRangeToA1(range);
}
