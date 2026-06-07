import type { ImportedPivotViewRecord } from '@mog-sdk/contracts/api';
import type { CellRange } from '@mog-sdk/contracts/core';
import type { PivotTableConfig } from '@mog-sdk/contracts/pivot';
import { parseCellRange } from '@mog/spreadsheet-utils/a1';

export type PivotBounds = Pick<CellRange, 'startRow' | 'startCol' | 'endRow' | 'endCol'>;

export function pivotAnchorBounds(config: Pick<PivotTableConfig, 'outputLocation'>): PivotBounds {
  return {
    startRow: config.outputLocation.row,
    startCol: config.outputLocation.col,
    endRow: config.outputLocation.row,
    endCol: config.outputLocation.col,
  };
}

export function pivotBoundsForConfig(
  config: Pick<PivotTableConfig, 'outputLocation' | 'refRange'>,
): PivotBounds {
  return (config.refRange ? parseCellRange(config.refRange) : null) ?? pivotAnchorBounds(config);
}

export function pivotBoundsForImportedRecord(record: ImportedPivotViewRecord): PivotBounds {
  return record.renderedRange ?? pivotBoundsForConfig(record.config);
}

export function pivotBoundsContain(bounds: PivotBounds, row: number, col: number): boolean {
  return (
    row >= bounds.startRow && row <= bounds.endRow && col >= bounds.startCol && col <= bounds.endCol
  );
}

export function pivotBoundsOverlap(a: PivotBounds, b: PivotBounds): boolean {
  return (
    a.startRow <= b.endRow &&
    a.endRow >= b.startRow &&
    a.startCol <= b.endCol &&
    a.endCol >= b.startCol
  );
}
