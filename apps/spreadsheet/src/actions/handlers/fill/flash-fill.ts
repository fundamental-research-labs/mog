/**
 * Flash Fill Handlers
 *
 * Implements Flash Fill (Ctrl+E) pattern detection and application.
 * Detects transformation patterns from user examples and applies them.
 */

import type {
  ActionDependencies,
  ActionHandler,
  ActionResult,
  AsyncActionHandler,
} from '@mog-sdk/contracts/actions';
import type { Worksheet } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';

import type { FlashFillContext, FlashFillExample } from '../../../domain/fill/flash-fill';
import { DEFAULT_FLASH_FILL_CONFIG, detectFlashFillPattern } from '../../../domain/fill/flash-fill';
import { guardBridgeMutation } from '../bridge-error-guard';
import { getUIStore, handled, notHandled } from './types';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Collect Flash Fill examples from the current column.
 *
 * An example is a row where:
 * 1. The target column has a user-entered value (not empty)
 * 2. At least one adjacent source column has data
 *
 * Uses ws.getRange() for batch reads (Unified Worksheet API).
 *
 * @param ws - Worksheet instance
 * @param targetCol - Column where Flash Fill is triggered
 * @param startRow - First row to consider
 * @param endRow - Last row to consider
 * @param sourceColumns - Adjacent columns to check for source data
 * @returns Array of Flash Fill examples
 */
async function collectFlashFillExamples(
  ws: Worksheet,
  targetCol: number,
  startRow: number,
  endRow: number,
  sourceColumns: number[],
): Promise<FlashFillExample[]> {
  const examples: FlashFillExample[] = [];

  // Batch-query all needed columns at once via ws.getRange
  const allCols = [targetCol, ...sourceColumns];
  const minCol = Math.min(...allCols);
  const maxCol = Math.max(...allCols);
  const rangeData = await ws.getRange(startRow, minCol, endRow, maxCol);

  // Build a lookup: (row, col) -> display value
  const cellLookup = new Map<string, string>();
  for (let r = 0; r < rangeData.length; r++) {
    for (let c = 0; c < rangeData[r].length; c++) {
      const cell = rangeData[r][c];
      const value = cell?.value;
      cellLookup.set(`${startRow + r},${minCol + c}`, value != null ? String(value) : '');
    }
  }

  for (let row = startRow; row <= endRow; row++) {
    const outputValue = cellLookup.get(`${row},${targetCol}`) ?? '';

    // Skip empty cells - not an example
    if (outputValue === '') {
      continue;
    }

    // Collect source values from all source columns
    const sourceValues: any[] = [];
    let hasSource = false;

    for (const sourceCol of sourceColumns) {
      const srcValue = cellLookup.get(`${row},${sourceCol}`) ?? '';
      sourceValues.push(srcValue || null);
      if (srcValue !== '') {
        hasSource = true;
      }
    }

    // Only include rows where we have both output and at least one source
    if (hasSource) {
      examples.push({
        source: sourceValues,
        output: outputValue,
        row,
      });
    }
  }

  return examples;
}

/**
 * Collect source data for all rows from source columns.
 *
 * Uses ws.getRange() for batch reads (Unified Worksheet API).
 *
 * @param ws - Worksheet instance
 * @param sourceColumns - Source column indices
 * @param startRow - First row
 * @param endRow - Last row
 * @returns Map of column index to array of values
 */
async function collectSourceData(
  ws: Worksheet,
  sourceColumns: number[],
  startRow: number,
  endRow: number,
): Promise<Map<number, any[]>> {
  const sourceData = new Map<number, any[]>();

  if (sourceColumns.length === 0) return sourceData;

  // Batch-query all source columns at once via ws.getRange
  const minCol = Math.min(...sourceColumns);
  const maxCol = Math.max(...sourceColumns);
  const rangeData = await ws.getRange(startRow, minCol, endRow, maxCol);

  // Build lookup from 2D array
  const cellLookup = new Map<string, any>();
  for (let r = 0; r < rangeData.length; r++) {
    for (let c = 0; c < rangeData[r].length; c++) {
      const cell = rangeData[r][c];
      const value = cell?.value;
      cellLookup.set(`${startRow + r},${minCol + c}`, value != null ? String(value) : null);
    }
  }

  for (const col of sourceColumns) {
    const values: any[] = [];
    for (let row = startRow; row <= endRow; row++) {
      values.push(cellLookup.get(`${row},${col}`) ?? null);
    }
    sourceData.set(col, values);
  }

  return sourceData;
}

