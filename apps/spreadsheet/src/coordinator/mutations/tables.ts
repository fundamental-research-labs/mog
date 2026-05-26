/**
 * Table Mutations Module
 *
 * Orchestrates table-specific write operations, focusing on Calculated Columns.
 * These mutations handle the Excel table feature where entering a formula in one
 * data cell automatically fills the entire column.
 *
 * Architecture: All operations use the unified Workbook/Worksheet API.
 * - Calculated column metadata + cell fill: ws.tables.setCalculatedColumn() / ws.tables.clearCalculatedColumn()
 * - Cell reads/writes: ws.getCellIdAt(), ws.setCells()
 * - Table queries: ws.tables.getAtCell(), ws.tables.list()
 *
 * Extracted from coordinator/mutations.ts as part of domain decomposition.
 */

import type { Workbook } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Convert Excel-style column letters (A, B, ..., Z, AA, ...) to a 0-based column index.
 */
function letterToCol(letters: string): number {
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.toUpperCase().charCodeAt(i) - 64);
  }
  return col - 1; // 0-based
}

/**
 * Parse an A1 range string (e.g., "A1:D10") into numeric bounds (0-based).
 */
function parseA1Range(
  range: string,
): { startRow: number; startCol: number; endRow: number; endCol: number } | null {
  const match = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (!match) return null;
  return {
    startCol: letterToCol(match[1]),
    startRow: parseInt(match[2], 10) - 1, // 1-based to 0-based
    endCol: letterToCol(match[3]),
    endRow: parseInt(match[4], 10) - 1,
  };
}

// =============================================================================
// Calculated Column Mutations (Excel Parity: Tables)
// =============================================================================
//
// Calculated columns are a core Excel table feature:
// - Entering a formula in one data cell of a table column fills the entire column
// - New rows automatically get the calculated formula
// - Uses @ shorthand for structured references (e.g., "=[@Price]*[@Quantity]")
//
// These mutations orchestrate:
// 1. Setting the calculated formula on the column metadata
// 2. Filling all existing data cells with the formula via Worksheet API
// =============================================================================

/**
 * Set a calculated column formula for a table column.
 * This fills the entire column (data rows) with the formula.
 *
 * Uses unified Worksheet API: ws.tables.setCalculatedColumn() handles both metadata
 * write and filling all data cells in one operation.
 *
 * @param tableId - Table name/identifier
 * @param columnIndex - Column index within table
 * @param formula - The formula (should use @ shorthand like "=[@Price]*[@Quantity]")
 * @param workbook - Workbook API instance
 */
export function setCalculatedColumn(
  tableId: string,
  columnIndex: number,
  formula: string,
  workbook: Workbook,
): void {
  // Fire-and-forget async — find the sheet containing this table, then delegate to ws API
  void (async () => {
    const sheetNames = workbook.sheetNames;
    for (const name of sheetNames) {
      const ws = await workbook.getSheet(name);
      const tables = await ws.tables.list();
      const found = tables.find((t) => t.name === tableId);
      if (found) {
        // Unified Worksheet API — handles metadata write + fills all data cells
        await ws.tables.setCalculatedColumn(tableId, columnIndex, formula);
        return;
      }
    }
  })();
}

/**
 * Clear a calculated column formula.
 * This only removes the column metadata - cell values remain unchanged.
 *
 * Uses unified Worksheet API: ws.tables.clearCalculatedColumn() handles the metadata clear.
 *
 * @param tableId - Table name/identifier
 * @param columnIndex - Column index within table
 * @param workbook - Workbook API instance
 */
export function clearCalculatedColumn(
  tableId: string,
  columnIndex: number,
  workbook?: Workbook,
): void {
  if (!workbook) return;

  // Fire-and-forget async — find the sheet containing this table, then delegate to ws API
  void (async () => {
    const sheetNames = workbook.sheetNames;
    for (const name of sheetNames) {
      const ws = await workbook.getSheet(name);
      const tables = await ws.tables.list();
      const found = tables.find((t) => t.name === tableId);
      if (found) {
        // Unified Worksheet API — handles metadata clear
        await ws.tables.clearCalculatedColumn(tableId, columnIndex);
        return;
      }
    }
  })();
}

/**
 * Check if a cell value should trigger calculated column auto-fill.
 * Call this when a formula is entered in a table data cell.
 *
 * Returns information needed to trigger auto-fill if applicable:
 * - The table ID and column index
 * - Whether this should create a calculated column
 *
 * @param sheetId - Sheet identifier
 * @param row - Row index
 * @param col - Column index
 * @param value - The value being entered
 * @param workbook - Workbook API instance
 * @returns Object with auto-fill info, or undefined if not applicable
 */
export async function checkCalculatedColumnAutoFill(
  sheetId: SheetId,
  row: number,
  col: number,
  value: string,
  workbook: Workbook,
): Promise<{ tableId: string; columnIndex: number; isFormula: boolean } | undefined> {
  // Only applies to formulas
  if (!value.startsWith('=')) return undefined;

  // Use Workbook API — ws.tables.getAtCell returns TableInfo | null
  const ws = workbook.getSheetById(sheetId);
  const table = await ws.tables.getAtCell(row, col);
  if (!table) return undefined;
  if (!table.autoCalculatedColumns) return undefined;

  // Parse the A1 range string to get numeric bounds
  const parsed = parseA1Range(table.range);
  if (!parsed) return undefined;

  // Only apply to data rows (not header or total)
  const dataStartRow = table.hasHeaderRow ? parsed.startRow + 1 : parsed.startRow;
  const dataEndRow = table.hasTotalsRow ? parsed.endRow - 1 : parsed.endRow;

  if (row < dataStartRow || row > dataEndRow) return undefined;

  // Get column index within table
  const columnIndex = col - parsed.startCol;
  if (columnIndex < 0 || columnIndex >= (table.columns?.length ?? 0)) return undefined;

  return {
    tableId: table.name,
    columnIndex,
    isFormula: true,
  };
}

/**
 * Apply calculated column formulas to newly added table rows.
 * Called after table auto-expansion adds a new row.
 *
 * Uses unified Worksheet API: ws.setCells() for batch formula writes.
 *
 * @param tableId - Table name/identifier
 * @param rowIndex - The newly added row index (absolute)
 * @param workbook - Workbook API instance
 */
export function applyCalculatedFormulasToNewRow(
  tableId: string,
  rowIndex: number,
  workbook: Workbook,
): void {
  // Fire-and-forget async — resolve table info, then batch-write formulas via ws API
  void (async () => {
    // Resolve worksheet and table info via Workbook API
    const sheetNames = workbook.sheetNames;
    for (const name of sheetNames) {
      const ws = await workbook.getSheet(name);
      const tables = await ws.tables.list();
      const found = tables.find((t) => t.name === tableId);
      if (!found) continue;

      const tableRange = parseA1Range(found.range);
      if (!tableRange) return;

      // Build batch formula updates for calculated columns
      const formulaUpdates: Array<{ row: number; col: number; value: string }> = [];

      for (let i = 0; i < found.columns.length; i++) {
        const column = found.columns[i];
        if (column.calculatedFormula) {
          const col = tableRange.startCol + i;
          formulaUpdates.push({
            row: rowIndex,
            col,
            value: column.calculatedFormula,
          });
        }
      }

      if (formulaUpdates.length > 0) {
        // Unified Worksheet API — batch formula write, Rust handles recalculation
        await ws.setCells(formulaUpdates);
      }
      return;
    }
  })();
}
