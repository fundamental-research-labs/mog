/**
 * Column Auto-Fit Algorithm
 *
 * Iterates all cells in a column to find the maximum required width.
 * Uses TextMeasurementService for text measurement (dependency injection).
 *
 * ARCHITECTURAL NOTES:
 * - Batch pre-fetches ALL data upfront (getRange, getHiddenRowsBitmap,
 * getMergedRegions, getColWidthsBatch) to minimize IPC round-trips.
 * - Single-column standalone calls fetch data for that column only.
 * - Multi-column autoFitColumns() fetches data once for all columns.
 * - Zero per-cell IPC calls in the measurement loops.
 *
 * @module state/coordinator/operations/autofit/column-autofit
 */

import type { MergedRegion, Workbook, Worksheet } from '@mog-sdk/contracts/api';
import type { CellData, CellFormat, SheetId } from '@mog-sdk/contracts/core';
import type { SheetBounds, TextMeasurementService } from '@mog-sdk/contracts/rendering';
import { DEFAULT_COL_WIDTH, MIN_COL_WIDTH } from '@mog-sdk/contracts/rendering';

import { getDefaultCulture } from '@mog/culture';
import { getUsedSheetBoundsForAutofit } from './bounds';

// =============================================================================
// Constants
// =============================================================================

/** Maximum column width to prevent excessive sizing */
const MAX_AUTOFIT_WIDTH = 500;

// =============================================================================
// Batch Pre-Fetch
// =============================================================================

/** Pre-fetched data for autofit operations, eliminating per-cell IPC. */
interface AutofitBatchData {
  /** 2D array of cell data indexed by [row - minRow][col - minCol] */
  rangeData: CellData[][];
  /** Set of hidden row indices */
  hiddenRows: Set<number>;
  /** Lookup: "row,col" -> MergedRegion for every cell in a merge */
  mergeMap: Map<string, MergedRegion>;
  /** Column index -> current width */
  colWidths: Map<number, number>;
  /** Sheet bounds used to fetch this data */
  bounds: SheetBounds;
}

/**
 * Batch pre-fetch all data needed for autofit in 4 parallel IPC calls.
 * After this call, all measurement loops operate purely in-memory.
 */
async function prefetchAutofitData(ws: Worksheet, bounds: SheetBounds): Promise<AutofitBatchData> {
  const [rangeData, hiddenRows, merges, colWidthPairs] = await Promise.all([
    ws.getRange(bounds.minRow, bounds.minCol, bounds.maxRow, bounds.maxCol),
    ws.layout.getHiddenRowsBitmap(),
    ws.structure.getMergedRegions(),
    ws.layout.getColWidthsBatch(bounds.minCol, bounds.maxCol),
  ]);

  // Build merge lookup: for every cell in a merge, map "row,col" -> the merge region
  const mergeMap = new Map<string, MergedRegion>();
  for (const merge of merges) {
    for (let r = merge.startRow; r <= merge.endRow; r++) {
      for (let c = merge.startCol; c <= merge.endCol; c++) {
        mergeMap.set(`${r},${c}`, merge);
      }
    }
  }

  const colWidths = new Map<number, number>(colWidthPairs);

  return { rangeData, hiddenRows, mergeMap, colWidths, bounds };
}

// =============================================================================
// In-Memory Helpers (zero IPC)
// =============================================================================

/**
 * Get cell data from the pre-fetched range. Returns undefined if out of bounds.
 */
function getCellFromBatch(batch: AutofitBatchData, row: number, col: number): CellData | undefined {
  const rowIdx = row - batch.bounds.minRow;
  const colIdx = col - batch.bounds.minCol;
  return batch.rangeData[rowIdx]?.[colIdx];
}

/**
 * Get the total current width of other columns in a merge (excluding the target column).
 * Uses pre-fetched colWidths map -- zero IPC.
 */
function getOtherMergeColumnsWidth(
  batch: AutofitBatchData,
  merge: MergedRegion,
  targetCol: number,
): number {
  let totalWidth = 0;
  for (let col = merge.startCol; col <= merge.endCol; col++) {
    if (col !== targetCol) {
      totalWidth += batch.colWidths.get(col) ?? DEFAULT_COL_WIDTH;
    }
  }
  return totalWidth;
}

// =============================================================================
// Column Auto-Fit
// =============================================================================

/**
 * Calculate optimal width for a single column.
 *
 * When called standalone (no batch data), fetches data for just this column.
 * When called from autoFitColumns(), uses shared pre-fetched batch data.
 *
 * @param sheetId - Sheet ID
 * @param colIndex - Column index to auto-fit
 * @param textMeasurement - TextMeasurementService for text measurement
 * @param preFormattedMap - Optional map of pre-formatted display strings keyed by "row,col"
 * @param workbook - Workbook for unified API access
 * @returns Optimal width in pixels
 */
