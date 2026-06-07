/**
 * Workbook Statistics Utility Functions
 *
 * Pure functions for calculating workbook and sheet-level statistics.
 * Implements the statistics display for Review > Workbook Statistics dialog.
 *
 * Excel Parity: Review > Workbook Statistics
 */

import type { Workbook, Worksheet } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';
import { colToLetter } from '@mog/spreadsheet-utils/a1';

// =============================================================================
// Types
// =============================================================================

export interface SheetStatistics {
  /** Last cell with data (row/col), null for empty sheets */
  endOfSheet: { row: number; col: number } | null;
  /** Count of non-empty cells */
  cellsWithData: number;
  /** Count of structured tables */
  tables: number;
  /** Count of pivot tables */
  pivotTables: number;
  /** Count of cells containing formulas */
  formulas: number;
  /** Count of embedded charts */
  charts: number;
  /** Count of pictures/images */
  images: number;
  /** Count of threaded comments */
  comments: number;
}

export interface WorkbookStatistics {
  /** Total sheet count */
  sheets: number;
  /** Sum of cells with data across all sheets */
  cellsWithData: number;
  /** Sum of tables across all sheets */
  tables: number;
  /** Sum of pivot tables across all sheets */
  pivotTables: number;
  /** Sum of formulas across all sheets */
  formulas: number;
  /** Sum of charts across all sheets */
  charts: number;
  /** Sum of images across all sheets */
  images: number;
  /** Sum of comments across all sheets */
  comments: number;
}

/**
 * Interface to decouple from FloatingObjectManager React type.
 * Caller provides image count, enabling pure function testing.
 */
export interface ImageCountProvider {
  getImageCount: (sheetId: SheetId) => number;
}

// =============================================================================
// Statistics Functions
// =============================================================================

/**
 * Calculate statistics for a single sheet.
 *
 * @param ws - Worksheet to calculate statistics for
 * @param imageCount - Pre-computed image count (decoupled from React hooks)
 * @returns Sheet statistics
 */
export async function getSheetStatistics(
  ws: Worksheet,
  imageCount: number,
): Promise<SheetStatistics> {
  let cellsWithData = 0;
  let formulas = 0;
  let endOfSheet: { row: number; col: number } | null = null;

  try {
    // ws.getUsedRange() returns a structured `CellRange | null` with 0-based
    // row/col fields. The previous code treated it as an A1 string and
    // matched a regex against it, which always returned null — so the
    // statistics dialog never reported endOfSheet for any non-empty sheet.
    const usedRange = await ws.getUsedRange();
    if (usedRange) {
      const rangeData = await ws.getRange(usedRange);
      endOfSheet = { row: usedRange.endRow, col: usedRange.endCol };

      // Iterate 2D array to count cells and formulas
      for (const row of rangeData) {
        for (const cell of row) {
          const hasValue = cell.value !== null && cell.value !== undefined;
          const hasFormula = cell.formula != null;

          if (hasValue || hasFormula) {
            cellsWithData++;
            if (hasFormula) formulas++;
          }
        }
      }
    }
  } catch {
    /* graceful fallback — return zeros */
  }

  // Wrap API calls in try-catch for resilience
  let charts = 0;
  let tables = 0;
  let comments = 0;
  let pivotTables = 0;

  try {
    const allCharts = await ws.charts.list({ materialization: 'available' });
    charts = allCharts.length;
  } catch {
    /* graceful fallback */
  }

  try {
    const allComments = await ws.comments.list();
    comments = allComments.length;
  } catch {
    /* graceful fallback */
  }

  try {
    const allTables = await ws.tables.list();
    tables = allTables.length;
  } catch {
    /* graceful fallback */
  }

  try {
    const allPivotTables = await ws.pivots.list();
    pivotTables = allPivotTables.length;
  } catch {
    /* graceful fallback */
  }

  return {
    endOfSheet,
    cellsWithData,
    formulas,
    charts,
    tables,
    comments,
    pivotTables,
    images: imageCount,
  };
}

/**
 * Calculate statistics for the entire workbook.
 *
 * Note: Hidden sheets ARE included in totals (matches Excel behavior).
 *
 * @param wb - Workbook instance
 * @param imageCountProvider - Provider for image counts (decoupled from React)
 * @returns Workbook statistics
 */
export async function getWorkbookStatistics(
  wb: Workbook,
  imageCountProvider: ImageCountProvider,
): Promise<WorkbookStatistics> {
  const sheetNames = wb.sheetNames;

  const totals: WorkbookStatistics = {
    sheets: sheetNames.length,
    cellsWithData: 0,
    tables: 0,
    pivotTables: 0,
    formulas: 0,
    charts: 0,
    images: 0,
    comments: 0,
  };

  for (const name of sheetNames) {
    const ws = await wb.getSheet(name);
    const sheetId = ws.getSheetId();
    const imageCount = imageCountProvider.getImageCount(sheetId);
    const sheetStats = await getSheetStatistics(ws, imageCount);
    totals.cellsWithData += sheetStats.cellsWithData;
    totals.tables += sheetStats.tables;
    totals.pivotTables += sheetStats.pivotTables;
    totals.formulas += sheetStats.formulas;
    totals.charts += sheetStats.charts;
    totals.images += sheetStats.images;
    totals.comments += sheetStats.comments;
  }

  return totals;
}

// =============================================================================
// Formatting Helpers
// =============================================================================

/**
 * Format a statistic value for display.
 * Returns "-" for null/undefined, locale-formatted number otherwise.
 */
export function formatStatValue(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return value.toLocaleString();
}

/**
 * Format end of sheet position as A1 reference.
 * Returns "(empty)" for null position.
 */
export function formatEndOfSheet(pos: { row: number; col: number } | null): string {
  if (!pos) return '(empty)';
  return `${colToLetter(pos.col)}${pos.row + 1}`;
}
