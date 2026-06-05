import type { SheetId } from '@mog-sdk/contracts/api';
import type { CellRange } from '@mog-sdk/contracts/core';
import type {
  PivotTableConfig as DataPivotTableConfig,
  PivotTableResult,
} from '@mog-sdk/contracts/pivot';
import type { DocumentContext } from '../../context';
import { requirePivot, resolvePivotName } from './pivot-lookup';

interface PivotRenderedBounds {
  config: DataPivotTableConfig;
  totalRows: number;
  totalCols: number;
  firstDataRow: number;
  firstDataCol: number;
}

export async function getPivotRangeByName(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
}): Promise<CellRange | null> {
  const { ctx, sheetId, pivotName } = options;
  const { pivotId } = await resolvePivotName(ctx, sheetId, pivotName, 'getRange');
  return getPivotRangeForId({ ctx, sheetId, pivotId });
}

export async function getPivotRangeForId(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotId: string;
}): Promise<CellRange | null> {
  const bounds = await computePivotBounds(options);
  if (!bounds) return null;
  const { config, totalRows, totalCols } = bounds;
  const startRow = config.outputLocation.row;
  const startCol = config.outputLocation.col;
  return {
    startRow,
    startCol,
    endRow: startRow + totalRows - 1,
    endCol: startCol + totalCols - 1,
    sheetId: options.sheetId,
  };
}

export async function getPivotDataBodyRangeByName(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
}): Promise<CellRange | null> {
  const { ctx, sheetId, pivotName } = options;
  const { pivotId } = await resolvePivotName(ctx, sheetId, pivotName, 'getDataBodyRange');
  const bounds = await computePivotBounds({ ctx, sheetId, pivotId });
  if (!bounds) return null;
  const { config, totalRows, totalCols, firstDataRow, firstDataCol } = bounds;
  const startRow = config.outputLocation.row + firstDataRow;
  const startCol = config.outputLocation.col + firstDataCol;
  return {
    startRow,
    startCol,
    endRow: config.outputLocation.row + totalRows - 1,
    endCol: config.outputLocation.col + totalCols - 1,
    sheetId,
  };
}

export async function getPivotColumnLabelRangeByName(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
}): Promise<CellRange | null> {
  const { ctx, sheetId, pivotName } = options;
  const { pivotId } = await resolvePivotName(ctx, sheetId, pivotName, 'getColumnLabelRange');
  const bounds = await computePivotBounds({ ctx, sheetId, pivotId });
  if (!bounds) return null;
  const { config, totalCols, firstDataRow, firstDataCol } = bounds;
  if (firstDataRow === 0) return null;
  const startRow = config.outputLocation.row;
  const startCol = config.outputLocation.col + firstDataCol;
  return {
    startRow,
    startCol,
    endRow: startRow + firstDataRow - 1,
    endCol: config.outputLocation.col + totalCols - 1,
    sheetId,
  };
}

export async function getPivotRowLabelRangeByName(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
}): Promise<CellRange | null> {
  const { ctx, sheetId, pivotName } = options;
  const { pivotId } = await resolvePivotName(ctx, sheetId, pivotName, 'getRowLabelRange');
  const bounds = await computePivotBounds({ ctx, sheetId, pivotId });
  if (!bounds) return null;
  const { config, totalRows, firstDataRow, firstDataCol } = bounds;
  if (firstDataCol === 0) return null;
  const startRow = config.outputLocation.row + firstDataRow;
  const startCol = config.outputLocation.col;
  return {
    startRow,
    startCol,
    endRow: config.outputLocation.row + totalRows - 1,
    endCol: startCol + firstDataCol - 1,
    sheetId,
  };
}

export async function getPivotFilterAxisRangeByName(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotName: string;
}): Promise<CellRange | null> {
  const { ctx, sheetId, pivotName } = options;
  const { pivotId } = await resolvePivotName(ctx, sheetId, pivotName, 'getFilterAxisRange');
  const config = await requirePivot(ctx, sheetId, pivotId, 'getFilterAxisRange');
  const filterPlacements = config.placements.filter((placement) => placement.area === 'filter');
  if (filterPlacements.length === 0) return null;
  const anchorRow = config.outputLocation.row;
  const anchorCol = config.outputLocation.col;
  const filterRowCount = filterPlacements.length;
  return {
    startRow: Math.max(0, anchorRow - filterRowCount * 2),
    startCol: anchorCol,
    endRow: anchorRow - 1,
    endCol: anchorCol + 1,
    sheetId,
  };
}

async function computePivotBounds(options: {
  ctx: DocumentContext;
  sheetId: SheetId;
  pivotId: string;
}): Promise<PivotRenderedBounds | null> {
  const { ctx, sheetId, pivotId } = options;
  const config = await requirePivot(ctx, sheetId, pivotId, 'computeBounds');
  const result: PivotTableResult | null = await ctx.pivot.compute(sheetId, pivotId);
  if (!result) return null;

  if (result.renderedBounds.totalRows > 0 && result.renderedBounds.totalCols > 0) {
    return {
      config,
      totalRows: result.renderedBounds.totalRows,
      totalCols: result.renderedBounds.totalCols,
      firstDataRow: result.renderedBounds.firstDataRow,
      firstDataCol: result.renderedBounds.firstDataCol,
    };
  }

  const rowFieldCount = config.placements.filter((placement) => placement.area === 'row').length;
  const colFieldCount = config.placements.filter(
    (placement) => placement.area === 'column',
  ).length;
  const valueFieldCount = config.placements.filter(
    (placement) => placement.area === 'value',
  ).length;
  const firstDataCol = Math.max(rowFieldCount, 1);
  const firstDataRow = Math.max(colFieldCount, 1) + (valueFieldCount > 1 ? 1 : 0);
  const totalRows = firstDataRow + result.rows.length;
  const dataColCount = result.rows.length > 0 ? result.rows[0].values.length : 0;
  const totalCols = firstDataCol + dataColCount;

  return { config, totalRows, totalCols, firstDataRow, firstDataCol };
}