/**
 * Find the extent of data in a column (first and last non-empty rows).
 *
 * Uses ws.getRange() for batch reads (Unified Worksheet API).
 *
 * @param ws - Worksheet instance
 * @param col - Column to scan
 * @param activeRow - Current row (to determine direction)
 * @returns Object with startRow and endRow
 */
async function findColumnDataExtent(
  ws: Worksheet,
  col: number,
  activeRow: number,
): Promise<{ startRow: number; endRow: number }> {
  const MAX_SCAN = 1000;

  // Batch-query the column around the active row via ws.getRange
  const queryStartRow = Math.max(0, activeRow - MAX_SCAN);
  const queryEndRow = activeRow + MAX_SCAN;
  const rangeData = await ws.getRange(queryStartRow, col, queryEndRow, col);

  // Build a set of rows that have data
  const rowsWithData = new Set<number>();
  for (let r = 0; r < rangeData.length; r++) {
    const cell = rangeData[r]?.[0];
    const value = cell?.value;
    if (value != null && String(value) !== '') {
      rowsWithData.add(queryStartRow + r);
    }
  }

  // Scan upward from activeRow
  let startRow = activeRow;
  for (let i = 0; i < MAX_SCAN; i++) {
    const row = activeRow - i - 1;
    if (row < 0) break;
    if (!rowsWithData.has(row)) break;
    startRow = row;
  }

  // Scan downward from activeRow
  let endRow = activeRow;
  for (let i = 0; i < MAX_SCAN; i++) {
    const row = activeRow + i + 1;
    if (!rowsWithData.has(row)) break;
    endRow = row;
  }

  return { startRow, endRow };
}

// =============================================================================
// Handlers
// =============================================================================

/**
 * FLASH_FILL
 *
 * Triggers Flash Fill pattern detection and application (Ctrl+E).
 *
 * Algorithm:
 * 1. Get current selection (active cell column is the target)
 * 2. Find adjacent columns as potential sources
 * 3. Collect examples from rows that already have values in target column
 * 4. Detect transformation pattern from examples
 * 5. Generate values for remaining empty cells
 * 6. Apply values to the target column
 *
 * Helper functions now use Unified Worksheet API (ws.getRange)
 * for batch cell reads.
 */
