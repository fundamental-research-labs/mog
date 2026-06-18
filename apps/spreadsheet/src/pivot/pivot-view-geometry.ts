import type { ImportedPivotViewRecord } from '@mog-sdk/contracts/api';
import type { CellRange } from '@mog-sdk/contracts/core';
import type {
  PivotFieldArea,
  PivotRenderedBounds,
  PivotTableConfig,
  PivotTableResult,
} from '@mog-sdk/contracts/pivot';
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

function placementCount(
  config: Pick<PivotTableConfig, 'placements'>,
  area: PivotFieldArea,
): number {
  return config.placements.filter((placement) => placement.area === area).length;
}

export function fallbackPivotRenderedBounds(
  config: Pick<PivotTableConfig, 'placements'>,
): PivotRenderedBounds {
  const rowFieldCount = placementCount(config, 'row');
  const columnFieldCount = placementCount(config, 'column');
  const valueFieldCount = placementCount(config, 'value');
  return {
    totalRows: 1,
    totalCols: 1,
    firstDataRow: Math.max(columnFieldCount, 1) + (valueFieldCount > 1 ? 1 : 0),
    firstDataCol: Math.max(rowFieldCount, 1),
    numDataCols: Math.max(valueFieldCount, 0),
  };
}

export function pivotRenderedBoundsForView(
  config: Pick<PivotTableConfig, 'placements'>,
  result: Pick<PivotTableResult, 'renderedBounds'> | null | undefined,
): PivotRenderedBounds {
  const renderedBounds = result?.renderedBounds;
  if (renderedBounds && renderedBounds.totalRows > 0 && renderedBounds.totalCols > 0) {
    return renderedBounds;
  }
  return fallbackPivotRenderedBounds(config);
}

export function pivotBoundsForView(
  config: Pick<PivotTableConfig, 'outputLocation' | 'refRange' | 'placements'>,
  result: Pick<PivotTableResult, 'renderedBounds'> | null | undefined,
): PivotBounds {
  const renderedBounds = result?.renderedBounds;
  if (renderedBounds && renderedBounds.totalRows > 0 && renderedBounds.totalCols > 0) {
    const { row, col } = config.outputLocation;
    return {
      startRow: row,
      startCol: col,
      endRow: row + renderedBounds.totalRows - 1,
      endCol: col + renderedBounds.totalCols - 1,
    };
  }
  return pivotBoundsForConfig(config);
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
