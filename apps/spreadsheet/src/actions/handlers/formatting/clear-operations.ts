/**
 * Clear Operation Action Handlers
 *
 * Handles clearing specific formatting features from selection:
 * - Clear hyperlinks (TODO: implement when hyperlink storage is finalized)
 * - Clear conditional formatting (removes CF rules intersecting selection)
 * - Clear data validation (removes range schemas from selection)
 * - Clear outline/grouping (TODO: implement when grouping feature is added)
 *
 * Complete Clear Operations
 * Multi-sheet support (applied per-sheet)
 *
 * CF clearing now uses Unified Worksheet API for proper event emission.
 */

import type { ActionHandler, AsyncActionHandler } from '@mog-sdk/contracts/actions';

import { getSelectionContext, handled } from './shared';

// =============================================================================
// Clear Operations
// =============================================================================

/**
 * Clear hyperlinks from selected cells.
 * Only removes the hyperlink property, preserves text and formatting.
 *
 * Multi-Sheet Support
 *
 * Hyperlinks are stored in the cells domain using the `h` property.
 * Uses ws.hyperlinks.remove() which preserves cell value/formula/formatting.
 */
export const CLEAR_HYPERLINKS: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const { ranges } = getSelectionContext(deps);

  if (ranges.length === 0) {
    return { handled: false, reason: 'wrong_context' };
  }

  const ws = deps.workbook.getSheetById(sheetId);

  // Remove hyperlinks for all cells in all ranges in parallel.
  // removeHyperlink on a cell without a hyperlink is a no-op,
  // so we skip the per-cell getHyperlink check to avoid extra IPC.
  const removals: Promise<void>[] = [];
  for (const range of ranges) {
    for (let row = range.startRow; row <= range.endRow; row++) {
      for (let col = range.startCol; col <= range.endCol; col++) {
        removals.push(ws.hyperlinks.remove(row, col));
      }
    }
  }
  await Promise.all(removals);

  return handled();
};

/**
 * Clear conditional formatting from selected cells.
 *
 * Complete Clear Operations
 * Uses Unified Worksheet API for proper event emission.
 */
export const CLEAR_CONDITIONAL_FORMATTING: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const { ranges } = getSelectionContext(deps);

  if (ranges.length === 0) {
    return { handled: false, reason: 'wrong_context' };
  }

  // Convert selection ranges to CFCellRange format
  const cfRanges = ranges.map((r) => ({
    startRow: r.startRow,
    startCol: r.startCol,
    endRow: r.endRow,
    endCol: r.endCol,
  }));

  // Use Unified Worksheet API
  const ws = deps.workbook.getSheetById(sheetId);
  await ws.conditionalFormats.clearInRanges(cfRanges);

  return handled();
};

/**
 * Clear data validation from selected cells.
 * Uses unified Worksheet API to clear validation rules overlapping each selected range.
 *
 * Complete Clear Operations
 */
export const CLEAR_DATA_VALIDATION: AsyncActionHandler = async (deps) => {
  const sheetId = deps.getActiveSheetId();
  const { ranges } = getSelectionContext(deps);

  if (ranges.length === 0) {
    return { handled: false, reason: 'wrong_context' };
  }

  const ws = deps.workbook.getSheetById(sheetId);

  // For each selection range, clear overlapping validation rules
  for (const selRange of ranges) {
    const rangeStr = `${deps.workbook.indexToAddress(selRange.startRow, selRange.startCol)}:${deps.workbook.indexToAddress(selRange.endRow, selRange.endCol)}`;
    await ws.validations.clear(rangeStr);
  }

  return handled();
};

/**
 * Clear outline (row/column grouping) from selected range.
 *
 * Complete Clear Operations
 * Note: Outline/grouping is a future feature. This handler returns handled
 * to prevent errors but doesn't do anything yet.
 */
export const CLEAR_OUTLINE: ActionHandler = (_deps) => {
  // TODO: Implement when row/column grouping feature is added
  // For now, return handled since this is a valid action target
  return handled();
};
