/**
 * Row Auto-Fit Algorithm
 *
 * Iterates all cells in a row to find the maximum required height.
 * Handles wrapText by calculating line count.
 *
 * ARCHITECTURAL NOTES:
 * - Batch-fetches all data upfront (5 parallel IPC calls) then iterates in-memory
 * - Reads from Worksheet API batch methods (getRange, getHiddenColumnsBitmap, etc.)
 * - Writes through ws.layout.setRowHeight() and awaits all committed mutations
 * - Skips hidden columns for efficiency
 * - Handles merged cells by distributing height across rows
 * - wrapText calculation depends on column width
 *
 * @module state/coordinator/operations/autofit/row-autofit
 */

import type { MergedRegion, Workbook, Worksheet } from '@mog-sdk/contracts/api';
import type { CellData, CellFormat, SheetId } from '@mog-sdk/contracts/core';
import type { SheetBounds, TextMeasurementService } from '@mog-sdk/contracts/rendering';
import { DEFAULT_ROW_HEIGHT, MIN_ROW_HEIGHT } from '@mog-sdk/contracts/rendering';

import { getDefaultCulture } from '@mog/culture';
import { getUsedSheetBoundsForAutofit } from './bounds';

// =============================================================================
// Constants
// =============================================================================

/** Maximum row height to prevent excessive sizing */
const MAX_AUTOFIT_HEIGHT = 409; // Excel's max row height

// =============================================================================
// Batch Data Types
// =============================================================================

/** Pre-fetched data for autofit operations. Eliminates per-cell IPC calls. */
interface AutofitBatchData {
  rangeData: CellData[][];
  hiddenCols: Set<number>;
  mergeMap: Map<string, MergedRegion>;
  colWidths: Map<number, number>;
  rowHeights: Map<number, number>;
  bounds: SheetBounds;
}

// =============================================================================
// Batch Data Pre-Fetch
// =============================================================================

/**
 * Pre-fetch all data needed for autofit in 5 parallel IPC calls.
 * After this, all cell iteration is purely in-memory (zero IPC).
 */
async function prefetchAutofitData(ws: Worksheet, bounds: SheetBounds): Promise<AutofitBatchData> {
  const [rangeData, hiddenCols, merges, colWidthPairs, rowHeightPairs] = await Promise.all([
    ws.getRange(bounds.minRow, bounds.minCol, bounds.maxRow, bounds.maxCol),
    ws.layout.getHiddenColumnsBitmap(),
    ws.structure.getMergedRegions(),
    ws.layout.getColWidthsBatch(bounds.minCol, bounds.maxCol),
    ws.layout.getRowHeightsBatch(bounds.minRow, bounds.maxRow),
  ]);

  // Build merge lookup map: "row,col" -> MergedRegion
  const mergeMap = new Map<string, MergedRegion>();
  for (const merge of merges) {
    for (let r = merge.startRow; r <= merge.endRow; r++) {
      for (let c = merge.startCol; c <= merge.endCol; c++) {
        mergeMap.set(`${r},${c}`, merge);
      }
    }
  }

  return {
    rangeData,
    hiddenCols,
    mergeMap,
    colWidths: new Map(colWidthPairs),
    rowHeights: new Map(rowHeightPairs),
    bounds,
  };
}

// =============================================================================
// Sync Helpers (use batch data, zero IPC)
// =============================================================================

/**
 * Get the total width of all columns in a merge (sync, uses pre-fetched colWidths).
 */
function getMergeWidth(
  merge: MergedRegion,
  colWidths: Map<number, number>,
  defaultWidth: number,
): number {
  let totalWidth = 0;
  for (let col = merge.startCol; col <= merge.endCol; col++) {
    totalWidth += colWidths.get(col) ?? defaultWidth;
  }
  return totalWidth;
}

/**
 * Get the total current height of other rows in a merge (excluding the target row).
 * Sync, uses pre-fetched rowHeights.
 */
function getOtherMergeRowsHeight(
  merge: MergedRegion,
  targetRow: number,
  rowHeights: Map<number, number>,
): number {
  let totalHeight = 0;
  for (let row = merge.startRow; row <= merge.endRow; row++) {
    if (row !== targetRow) {
      totalHeight += rowHeights.get(row) ?? DEFAULT_ROW_HEIGHT;
    }
  }
  return totalHeight;
}