export const FLASH_FILL: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  // Get current selection via accessor
  const activeCell = deps.accessors.selection.getActiveCell();

  if (!activeCell) {
    return notHandled('disabled');
  }

  const targetCol = activeCell.col;
  const activeRow = activeCell.row;

  // Determine source columns (adjacent columns to the left, then right)
  const sourceColumns: number[] = [];
  const maxSourceCols = DEFAULT_FLASH_FILL_CONFIG.maxSourceColumns;

  // Add columns to the left (most likely sources)
  for (let i = 1; i <= maxSourceCols && targetCol - i >= 0; i++) {
    sourceColumns.push(targetCol - i);
  }

  // Add columns to the right as fallback
  for (let i = 1; i <= maxSourceCols - sourceColumns.length; i++) {
    sourceColumns.push(targetCol + i);
  }

  if (sourceColumns.length === 0) {
    return {
      handled: true,
      error: 'Flash Fill requires adjacent data columns',
    };
  }

  // Find data extent - look for contiguous data region
  // Use first source column to determine extent
  const primarySourceCol = sourceColumns[0];
  const { startRow, endRow } = await findColumnDataExtent(ws, primarySourceCol, activeRow);

  if (startRow === endRow) {
    return {
      handled: true,
      error: 'Flash Fill requires data in adjacent columns',
    };
  }

  // Collect examples (rows with values in target column)
  const examples = await collectFlashFillExamples(ws, targetCol, startRow, endRow, sourceColumns);

  if (examples.length < DEFAULT_FLASH_FILL_CONFIG.minExamples) {
    return {
      handled: true,
      error: 'Flash Fill requires at least one example (enter a transformed value first)',
    };
  }

  // Collect source data for all rows
  const sourceData = await collectSourceData(ws, sourceColumns, startRow, endRow);

  // Build context for pattern detection
  const context: FlashFillContext = {
    targetColumn: targetCol,
    startRow,
    endRow,
    examples,
    sourceData,
    sheetId,
  };

  // Track effective start row for correct fill alignment
  // This may change if fallback logic is used (header row detected)
  let effectiveStartRow = startRow;
  let effectiveExamples = examples;

  // Detect pattern - try first with all examples
  let result = detectFlashFillPattern(context, DEFAULT_FLASH_FILL_CONFIG);

  // Single fallback attempt - if pattern detection fails and we have 2+ examples,
  // try again without the first example (which may be a header row)
  if (!result.success && examples.length >= 2) {
    // Adjust start row for fallback - skip potential header
    effectiveStartRow = startRow + 1;

    // Remove first example (possible header)
    effectiveExamples = examples.slice(1);

    // CRITICAL: Recollect source data with new start row
    // Cannot reuse original sourceData array because indices would be wrong
    const fallbackSourceData = await collectSourceData(
      ws,
      sourceColumns,
      effectiveStartRow,
      endRow,
    );

    const fallbackContext: FlashFillContext = {
      targetColumn: targetCol,
      startRow: effectiveStartRow,
      endRow,
      examples: effectiveExamples,
      sourceData: fallbackSourceData,
      sheetId,
    };

    result = detectFlashFillPattern(fallbackContext, DEFAULT_FLASH_FILL_CONFIG);
  }

  if (!result.success || !result.values || !result.filledRows) {
    return {
      handled: true,
      error: result.error || 'Flash Fill could not detect a pattern',
    };
  }

  // Protection check for target cells
  for (const row of result.filledRows) {
    if (!(await ws.protection.canEditCell(row, targetCol))) {
      return {
        handled: true,
        error: `Cannot apply Flash Fill: Cell at row ${row + 1} is protected`,
      };
    }
  }

  // Apply values to target column via unified Worksheet API
  // Values array is indexed from 0 corresponding to startRow
  // IMPORTANT: Use effectiveStartRow and effectiveExamples for correct alignment
  // when fallback logic was used (header row skipped)
  const updates: Array<{ row: number; col: number; value: any }> = [];
  for (let i = 0; i < result.values!.length; i++) {
    const row = effectiveStartRow + i;
    // Only fill non-example rows
    if (!effectiveExamples.some((e) => e.row === row)) {
      const value = result.values![i];
      if (value !== undefined && value !== '') {
        updates.push({ row, col: targetCol, value: String(value) });
      }
    }
  }
  if (updates.length > 0) {
    const ok = await guardBridgeMutation(async () => {
      await ws.setCells(updates);
    });
    if (!ok) return handled();
  }

  // Expand selection to include filled range
  // Use effectiveStartRow when fallback was used for correct selection alignment
  deps.commands.selection.setSelection(
    [
      {
        startRow: effectiveStartRow,
        startCol: targetCol,
        endRow,
        endCol: targetCol,
      },
    ],
    activeCell,
  );

  return handled();
};

/**
 * SHOW_FLASH_FILL_PREVIEW
 *
 * Shows a ghosted preview of Flash Fill results.
 * Called when a pattern is detected from user input.
 *
 * Payload:
 * - sheetId: Sheet where preview should appear
 * - sourceColumn: Column with source data
 * - targetColumn: Column where preview values will appear
 * - previewValues: Array of { row, col, value } preview values
 * - patternDescription: Description of detected pattern
 * - confidence: Pattern confidence (0-1)
 * - startRow: First row of preview range
 * - endRow: Last row of preview range
 *
 */
