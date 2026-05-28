/**
 * Font Style Action Handlers
 *
 * Handles font-related formatting actions:
 * - Font style toggles (bold, italic, underline, strikethrough)
 * - Font properties (size, family, color, theme)
 * - Text effects (superscript, subscript)
 *
 * Rich text editing support for character-level formatting
 * Multi-sheet support for broadcasting changes
 */

import type {
  ActionDependencies,
  ActionResult,
  AsyncActionHandler,
} from '@mog-sdk/contracts/actions';
import type { CellFormat } from '@mog-sdk/contracts/core';
import type { TextFormat } from '@mog-sdk/contracts/rich-text';

import {
  applyCharFormat,
  computeCurrentFormat,
  getRichTextEditingContext,
  getSelectionContext,
  getTargetSheetIds,
  getUIStore,
  handled,
} from './shared';
import { autoFitRowsForBoundedRanges } from './row-autofit';

// =============================================================================
// Constants
// =============================================================================

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
const MAX_FONT_SIZE = 409;
const MIN_FONT_SIZE = 1;

// =============================================================================
// Font Style Toggle Handlers
// =============================================================================

/**
 * Toggle a boolean format property on selected cells.
 * Reads the active cell's current value, then applies the inverse to all selected cells.
 *
 * Rich Text Editing Support
 * - Detects if in rich text editing mode with character selection
 * - If so, applies formatting to selected characters only (for text properties)
 * - wrapText is cell-level only, not supported in rich text
 * - Otherwise, falls back to cell-level formatting
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 * - The toggle state is determined from the active cell on the active sheet
 * - Same new value is applied to all selected sheets
 */
async function toggleFormatProperty(
  deps: ActionDependencies,
  property: 'bold' | 'italic' | 'strikethrough' | 'wrapText',
): Promise<ActionResult> {
  // Check for rich text editing mode
  // Note: wrapText is cell-level only, not a rich text property
  const isTextFormatProperty =
    property === 'bold' || property === 'italic' || property === 'strikethrough';
  const richTextCtx = getRichTextEditingContext(deps);

  if (isTextFormatProperty && richTextCtx && richTextCtx.hasCharSelection) {
    // Apply to character selection - compute current format from selection
    const currentFormat = computeCurrentFormat(
      richTextCtx.segments,
      richTextCtx.selectionStart,
      richTextCtx.selectionEnd,
    );
    // Type assertion is safe because we checked isTextFormatProperty above
    const currentValue = currentFormat[property as keyof TextFormat] ?? false;
    const newValue = !currentValue;

    return applyCharFormat(deps, { [property]: newValue });
  }

  // Cell-level formatting: read current value, toggle, apply
  const ws = deps.workbook.activeSheet;
  const targetSheetIds = getTargetSheetIds(deps);
  const { activeCell, ranges } = getSelectionContext(deps);

  // Read current state from viewport buffer (always up-to-date after setRanges)
  // Note: getActiveCellData() reads from ComputeCore._activeCellData which is never
  // refreshed after format mutations, so we use getCellData(row, col) instead.
  const activeCellData = ws.viewport.getCellData(activeCell.row, activeCell.col);
  const activeCellFormat = activeCellData?.format as Record<string, unknown> | undefined;
  const currentValue = (activeCellFormat?.[property] as boolean) ?? false;
  const newValue = !currentValue;

  // Apply to all selected ranges on ALL selected sheets
  for (const sheetId of targetSheetIds) {
    const targetWs = deps.workbook.getSheetById(sheetId);
    await targetWs.formats.setRanges(ranges, { [property]: newValue });
  }

  // Pending format: if we are NOT currently editing AND the active cell is empty
  // (no display text), store the format toggle as a pending format. The Rust compute
  // layer does not retain format-only entries for cells without values, so when the
  // user subsequently types and commits, the format would be lost. Storing it here
  // allows the sheet-coordinator to re-apply it after commit.
  const isEditing = deps.accessors.editor.isEditing();
  const isCellEmpty = !activeCellData?.displayText;
  if (!isEditing && isCellEmpty) {
    const uiStore = getUIStore(deps);
    const activeSheetId = deps.getActiveSheetId();
    uiStore.getState().setPendingCellFormat({
      format: { [property]: newValue } as Partial<CellFormat>,
      row: activeCell.row,
      col: activeCell.col,
      sheetId: activeSheetId,
    });
  }

  return handled();
}

