import type { TableInfo, Workbook } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';

/**
 * Convert Excel-style column letters (A, B, ..., Z, AA, ...) to a 0-based column index.
 */
function letterToCol(letters: string): number {
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.toUpperCase().charCodeAt(i) - 64);
  }
  return col - 1;
}

/**
 * Parse an A1 range string (e.g., "A1:D10") into numeric bounds (0-based).
 */
export function parseTableA1Range(
  range: string,
): { startRow: number; startCol: number; endRow: number; endCol: number } | null {
  const match = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (!match) return null;
  return {
    startCol: letterToCol(match[1]),
    startRow: parseInt(match[2], 10) - 1,
    endCol: letterToCol(match[3]),
    endRow: parseInt(match[4], 10) - 1,
  };
}

export interface CalculatedColumnCellContext {
  table: TableInfo;
  tableId: string;
  tableName: string;
  columnIndex: number;
  columnName: string;
  calculatedFormula?: string;
}

/**
 * Resolve the calculated-column context for a table data body cell.
 *
 * This intentionally excludes header and total rows. Callers use the same
 * context for calculated-column creation/fill and user-facing formula readback.
 */
export async function resolveCalculatedColumnCellContext(
  sheetId: SheetId,
  row: number,
  col: number,
  workbook: Workbook,
  options?: { requireAutoCalculatedColumns?: boolean },
): Promise<CalculatedColumnCellContext | undefined> {
  const ws = workbook.getSheetById(sheetId);
  const table = await ws.tables.getAtCell(row, col);
  if (!table) return undefined;
  if (options?.requireAutoCalculatedColumns && !table.autoCalculatedColumns) return undefined;

  const parsed = parseTableA1Range(table.range);
  if (!parsed) return undefined;

  const dataStartRow = table.hasHeaderRow ? parsed.startRow + 1 : parsed.startRow;
  const dataEndRow = table.hasTotalsRow ? parsed.endRow - 1 : parsed.endRow;
  if (row < dataStartRow || row > dataEndRow) return undefined;

  const columnIndex = col - parsed.startCol;
  const column = table.columns?.[columnIndex];
  if (!column) return undefined;

  return {
    table,
    tableId: table.name,
    tableName: table.name,
    columnIndex,
    columnName: column.name,
    calculatedFormula: column.calculatedFormula,
  };
}

export function hasImplicitRowStructuredReference(formula: string): boolean {
  return /(^|[^A-Za-z0-9_.\]])\[@/.test(formula);
}

export function qualifyImplicitRowStructuredReferences(formula: string, tableName: string): string {
  return formula.replace(/(^|[^A-Za-z0-9_.\]])\[@/g, `$1${tableName}[@`);
}