// =============================================================================
// Row Auto-Fit
// =============================================================================

/**
 * Calculate optimal height for a single row.
 *
 * When batchData is provided, uses in-memory lookups (zero IPC).
 * When batchData is not provided (standalone call), fetches batch data internally.
 *
 * @param sheetId - Sheet ID
 * @param rowIndex - Row index to auto-fit
 * @param textMeasurement - TextMeasurementService for text measurement
 * @param preFormattedMap - Optional map of pre-formatted display strings keyed by "row,col"
 * @param workbook - Workbook for unified API access
 * @param batchData - Optional pre-fetched batch data for zero-IPC operation
 * @returns Optimal height in pixels
 */
export async function calculateRowAutoFitHeight(
  sheetId: SheetId,
  rowIndex: number,
  textMeasurement: TextMeasurementService,
  preFormattedMap?: Map<string, string>,
  workbook?: Workbook,
  batchData?: AutofitBatchData,
): Promise<number> {
  if (!workbook) return DEFAULT_ROW_HEIGHT;
  const ws = workbook.getSheetById(sheetId);

  // Get culture for formatting
  const culture = getDefaultCulture();

  // If no batch data provided, fetch it for this standalone call
  if (!batchData) {
    const bounds = await getUsedSheetBoundsForAutofit(ws);
    if (!bounds) {
      return DEFAULT_ROW_HEIGHT;
    }
    batchData = await prefetchAutofitData(ws, bounds);
  }

  return calculateRowHeightFromBatchData(
    rowIndex,
    textMeasurement,
    batchData,
    culture,
    preFormattedMap,
  );
}

/**
 * Auto-fit multiple rows.
 *
 * Performance optimizations:
 * - Pre-fetches ALL data in 5 parallel IPC calls (getRange, getHiddenColumnsBitmap,
 * getMergedRegions, getColWidthsBatch, getRowHeightsBatch)
 * - Single data-gathering phase feeds both pre-format and measurement (no double processing)
 * - All cell iteration is purely in-memory after the initial fetch
 * - Batches all dimension writes
 *
 * @param sheetId - Sheet ID
 * @param rows - Array of row indices to auto-fit
 * @param textMeasurement - TextMeasurementService for text measurement
 */
export async function autoFitRows(
  sheetId: SheetId,
  rows: number[],
  textMeasurement: TextMeasurementService,
  formatBatchFn?: (
    entries: Array<{ value: { type: string; value?: unknown }; formatCode: string }>,
  ) => Promise<string[]>,
  workbook?: Workbook,
): Promise<void> {
  if (rows.length === 0) return;
  if (!workbook) return;

  const ws = workbook.getSheetById(sheetId);

  // Helper: set row height via unified Workbook API
  const setRowHeight = (row: number, height: number): Promise<void> =>
    ws.layout.setRowHeight(row, height);

  // Pre-compute bounds once for all rows
  const bounds = await getUsedSheetBoundsForAutofit(ws);
  if (!bounds) {
    // No data - set all rows to default
    await Promise.all(rows.map((row) => setRowHeight(row, DEFAULT_ROW_HEIGHT)));
    return;
  }

  // Batch-fetch ALL data upfront (5 parallel IPC calls)
  const batchData = await prefetchAutofitData(ws, bounds);

  // Build pre-formatted map if batch formatting is available
  // Uses batch data for in-memory iteration (zero IPC)
  let preFormattedMap: Map<string, string> | undefined;
  if (formatBatchFn) {
    const cellEntries: Array<{
      row: number;
      col: number;
      value: unknown;
      formatCode: string;
    }> = [];
    for (const row of rows) {
      for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
        if (batchData.hiddenCols.has(col)) continue;
        const merge = batchData.mergeMap.get(`${row},${col}`);
        if (merge && merge.startRow !== row) continue;
        const cellData = batchData.rangeData[row - bounds.minRow]?.[col - bounds.minCol];
        const value = cellData?.value;
        if (value === undefined || value === null || value === '') continue;
        const format = cellData?.format;
        cellEntries.push({ row, col, value, formatCode: format?.numberFormat ?? 'General' });
      }
    }

    if (cellEntries.length > 0) {
      const entries = cellEntries.map((c) => ({
        value: toFormatValue(c.value),
        formatCode: c.formatCode,
      }));
      const formatted = await formatBatchFn(entries);
      preFormattedMap = new Map();
      cellEntries.forEach((c, i) => preFormattedMap!.set(`${c.row},${c.col}`, formatted[i]));
    }
  }

  // Calculate all optimal heights (measurement phase) — pure in-memory, zero IPC
  const heights: Array<{ row: number; height: number }> = [];
  const culture = getDefaultCulture();

  for (const row of rows) {
    const height = calculateRowHeightFromBatchData(
      row,
      textMeasurement,
      batchData,
      culture,
      preFormattedMap,
    );
    heights.push({ row, height });
  }

  // Batch all dimension writes and return only after the layout mutations land.
  await Promise.all(heights.map(({ row, height }) => setRowHeight(row, height)));
}