/**
 * Toggle underline formatting.
 * Toggles between 'single' and 'none' for toolbar button behavior.
 *
 * Rich Text Editing Support
 * - Detects if in rich text editing mode with character selection
 * - If so, applies formatting to selected characters only
 * - Otherwise, falls back to cell-level formatting
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 */
export const TOGGLE_UNDERLINE: AsyncActionHandler = async (deps) => {
  // Check for rich text editing mode
  const richTextCtx = getRichTextEditingContext(deps);
  if (richTextCtx && richTextCtx.hasCharSelection) {
    // Apply to character selection - compute current format from selection
    const currentFormat = computeCurrentFormat(
      richTextCtx.segments,
      richTextCtx.selectionStart,
      richTextCtx.selectionEnd,
    );
    const currentType = currentFormat.underlineType;
    const newType = currentType && currentType !== 'none' ? 'none' : 'single';

    return applyCharFormat(deps, { underlineType: newType });
  }

  // Cell-level formatting: read current value, toggle, apply
  const ws = deps.workbook.activeSheet;
  const targetSheetIds = getTargetSheetIds(deps);
  const { activeCell, ranges } = getSelectionContext(deps);

  // Read current state from viewport buffer (always up-to-date after setRanges)
  const activeCellData = ws.viewport.getCellData(activeCell.row, activeCell.col);
  const activeCellFormat = activeCellData?.format as Record<string, unknown> | undefined;
  const currentType = activeCellFormat?.underlineType as string | undefined;
  const newType = currentType && currentType !== 'none' ? 'none' : 'single';

  // Apply to all selected ranges on ALL selected sheets
  for (const sheetId of targetSheetIds) {
    const targetWs = deps.workbook.getSheetById(sheetId);
    await targetWs.formats.setRanges(ranges, { underlineType: newType });
  }

  // Pending format: if we are NOT currently editing AND the active cell is empty
  // (no display text), store the format toggle as a pending format. The Rust compute
  // layer does not retain format-only entries for cells without values, so when the
  // user subsequently types and commits, the format would be lost. Storing it here
  // allows the sheet-coordinator to re-apply it after commit.
  const isEditing = deps.accessors.editor.isEditing();
  const isCellEmpty = !activeCellData?.displayText;
  if (!isEditing && isCellEmpty) {
    const uiStore = getUIStore(deps);
    const activeSheetId = deps.getActiveSheetId();
    uiStore.getState().setPendingCellFormat({
      format: { underlineType: newType } as Partial<CellFormat>,
      row: activeCell.row,
      col: activeCell.col,
      sheetId: activeSheetId,
    });
  }

  return handled();
};

export const TOGGLE_BOLD: AsyncActionHandler = async (deps) => toggleFormatProperty(deps, 'bold');
export const TOGGLE_ITALIC: AsyncActionHandler = async (deps) =>
  toggleFormatProperty(deps, 'italic');
export const TOGGLE_STRIKETHROUGH: AsyncActionHandler = async (deps) =>
  toggleFormatProperty(deps, 'strikethrough');
export const TOGGLE_WRAP_TEXT: AsyncActionHandler = async (deps) => {
  // Read current wrapText state before toggling
  const ws = deps.workbook.activeSheet;
  const { activeCell, ranges } = getSelectionContext(deps);
  const activeCellData = ws.viewport.getCellData(activeCell.row, activeCell.col);
  const currentFormat = activeCellData?.format as Record<string, unknown> | undefined;
  const currentWrap = (currentFormat?.wrapText as boolean) ?? false;
  const enablingWrap = !currentWrap;

  const result = await toggleFormatProperty(deps, 'wrapText');

  // When enabling word wrap, auto-fit affected rows so height grows to fit wrapped content
  if (enablingWrap) {
    await autoFitRowsForRangeChange(deps, ranges);
  }

  return result;
};

