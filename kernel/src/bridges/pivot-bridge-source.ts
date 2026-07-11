import { type CellValue, type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { PivotTableConfig } from '@mog-sdk/contracts/pivot';
import type { DocumentContext } from '../context/types';
import { normalizeCellValue } from '../api/internal/value-conversions';
import { getOrder as getSheetOrder } from '../domain/sheets/sheet-meta';
import { createPivotNotFoundError } from '../errors';
import { toPublicPivotConfig } from './pivot-bridge-mappers';

export function pivotUsesSourceSheet(
  pivot: PivotTableConfig,
  sourceSheetId: SheetId,
  sourceName: string | null,
): boolean {
  if (pivot.sourceSheetId) {
    return pivot.sourceSheetId === sourceSheetId;
  }
  return sourceName !== null && pivot.sourceSheetName === sourceName;
}

export function sourceChangesAffectPivot(
  changes: readonly { row: number; col: number }[] | undefined,
  pivot: PivotTableConfig,
): boolean {
  if (!changes) {
    return true;
  }
  const range = pivot.sourceRange;
  return changes.some(
    ({ row, col }) =>
      row >= range.startRow && row <= range.endRow && col >= range.startCol && col <= range.endCol,
  );
}

export async function findPivotLocation(
  ctx: DocumentContext,
  pivotId: string,
): Promise<{ sheetId: SheetId; config: PivotTableConfig }> {
  const sheetIds = await ctx.computeBridge.getAllSheetIds();
  for (const id of sheetIds) {
    const sheetId = toSheetId(id as string);
    const config = await ctx.computeBridge.pivotGet(sheetId, pivotId);
    if (config) return { sheetId, config: toPublicPivotConfig(config) };
  }
  throw createPivotNotFoundError({ pivotName: pivotId });
}

export async function getPivotSourceData(
  ctx: DocumentContext,
  config: PivotTableConfig,
): Promise<CellValue[][] | null> {
  if (config.sourceSheetId) {
    return getDataFromRange(ctx, toSheetId(config.sourceSheetId), config.sourceRange);
  }

  // Legacy fallback: resolve source sheet name to ID for queryRange.
  const sheetIds = await getSheetOrder(ctx);
  let sourceId: SheetId | undefined;
  for (const id of sheetIds) {
    const name = await ctx.computeBridge.getSheetName(id);
    if (name === config.sourceSheetName) {
      sourceId = id;
      break;
    }
  }
  if (!sourceId) return null;
  return getDataFromRange(ctx, sourceId, config.sourceRange);
}

export async function getDataFromRange(
  ctx: DocumentContext,
  sheetId: SheetId,
  range: { startRow: number; startCol: number; endRow: number; endCol: number },
): Promise<CellValue[][] | null> {
  const rangeResult = await ctx.computeBridge.queryRange(
    sheetId,
    range.startRow,
    range.startCol,
    range.endRow,
    range.endCol,
  );

  const cellMap = new Map<string, (typeof rangeResult.cells)[number]>();
  for (const cell of rangeResult.cells) {
    cellMap.set(`${cell.row},${cell.col}`, cell);
  }

  const data: CellValue[][] = [];
  for (let row = range.startRow; row <= range.endRow; row++) {
    const rowData: CellValue[] = [];
    for (let col = range.startCol; col <= range.endCol; col++) {
      const cell = cellMap.get(`${row},${col}`);
      rowData.push(cell ? (normalizeCellValue(cell.value) ?? null) : null);
    }
    data.push(rowData);
  }

  return data.length > 0 ? data : null;
}
