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
import {
  parseTableA1Range,
  resolveCalculatedColumnCellContext,
} from '../tables/calculated-column-context';

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

  const context = await resolveCalculatedColumnCellContext(sheetId, row, col, workbook, {
    requireAutoCalculatedColumns: true,
  });
  if (!context) return undefined;

  return {
    tableId: context.tableId,
    columnIndex: context.columnIndex,
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

      const tableRange = parseTableA1Range(found.range);
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