// =============================================================================
// Format Dialog Handler
// =============================================================================

/**
 * Apply font format from Format Cells dialog.
 * Reads pending format from UIStore (set by dialog before dispatch).
 *
 * This handler is called when user clicks Apply/OK in the Font tab.
 * The dialog accumulates changes in local state, stores them in UIStore,
 * then dispatches this action to apply them via Mutations.
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 *
 */
export const APPLY_FONT_FORMAT: AsyncActionHandler = async (deps) => {
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  // Read pending format from UIStore (set by dialog before dispatch)
  const { pendingFontFormat } = getUIStore(deps).getState();
  if (!pendingFontFormat) {
    return handled();
  }

  // Apply to all selected ranges on ALL selected sheets
  // Uses setFormatForRanges for O(1) full row/column performance
  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    await ws.formats.setRanges(ranges, pendingFontFormat);
  }

  // Clear pending format
  getUIStore(deps).getState().clearPendingFontFormat();

  // Auto-fit affected rows so height adjusts to new font size (Excel behavior)
  if (pendingFontFormat.fontSize != null) {
    await autoFitRowsForRangeChange(deps, ranges);
  }

  return handled();
};

// =============================================================================
// Font Property Handlers (C1/C2/C3)
// =============================================================================

/**
 * Auto-fit row heights affected by a font-size or wrap-text change on the
 * active sheet.
 *
 * For full-column selections we skip the eager per-row auto-fit. The
 * column-level format mutation already updates the column's default font,
 * and Excel's actual behavior is to recompute row heights lazily as the
 * layout engine renders rows — not by walking every populated row up
 * front. Iterating a full-column range synchronously is the literal
 * "section too large… 30 second freeze" repro from Nico's Group E report:
 * column-header click sets endRow to MAX_ROWS-1, which pushed both the
 * JS-side rowSet construction and the kernel autoFitRowsAndSet call into
 * 1M-row territory.
 *
 * For bounded ranges (e.g. A1:A100 from drag-select or shift-click) the
 * row count is user-bounded and an eager auto-fit is the right call.
 */
const autoFitRowsForRangeChange = autoFitRowsForBoundedRanges;

/**
 * Set font size for selected cells.
 * Applies the specified size to all cells in the selection.
 *
 * Rich Text Editing Support
 * - Detects if in rich text editing mode with character selection
 * - If so, applies font size to selected characters only
 * - Otherwise, falls back to cell-level formatting
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 */
export const SET_FONT_SIZE: AsyncActionHandler = async (deps, payload?: { size: number }) => {
  if (!payload || typeof payload.size !== 'number') {
    return { handled: false, reason: 'disabled' };
  }

  // Check for rich text editing mode
  const richTextCtx = getRichTextEditingContext(deps);
  if (richTextCtx && richTextCtx.hasCharSelection) {
    return applyCharFormat(deps, { fontSize: payload.size });
  }

  // Cell-level formatting (existing behavior)
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  // Apply to all selected ranges on ALL selected sheets
  // Uses setFormatForRanges for O(1) full row/column performance
  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    await ws.formats.setRanges(ranges, { fontSize: payload.size });
  }

  // Auto-fit affected rows so height adjusts to new font size (Excel behavior)
  await autoFitRowsForRangeChange(deps, ranges);

  return handled();
};

/**
 * Set font family for selected cells.
 * Applies the specified font family to all cells in the selection.
 *
 * Rich Text Editing Support
 * - Detects if in rich text editing mode with character selection
 * - If so, applies font family to selected characters only
 * - Otherwise, falls back to cell-level formatting
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 */
export const SET_FONT_FAMILY: AsyncActionHandler = async (deps, payload?: { family: string }) => {
  if (!payload || typeof payload.family !== 'string') {
    return { handled: false, reason: 'disabled' };
  }

  // Check for rich text editing mode
  const richTextCtx = getRichTextEditingContext(deps);
  if (richTextCtx && richTextCtx.hasCharSelection) {
    return applyCharFormat(deps, { fontFamily: payload.family });
  }

  // Cell-level formatting (existing behavior)
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  // Apply to all selected ranges on ALL selected sheets
  // When setting a concrete font family, clear any theme font reference
  // Uses setFormatForRanges for O(1) full row/column performance
  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    await ws.formats.setRanges(ranges, {
      fontFamily: payload.family,
      fontTheme: undefined, // Clear theme font when setting concrete font
    });
  }

  return handled();
};

