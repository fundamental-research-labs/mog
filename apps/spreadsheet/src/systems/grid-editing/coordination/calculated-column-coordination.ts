/**
 * Calculated Column Coordination
 *
 * Coordinates showing the AutoCorrect Options button (lightning bolt) after
 * a calculated column formula is auto-filled to other rows.
 *
 * Excel Behavior:
 * - Enter a formula in a table data cell
 * - The formula auto-fills to all other data rows in that column
 * - A lightning bolt button appears with options:
 * - Undo Auto-Fill
 * - Stop Automatically Creating Calculated Columns
 * - Overwrite All Cells in This Column (when mixed content detected)
 *
 * Architecture:
 * - This module provides a callback to be passed to the mutations layer
 * - When a calculated column auto-fill occurs, it shows the UIStore AutoCorrect Options
 *
 */

import type { StoreApi } from 'zustand';

import type { Workbook } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';
import { parseA1Range } from '@mog/spreadsheet-utils/a1';

import type { GridEditingUIStore } from '../types';

// =============================================================================
// Types
// =============================================================================

/**
 * Information about a calculated column auto-fill event.
 */
export interface CalculatedColumnAutoFillInfo {
  /** Table ID */
  tableId: string;
  /** Column index within the table */
  columnIndex: number;
  /** The formula that was auto-filled */
  formula: string;
  /** Sheet ID */
  sheetId: SheetId;
  /** Row where the formula was originally entered */
  sourceRow: number;
  /** Column where the formula was originally entered */
  sourceCol: number;
}

/**
 * Configuration for calculated column coordination.
 */
export interface CalculatedColumnCoordinationConfig {
  /** Workbook for unified API access */
  workbook?: Workbook;
  /** UIStore for showing AutoCorrect Options button */
  uiStore?: StoreApi<GridEditingUIStore>;
}

/**
 * Result returned by setupCalculatedColumnCoordination.
 */
export interface CalculatedColumnCoordinationResult {
  /**
   * Notify that a calculated column auto-fill occurred.
   * This shows the AutoCorrect Options button.
   *
   * @param info - Information about the auto-fill
   */
  notifyAutoFill(info: CalculatedColumnAutoFillInfo): void;

  /** Cleanup function */
  cleanup(): void;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if a table column has mixed content (some cells different from the formula).
 *
 * @param ctx - Store context
 * @param tableId - Table ID
 * @param columnIndex - Column index within table
 * @param formula - The expected formula
 * @returns true if the column has mixed content
 */
export async function checkMixedContent(
  tableId: string,
  columnIndex: number,
  formula: string,
  workbook?: Workbook,
): Promise<boolean> {
  if (!workbook) return false;

  // Find the table across all sheets
  for (const name of await workbook.getSheetNames()) {
    const ws = await workbook.getSheet(name);
    const tableInfo = await ws.tables.get(tableId);
    if (!tableInfo) continue;

    // Check each data cell in the column for mixed content
    if (tableInfo.range) {
      const parsedRange = parseA1Range(tableInfo.range);
      const startDataRow = parsedRange.startRow + 1; // skip header
      const endDataRow = parsedRange.endRow - (tableInfo.hasTotalsRow ? 1 : 0);
      const col = parsedRange.startCol + columnIndex;

      if (startDataRow > endDataRow) break;

      // Batch-fetch entire column data in 1 IPC call
      const columnData = await ws.getRange(startDataRow, col, endDataRow, col);

      for (let i = 0; i < columnData.length; i++) {
        const row = columnData[i];
        if (row.length === 0) continue;
        const cellData = row[0];
        const valueStr = cellData.formula ?? String(cellData.value ?? '');

        if (valueStr !== formula && valueStr !== '') {
          return true;
        }
      }
    }
    break;
  }

  return false;
}

/**
 * Get the column name for display purposes.
 *
 * @param ctx - Store context
 * @param tableId - Table ID
 * @param columnIndex - Column index within table
 * @returns Column name or undefined
 */
async function getColumnName(
  tableId: string,
  columnIndex: number,
  workbook?: Workbook,
): Promise<string> {
  if (!workbook) return `Column ${columnIndex + 1}`;

  for (const name of await workbook.getSheetNames()) {
    const ws = await workbook.getSheet(name);
    const tableInfo = await ws.tables.get(tableId);
    if (
      tableInfo &&
      tableInfo.columns &&
      columnIndex >= 0 &&
      columnIndex < tableInfo.columns.length
    ) {
      return tableInfo.columns[columnIndex].name ?? `Column ${columnIndex + 1}`;
    }
  }
  return `Column ${columnIndex + 1}`;
}

/**
 * Count the number of cells filled in an auto-fill operation.
 *
 * @param ctx - Store context
 * @param tableId - Table ID
 * @param columnIndex - Column index within table
 * @returns Number of cells that would be filled
 */
async function countCellsFilled(
  tableId: string,
  _columnIndex: number,
  workbook?: Workbook,
): Promise<number> {
  if (!workbook) return 0;

  for (const name of await workbook.getSheetNames()) {
    const ws = await workbook.getSheet(name);
    const tableInfo = await ws.tables.get(tableId);
    if (tableInfo && tableInfo.range) {
      const parsedRange = parseA1Range(tableInfo.range);
      const startDataRow = parsedRange.startRow + 1; // skip header
      const endDataRow = parsedRange.endRow - (tableInfo.hasTotalsRow ? 1 : 0);
      const cellCount = endDataRow - startDataRow + 1;
      // Subtract 1 because the source cell was already filled by the user
      return Math.max(0, cellCount - 1);
    }
  }
  return 0;
}

// =============================================================================
// Setup Function
// =============================================================================

/**
 * Set up calculated column coordination.
 *
 * This function creates a coordinator that shows the AutoCorrect Options
 * button when a calculated column auto-fill occurs.
 *
 * @param config - Configuration for the coordination
 * @returns Coordination result with notify and cleanup methods
 */
export function setupCalculatedColumnCoordination(
  config: CalculatedColumnCoordinationConfig,
): CalculatedColumnCoordinationResult {
  const { workbook, uiStore } = config;

  return {
    notifyAutoFill(info: CalculatedColumnAutoFillInfo): void {
      const { tableId, columnIndex, formula, sheetId, sourceRow, sourceCol } = info;

      // Fire-and-forget the async work.
      void (async () => {
        if (!workbook) return;

        // Get table for display info via Worksheet API
        const ws = workbook.getSheetById(sheetId);
        const table = await ws.tables.get(tableId);
        if (!table) return;

        // Check if there's mixed content in the column
        const hasMixedContent = await checkMixedContent(tableId, columnIndex, formula, workbook);

        // Count cells filled
        const cellsFilled = await countCellsFilled(tableId, columnIndex, workbook);

        // Get column name
        const columnName = await getColumnName(tableId, columnIndex, workbook);

        // Show AutoCorrect Options button via UIStore
        if (uiStore) {
          const state = uiStore.getState();
          if (typeof state.showCalculatedColumnAutoCorrect === 'function') {
            state.showCalculatedColumnAutoCorrect({
              tableId,
              tableName: table.name,
              columnIndex,
              columnName,
              formula,
              cellsFilled,
              sheetId,
              hasMixedContent,
              sourceRow,
              sourceCol,
            });
          }
        }
      })();
    },

    cleanup(): void {
      // Clear UI state if needed
      if (uiStore) {
        const state = uiStore.getState();
        if (typeof state.hideTableAutoCorrectOptions === 'function') {
          state.hideTableAutoCorrectOptions();
        }
      }
    },
  };
}
