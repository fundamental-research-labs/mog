import type { WorksheetRange } from '@mog-sdk/contracts/api';
import type { CellRange } from '@mog-sdk/contracts/core';
import { rangeToA1 } from '../internal/utils';

type RangeBounds = Pick<CellRange, 'startRow' | 'startCol' | 'endRow' | 'endCol'>;

export function toWorksheetRange(range: RangeBounds): WorksheetRange {
  return {
    startRow: range.startRow,
    startCol: range.startCol,
    endRow: range.endRow,
    endCol: range.endCol,
    address: rangeToA1(range),
  };
}

export function toWorksheetRangeOrNull(range: RangeBounds | null): WorksheetRange | null {
  return range ? toWorksheetRange(range) : null;
}