/**
 * Set font color for selected cells.
 * Applies the specified color to all cells in the selection.
 *
 * Rich Text Editing Support
 * - Detects if in rich text editing mode with character selection
 * - If so, applies font color to selected characters only
 * - Otherwise, falls back to cell-level formatting
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 */
export const SET_FONT_COLOR: AsyncActionHandler = async (deps, payload?: { color: string }) => {
  if (!payload || typeof payload.color !== 'string') {
    return { handled: false, reason: 'disabled' };
  }

  // Record the picked color as the toolbar's last-used. This must happen
  // regardless of whether the apply lands in rich-text mode or cell-level
  // mode — both represent an explicit user pick. Recording in the
  // handler keeps `dispatch()` as the single write path so any caller
  // (toolbar, keytips, AI, future entry points) records last-used
  // identically without re-implementing the rule.
  getUIStore(deps).getState().setLastUsedFontColor(payload.color);

  // Check for rich text editing mode
  const richTextCtx = getRichTextEditingContext(deps);
  if (richTextCtx && richTextCtx.hasCharSelection) {
    return applyCharFormat(deps, { fontColor: payload.color });
  }

  // Cell-level formatting (existing behavior)
  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  // Apply to all selected ranges on ALL selected sheets
  // Uses setFormatForRanges for O(1) full row/column performance
  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    await ws.formats.setRanges(ranges, { fontColor: payload.color });
  }

  return handled();
};

/**
 * Set background color for selected cells.
 * Pass a color string to apply a fill, or null/undefined to remove it.
 * Multi-sheet support
 */
export const SET_BACKGROUND_COLOR: AsyncActionHandler = async (
  deps,
  payload?: { color: string | null | undefined },
) => {
  // Require payload object to be present; color may be null/undefined to clear fill
  if (
    !payload ||
    (payload.color !== null && payload.color !== undefined && typeof payload.color !== 'string')
  ) {
    return { handled: false, reason: 'disabled' };
  }

  // Record the picked color as the toolbar's last-used. Skip recording on
  // null/undefined ("No Fill" / clear) so the icon's first-use default is
  // preserved until the user picks a real color — this also keeps
  // `lastUsedFillColor: string | null` unambiguous (`null` always means
  // "no prior pick", never "explicit clear").
  if (typeof payload.color === 'string') {
    getUIStore(deps).getState().setLastUsedFillColor(payload.color);
  }

  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  // null/undefined color clears the fill; a string value applies it
  const color = payload.color ?? null;

  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    if (color === null) {
      await ws.formats.clearFillForRanges(ranges);
    } else {
      await ws.formats.setRanges(ranges, { backgroundColor: color });
    }
  }

  return handled();
};

/**
 * Set theme font for selected cells (+Headings or +Body).
 *
 * When fontTheme is set, the cell uses the theme's major/minor font
 * instead of a concrete fontFamily. This allows cells to automatically
 * update when the workbook theme changes.
 *
 * Multi-sheet support: Applies to all selected sheets
 */
export const SET_FONT_THEME: AsyncActionHandler = async (
  deps,
  payload?: { fontTheme: 'major' | 'minor' },
) => {
  if (!payload || !payload.fontTheme) {
    return { handled: false, reason: 'disabled' };
  }

  const targetSheetIds = getTargetSheetIds(deps);
  const { ranges } = getSelectionContext(deps);

  // Apply to all selected ranges on ALL selected sheets
  // Uses setFormatForRanges for O(1) full row/column performance
  for (const sheetId of targetSheetIds) {
    const ws = deps.workbook.getSheetById(sheetId);
    await ws.formats.setRanges(ranges, { fontTheme: payload.fontTheme });
  }

  return handled();
};