export const SHOW_FLASH_FILL_PREVIEW: ActionHandler = (
  deps: ActionDependencies,
  payload?: {
    sheetId: SheetId;
    sourceColumn: number;
    targetColumn: number;
    previewValues: Array<{ row: number; col: number; value: any }>;
    patternDescription: string;
    confidence: number;
    startRow: number;
    endRow: number;
  },
): ActionResult => {
  if (!payload) {
    return { handled: false, reason: 'disabled', error: 'No preview data provided' };
  }

  const uiStore = getUIStore(deps);

  uiStore.getState().showFlashFillPreview({
    sheetId: payload.sheetId,
    sourceColumn: payload.sourceColumn,
    targetColumn: payload.targetColumn,
    previewValues: payload.previewValues,
    patternDescription: payload.patternDescription,
    confidence: payload.confidence,
    startRow: payload.startRow,
    endRow: payload.endRow,
  });

  return handled();
};

/**
 * ACCEPT_FLASH_FILL
 *
 * Accepts and applies the current Flash Fill preview.
 * Called when user presses Enter/Tab while preview is shown,
 * or explicitly accepts via UI.
 *
 * Algorithm:
 * 1. Get preview values from UIStore
 * 2. Apply values to target cells
 * 3. Hide the preview
 *
 */
export const ACCEPT_FLASH_FILL: AsyncActionHandler = async (
  deps: ActionDependencies,
): Promise<ActionResult> => {
  const uiStore = getUIStore(deps);

  // Get the current preview state
  const preview = uiStore.getState().flashFillPreview;

  if (!preview.isShowingPreview || preview.previewValues.length === 0) {
    return { handled: false, reason: 'disabled', error: 'No preview to accept' };
  }

  const sheetId = preview.sheetId;
  if (!sheetId) {
    return { handled: false, reason: 'disabled', error: 'No sheet ID in preview' };
  }

  const targetCol = preview.targetColumn;
  if (targetCol === null) {
    return { handled: false, reason: 'disabled', error: 'No target column in preview' };
  }

  const ws = deps.workbook.getSheetById(sheetId);

  // Protection check for target cells
  for (const pv of preview.previewValues) {
    if (!(await ws.protection.canEditCell(pv.row, pv.col))) {
      return {
        handled: true,
        error: `Cannot apply Flash Fill: Cell at row ${pv.row + 1} is protected`,
      };
    }
  }

  // Apply values to target column via unified Worksheet API
  const updates: Array<{ row: number; col: number; value: any }> = [];
  for (const pv of preview.previewValues) {
    if (pv.value !== undefined && pv.value !== '') {
      updates.push({ row: pv.row, col: pv.col, value: String(pv.value) });
    }
  }
  if (updates.length > 0) {
    const ok = await guardBridgeMutation(async () => {
      await ws.setCells(updates);
    });
    if (!ok) return handled();
  }

  // Update selection to include filled range
  if (preview.startRow !== null && preview.endRow !== null) {
    const activeCell = deps.accessors.selection.getActiveCell();
    deps.commands.selection.setSelection(
      [
        {
          startRow: preview.startRow,
          startCol: targetCol,
          endRow: preview.endRow,
          endCol: targetCol,
        },
      ],
      activeCell,
    );
  }

  // Hide the preview
  uiStore.getState().hideFlashFillPreview();

  return handled();
};

/**
 * REJECT_FLASH_FILL
 *
 * Dismisses the current Flash Fill preview.
 * Called when user presses Escape, continues typing a different pattern,
 * or explicitly rejects via UI.
 *
 */
export const REJECT_FLASH_FILL: ActionHandler = (deps: ActionDependencies): ActionResult => {
  const uiStore = getUIStore(deps);

  // Check if there's a preview to reject
  const preview = uiStore.getState().flashFillPreview;
  if (!preview.isShowingPreview) {
    return { handled: false, reason: 'disabled', error: 'No preview to reject' };
  }

  // Hide the preview
  uiStore.getState().hideFlashFillPreview();

  return handled();
};