export async function calculateColumnAutoFitWidth(
  sheetId: SheetId,
  colIndex: number,
  textMeasurement: TextMeasurementService,
  preFormattedMap?: Map<string, string>,
  workbook?: Workbook,
): Promise<number> {
  if (!workbook) return DEFAULT_COL_WIDTH;
  const ws = workbook.getSheetById(sheetId);

  // Get culture for formatting
  const culture = getDefaultCulture();

  // Get sheet bounds to limit iteration
  const bounds = await getUsedSheetBoundsForAutofit(ws);
  if (!bounds) {
    return DEFAULT_COL_WIDTH;
  }

  // Batch pre-fetch all data for this column's bounds (4 parallel IPC calls)
  const batch = await prefetchAutofitData(ws, bounds);

  return calculateColumnWidthFromBatch(batch, colIndex, textMeasurement, culture, preFormattedMap);
}

/**
 * Auto-fit multiple columns.
 *
 * Performance optimizations:
 * - Pre-fetches ALL data in 4 parallel IPC calls (getRange, getHiddenRowsBitmap,
 * getMergedRegions, getColWidthsBatch)
 * - Single pass for pre-formatting + measurement (no double iteration)
 * - Zero per-cell IPC in measurement loops
 *
 * @param sheetId - Sheet ID
 * @param columns - Array of column indices to auto-fit
 * @param textMeasurement - TextMeasurementService for text measurement
 */
export async function autoFitColumns(
  sheetId: SheetId,
  columns: number[],
  textMeasurement: TextMeasurementService,
  formatBatchFn?: (
    entries: Array<{ value: { type: string; value?: unknown }; formatCode: string }>,
  ) => Promise<string[]>,
  workbook?: Workbook,
): Promise<void> {
  if (columns.length === 0) return;
  if (!workbook) return;

  const ws = workbook.getSheetById(sheetId);

  // Pre-compute bounds once for all columns
  const bounds = await getUsedSheetBoundsForAutofit(ws);
  if (!bounds) {
    // No data - set all columns to default
    await ws.layout.setColumnWidths(columns.map((col) => [col, DEFAULT_COL_WIDTH]));
    return;
  }

  // Batch pre-fetch ALL data upfront (4 parallel IPC calls total)
  const batch = await prefetchAutofitData(ws, bounds);

  // Build pre-formatted map if batch formatting is available
  // Uses batch data -- zero per-cell IPC
  let preFormattedMap: Map<string, string> | undefined;
  if (formatBatchFn) {
    const cellEntries: Array<{
      row: number;
      col: number;
      value: unknown;
      formatCode: string;
    }> = [];

    for (const col of columns) {
      for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
        if (batch.hiddenRows.has(row)) continue;

        const merge = batch.mergeMap.get(`${row},${col}`);
        if (merge && merge.startCol !== col) continue;

        const cellData = getCellFromBatch(batch, row, col);
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

  // Calculate all optimal widths using batch data (zero IPC in the loop)
  const culture = getDefaultCulture();
  const widths: Array<{ col: number; width: number }> = [];

  for (const col of columns) {
    const width = calculateColumnWidthFromBatch(
      batch,
      col,
      textMeasurement,
      culture,
      preFormattedMap,
    );
    widths.push({ col, width });
  }

  await ws.layout.setColumnWidths(widths.map(({ col, width }) => [col, width]));
}

/**
 * Calculate column width using pre-fetched batch data.
 * Pure in-memory computation -- zero IPC calls.
 */
function calculateColumnWidthFromBatch(
  batch: AutofitBatchData,
  colIndex: number,
  textMeasurement: TextMeasurementService,
  culture: ReturnType<typeof getDefaultCulture>,
  preFormattedMap?: Map<string, string>,
): number {
  let maxWidth = MIN_COL_WIDTH;

  for (let row = batch.bounds.minRow; row <= batch.bounds.maxRow; row++) {
    // Skip hidden rows
    if (batch.hiddenRows.has(row)) {
      continue;
    }

    // Check if cell is part of a merge
    const merge = batch.mergeMap.get(`${row},${colIndex}`);

    // Skip if cell is in a merge but not the origin cell
    if (merge && merge.startCol !== colIndex) {
      continue;
    }

    // Get cell value and format from batch data
    const cellData = getCellFromBatch(batch, row, colIndex);
    const value = cellData?.value;
    if (value === undefined || value === null || value === '') {
      continue;
    }

    const format: CellFormat | undefined = cellData?.format ?? undefined;

    let cellWidth: number;

    // Handle rotated text specially
    const preFormatted = preFormattedMap?.get(`${row},${colIndex}`);
    if (format?.textRotation && format.textRotation !== 0) {
      const rotated = textMeasurement.measureRotatedCell(value, format, culture, preFormatted);
      cellWidth = rotated.width;
    } else {
      cellWidth = textMeasurement.measureCellWidth(value, format, culture, preFormatted);
    }

    // For merged cells, distribute width across columns
    if (merge) {
      const mergeColSpan = merge.endCol - merge.startCol + 1;
      if (mergeColSpan > 1) {
        const otherColsWidth = getOtherMergeColumnsWidth(batch, merge, colIndex);
        cellWidth = Math.max(0, cellWidth - otherColsWidth);
      }
    }

    maxWidth = Math.max(maxWidth, cellWidth);
  }

  // Cap at maximum
  return Math.min(maxWidth, MAX_AUTOFIT_WIDTH);
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