/**
 * Increase font size for selected cells.
 * Smart stepping: finds next larger preset size, or increments by 10 for sizes >= 72.
 *
 * Stepping behavior:
 * - Below 72: Find next larger size in FONT_SIZES array
 * - At or above 72: Increment by 10
 * - Maximum: 409
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 * - The base size is determined from the active cell on the active sheet
 */
export const INCREASE_FONT_SIZE: AsyncActionHandler = async (deps) => {
  const ws = deps.workbook.activeSheet;
  const targetSheetIds = getTargetSheetIds(deps);
  const { activeCell, ranges } = getSelectionContext(deps);

  // Get current font size from active cell via viewport buffer (always up-to-date)
  const activeCellFormat = ws.viewport.getCellData(activeCell.row, activeCell.col)?.format as
    | Record<string, unknown>
    | undefined;
  const currentSize = (activeCellFormat?.fontSize as number) ?? 11;

  // Find next larger size
  let newSize: number;
  if (currentSize >= 72) {
    // For sizes >= 72, increment by 10
    newSize = Math.min(currentSize + 10, MAX_FONT_SIZE);
  } else {
    // Find next preset size
    const nextPreset = FONT_SIZES.find((s) => s > currentSize);
    newSize = nextPreset ?? Math.min(currentSize + 1, MAX_FONT_SIZE);
  }

  // Apply to all selected ranges on ALL selected sheets
  // Uses setFormatForRanges for O(1) full row/column performance
  for (const sheetId of targetSheetIds) {
    const targetWs = deps.workbook.getSheetById(sheetId);
    await targetWs.formats.setRanges(ranges, { fontSize: newSize });
  }

  // Auto-fit affected rows so height grows to accommodate larger font (Excel behavior)
  await autoFitRowsForRangeChange(deps, ranges);

  return handled();
};

/**
 * Decrease font size for selected cells.
 * Smart stepping: finds next smaller preset size, or decrements by 10 for sizes > 72.
 *
 * Stepping behavior:
 * - Above 72: Decrement by 10 (minimum 72)
 * - At or below 72: Find next smaller size in FONT_SIZES array
 * - Minimum: 1
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 * - The base size is determined from the active cell on the active sheet
 */
export const DECREASE_FONT_SIZE: AsyncActionHandler = async (deps) => {
  const ws = deps.workbook.activeSheet;
  const targetSheetIds = getTargetSheetIds(deps);
  const { activeCell, ranges } = getSelectionContext(deps);

  // Get current font size from active cell via viewport buffer (always up-to-date)
  const activeCellFormat = ws.viewport.getCellData(activeCell.row, activeCell.col)?.format as
    | Record<string, unknown>
    | undefined;
  const currentSize = (activeCellFormat?.fontSize as number) ?? 11;

  // Find next smaller size
  let newSize: number;
  if (currentSize > 72) {
    // For sizes > 72, decrement by 10
    newSize = Math.max(currentSize - 10, 72);
  } else {
    // Find next smaller preset size
    const smallerPresets = FONT_SIZES.filter((s) => s < currentSize);
    newSize =
      smallerPresets.length > 0
        ? smallerPresets[smallerPresets.length - 1]
        : Math.max(currentSize - 1, MIN_FONT_SIZE);
  }

  // Apply to all selected ranges on ALL selected sheets
  // Uses setFormatForRanges for O(1) full row/column performance
  for (const sheetId of targetSheetIds) {
    const targetWs = deps.workbook.getSheetById(sheetId);
    await targetWs.formats.setRanges(ranges, { fontSize: newSize });
  }

  // Auto-fit affected rows so height adjusts to smaller font (Excel behavior)
  await autoFitRowsForRangeChange(deps, ranges);

  return handled();
};

// =============================================================================
// Text Effect Handlers
// =============================================================================

