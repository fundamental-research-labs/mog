import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import { parseA1Range } from '@mog/spreadsheet-utils/a1';

const FRESH_TABLE_CORNER_CUT_WINDOW_MS = 2000;

interface TableCornerClickState {
  cornerClickStage?: unknown;
  cornerClickTableId?: unknown;
  cornerClickTimestamp?: unknown;
}

interface TableRangeWorkbook {
  getSheetById(sheetId: SheetId): {
    tables: {
      get?(tableId: string): Promise<unknown>;
      list?(): Promise<unknown[]>;
    };
  };
}

function isSingleCellRange(range: CellRange): boolean {
  return (
    range.startRow === range.endRow &&
    range.startCol === range.endCol &&
    !range.isFullColumn &&
    !range.isFullRow
  );
}

function readTableRange(table: unknown): CellRange | null {
  const range = (table as { range?: unknown } | null)?.range;
  if (typeof range === 'string') {
    try {
      return parseA1Range(range);
    } catch {
      return null;
    }
  }
  if (
    range &&
    typeof range === 'object' &&
    typeof (range as CellRange).startRow === 'number' &&
    typeof (range as CellRange).startCol === 'number' &&
    typeof (range as CellRange).endRow === 'number' &&
    typeof (range as CellRange).endCol === 'number'
  ) {
    return range as CellRange;
  }
  return null;
}

async function getTableByIdOrName(
  workbook: TableRangeWorkbook,
  sheetId: SheetId,
  tableId: string,
): Promise<unknown | null> {
  const tables = workbook.getSheetById(sheetId).tables;
  const byId = tables.get ? await tables.get(tableId).catch(() => null) : null;
  if (byId) return byId;

  return tables.list
    ? tables
        .list()
        .then(
          (allTables) =>
            allTables.find((candidate) => {
              const table = candidate as { id?: unknown; name?: unknown };
              return table.id === tableId || table.name === tableId;
            }) ?? null,
        )
        .catch(() => null)
    : null;
}

export async function expandFreshFullTableCornerCutRange(
  workbook: TableRangeWorkbook,
  sheetId: SheetId,
  uiState: TableCornerClickState,
  ranges: readonly CellRange[],
): Promise<CellRange[]> {
  if (ranges.length !== 1 || !isSingleCellRange(ranges[0])) return [...ranges];

  if (
    uiState.cornerClickStage !== 1 ||
    typeof uiState.cornerClickTableId !== 'string' ||
    typeof uiState.cornerClickTimestamp !== 'number' ||
    Date.now() - uiState.cornerClickTimestamp > FRESH_TABLE_CORNER_CUT_WINDOW_MS
  ) {
    return [...ranges];
  }

  const table = await getTableByIdOrName(workbook, sheetId, uiState.cornerClickTableId);
  const tableRange = readTableRange(table);
  if (
    !tableRange ||
    tableRange.startRow !== ranges[0].startRow ||
    tableRange.startCol !== ranges[0].startCol
  ) {
    return [...ranges];
  }

  return [tableRange];
}