/**
 * Calculate row height using pre-fetched batch data.
 * Purely synchronous — all data lookups are in-memory Map/Set lookups.
 */
function calculateRowHeightFromBatchData(
  rowIndex: number,
  textMeasurement: TextMeasurementService,
  batchData: AutofitBatchData,
  culture: ReturnType<typeof getDefaultCulture>,
  preFormattedMap?: Map<string, string>,
): number {
  const { bounds, hiddenCols, mergeMap, colWidths, rowHeights, rangeData } = batchData;
  // Use a reasonable default column width for merges spanning columns not in the map
  const DEFAULT_COL_WIDTH = 64;

  let maxHeight = MIN_ROW_HEIGHT;

  for (let col = bounds.minCol; col <= bounds.maxCol; col++) {
    // Skip hidden columns
    if (hiddenCols.has(col)) {
      continue;
    }

    // Check if cell is part of a merge
    const merge = mergeMap.get(`${rowIndex},${col}`) ?? null;

    // Skip if cell is in a merge but not the origin row
    if (merge && merge.startRow !== rowIndex) {
      continue;
    }

    // Get cell value and format from batch data
    const cellData = rangeData[rowIndex - bounds.minRow]?.[col - bounds.minCol];
    const value = cellData?.value;
    if (value === undefined || value === null || value === '') {
      continue;
    }

    const format: CellFormat | undefined = cellData?.format ?? undefined;

    // Get column width for wrap text calculation
    let availableWidth: number;
    if (merge) {
      availableWidth = getMergeWidth(merge, colWidths, DEFAULT_COL_WIDTH);
    } else {
      availableWidth = colWidths.get(col) ?? DEFAULT_COL_WIDTH;
    }

    let cellHeight: number;

    // Handle rotated text specially
    const preFormatted = preFormattedMap?.get(`${rowIndex},${col}`);
    if (format?.textRotation && format.textRotation !== 0) {
      const rotated = textMeasurement.measureRotatedCell(value, format, culture, preFormatted);
      cellHeight = rotated.height;
    } else {
      cellHeight = textMeasurement.measureCellHeight(
        value,
        format,
        culture,
        availableWidth,
        preFormatted,
      );
    }

    // For merged cells, distribute height across rows
    if (merge) {
      const mergeRowSpan = merge.endRow - merge.startRow + 1;
      if (mergeRowSpan > 1) {
        const otherHeight = getOtherMergeRowsHeight(merge, rowIndex, rowHeights);
        cellHeight = Math.max(0, cellHeight - otherHeight);
      }
    }

    maxHeight = Math.max(maxHeight, cellHeight);
  }

  // Cap at maximum
  return Math.min(maxHeight, MAX_AUTOFIT_HEIGHT);
}

// =============================================================================
// Format Value Conversion
// =============================================================================

/** Convert a JS cell value to the Rust CellValue wire format. */
function toFormatValue(value: unknown): { type: string; value?: unknown } {
  if (typeof value === 'number') return { type: 'Number', value };
  if (typeof value === 'string') return { type: 'Text', value };
  if (typeof value === 'boolean') return { type: 'Boolean', value };
  return { type: 'Null' };
}

// =============================================================================
// Helper Functions
// =============================================================================