/**
 * Toggle superscript for selected cells.
 * Superscript and subscript are mutually exclusive - enabling one disables the other.
 *
 * Rich Text Editing Support
 * - Detects if in rich text editing mode with character selection
 * - If so, applies superscript to selected characters only
 * - Otherwise, falls back to cell-level formatting
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 * Protection: Skips protected cells silently (Excel behavior)
 */
export const TOGGLE_SUPERSCRIPT: AsyncActionHandler = async (deps) => {
  // Check for rich text editing mode
  const richTextCtx = getRichTextEditingContext(deps);
  if (richTextCtx && richTextCtx.hasCharSelection) {
    // Apply to character selection - compute current format from selection
    const currentFormat = computeCurrentFormat(
      richTextCtx.segments,
      richTextCtx.selectionStart,
      richTextCtx.selectionEnd,
    );
    const currentValue = currentFormat.superscript ?? false;
    const newValue = !currentValue;

    // Superscript and subscript are mutually exclusive
    return applyCharFormat(deps, {
      superscript: newValue,
      subscript: newValue ? false : undefined,
    });
  }

  // Cell-level formatting (existing behavior)
  const ws = deps.workbook.activeSheet;
  const targetSheetIds = getTargetSheetIds(deps);
  const { activeCell, ranges } = getSelectionContext(deps);

  // Read current state from viewport buffer (always up-to-date)
  const activeCellFormat = ws.viewport.getCellData(activeCell.row, activeCell.col)?.format as
    | Record<string, unknown>
    | undefined;
  const currentValue = (activeCellFormat?.superscript as boolean) ?? false;
  const newValue = !currentValue;

  // Apply to all selected ranges on ALL selected sheets
  // Superscript and subscript are mutually exclusive
  for (const sheetId of targetSheetIds) {
    const targetWs = deps.workbook.getSheetById(sheetId);
    await targetWs.formats.setRanges(ranges, {
      superscript: newValue,
      subscript: newValue ? false : undefined,
    });
  }

  return handled();
};

/**
 * Toggle subscript for selected cells.
 * Superscript and subscript are mutually exclusive - enabling one disables the other.
 *
 * Rich Text Editing Support
 * - Detects if in rich text editing mode with character selection
 * - If so, applies subscript to selected characters only
 * - Otherwise, falls back to cell-level formatting
 *
 * Multi-Sheet Support
 * - Broadcasts to all selected sheets when multiple sheets are selected
 * Protection: Skips protected cells silently (Excel behavior)
 */
export const TOGGLE_SUBSCRIPT: AsyncActionHandler = async (deps) => {
  // Check for rich text editing mode
  const richTextCtx = getRichTextEditingContext(deps);
  if (richTextCtx && richTextCtx.hasCharSelection) {
    // Apply to character selection - compute current format from selection
    const currentFormat = computeCurrentFormat(
      richTextCtx.segments,
      richTextCtx.selectionStart,
      richTextCtx.selectionEnd,
    );
    const currentValue = currentFormat.subscript ?? false;
    const newValue = !currentValue;

    // Superscript and subscript are mutually exclusive
    return applyCharFormat(deps, {
      subscript: newValue,
      superscript: newValue ? false : undefined,
    });
  }

  // Cell-level formatting (existing behavior)
  const ws = deps.workbook.activeSheet;
  const targetSheetIds = getTargetSheetIds(deps);
  const { activeCell, ranges } = getSelectionContext(deps);

  // Read current state from viewport buffer (always up-to-date)
  const activeCellFormat = ws.viewport.getCellData(activeCell.row, activeCell.col)?.format as
    | Record<string, unknown>
    | undefined;
  const currentValue = (activeCellFormat?.subscript as boolean) ?? false;
  const newValue = !currentValue;

  // Apply to all selected ranges on ALL selected sheets
  // Superscript and subscript are mutually exclusive
  for (const sheetId of targetSheetIds) {
    const targetWs = deps.workbook.getSheetById(sheetId);
    await targetWs.formats.setRanges(ranges, {
      subscript: newValue,
      superscript: newValue ? false : undefined,
    });
  }

  return handled();
};
