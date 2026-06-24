import { toA1 } from '@mog-sdk/kernel';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import { parseA1Range } from '@mog/spreadsheet-utils/a1';

import type { PasteStoreOperations } from './paste-executor';

export interface PasteTableInfo {
  name: string;
  range: string;
  autoExpand?: boolean;
  hasTotalsRow?: boolean;
}

export function rangeFromPastedValueUpdates(
  updates: Array<{ row: number; col: number; value: string | number | boolean | null }>,
): CellRange | null {
  if (updates.length === 0) return null;
  return {
    startRow: Math.min(...updates.map((update) => update.row)),
    startCol: Math.min(...updates.map((update) => update.col)),
    endRow: Math.max(...updates.map((update) => update.row)),
    endCol: Math.max(...updates.map((update) => update.col)),
  };
}

export async function expandTablesForPastedValues(
  store: PasteStoreOperations,
  sheetId: SheetId,
  pastedValuesRange: CellRange | null,
): Promise<void> {
  if (!pastedValuesRange || !store.getTables || !store.resizeTable) return;

  const tables = await store.getTables(sheetId);
  for (const table of tables) {
    if (table.autoExpand === false || table.hasTotalsRow === true) continue;

    const tableRange = parseTableRange(table.range);
    if (!tableRange || !tableShouldExpandForPaste(tableRange, pastedValuesRange)) continue;

    const expandedRange: CellRange = {
      ...tableRange,
      endRow: Math.max(tableRange.endRow, pastedValuesRange.endRow),
    };
    const expandedRangeA1 = cellRangeToA1(expandedRange);
    if (expandedRangeA1 === normalizeTableRangeRef(table.range)) continue;

    await store.resizeTable(sheetId, table.name, expandedRangeA1);
  }
}

function normalizeTableRangeRef(range: string): string {
  return range.replace(/\$/g, '').replace(/^.*!/, '');
}

function parseTableRange(range: string): CellRange | null {
  try {
    return parseA1Range(normalizeTableRangeRef(range));
  } catch {
    return null;
  }
}

function cellRangeToA1(range: CellRange): string {
  return `${toA1(range.startRow, range.startCol)}:${toA1(range.endRow, range.endCol)}`;
}

function tableShouldExpandForPaste(tableRange: CellRange, pastedValuesRange: CellRange): boolean {
  if (pastedValuesRange.startRow !== tableRange.endRow + 1) return false;
  return (
    pastedValuesRange.endCol >= tableRange.startCol &&
    pastedValuesRange.startCol <= tableRange.endCol
  );
}
