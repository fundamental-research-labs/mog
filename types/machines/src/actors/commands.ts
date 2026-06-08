/**
 * Actor Commands Interfaces
 *
 * Type-safe command interfaces for state machine actors.
 * These interfaces define the methods that handlers/hooks use to send events
 * to their corresponding state machines.
 *
 * All methods are fire-and-forget (return void) - commands trigger state
 * transitions, not queries.
 *
 *
 * @module @mog-sdk/contracts/actors/commands
 */

import type { RichTextSegment, TextFormat } from '@mog/types-core/rich-text';
import type { CellRange } from '@mog/types-core';
import type { CellSchema } from '@mog/types-commands/schema';
import type { ChartType } from '@mog/types-data/data/charts';
import type { CellEditorType } from '@mog/types-editor/editor/editor';
import type { CellCoord, Direction } from '../machines/types';
import type { Point } from '@mog/types-viewport';
import type { ClipboardData, ExternalPastePayload, PasteSpecialOptions } from './clipboard';
import type { FindReplaceCommands } from './find-replace';
import type { OperationObjectState, OperationResizeHandle } from './object-interaction';
import type { PaneFocusCommands } from './pane-focus';
import type { RendererCommands } from './renderer';
import type { ComposeCommentType } from './comment';

// =============================================================================
// SELECTION COMMANDS
// =============================================================================

/**
 * Commands for the selection state machine.
 * Handles cell selection, range selection, fill handle, drag-drop, and resize.
 *
 * @see state-machines/src/selection-machine.ts
 * @see state-machines/src/selection/types.ts
 */
export interface SelectionCommands {
  // -------------------------------------------------------------------------
  // Mouse Events
  // -------------------------------------------------------------------------

  /**
   * Handle mouse down on a cell. The optional `mergedRegion`
   * argument is gone — the machine resolves merges itself via
   * `ctx.getMergedRegionAt` (set by `setLayoutCallbacks`).
   *
   * @param cell - Target cell coordinates
   * @param shiftKey - Whether shift key is held (extend selection)
   * @param ctrlKey - Whether ctrl/cmd key is held (multi-select)
   */
  mouseDown(cell: CellCoord, shiftKey: boolean, ctrlKey: boolean): void;

  /**
   * Handle mouse move during selection drag.
   * @param cell - Current cell under cursor
   */
  mouseMove(cell: CellCoord): void;

  /**
   * Handle mouse up to end selection drag.
   */
  mouseUp(): void;

  // -------------------------------------------------------------------------
  // Keyboard Navigation
  // -------------------------------------------------------------------------

  /**
   * Handle arrow key navigation.
   * @param direction - Arrow key direction
   * @param shiftKey - Whether shift key is held (extend selection)
   */
  keyArrow(direction: Direction, shiftKey: boolean): void;

  /**
   * Handle Ctrl+Arrow for jump navigation.
   * @param direction - Arrow key direction
   * @param shiftKey - Whether shift key is held (extend selection)
   */
  keyCtrlArrow(direction: Direction, shiftKey?: boolean): void;

  /**
   * Handle Home key.
   * @param ctrlKey - Whether ctrl key is held (go to A1)
   * @param shiftKey - Whether shift key is held (extend selection)
   */
  keyHome(ctrlKey: boolean, shiftKey?: boolean): void;

  /**
   * Handle End key.
   * @param ctrlKey - Whether ctrl key is held (go to last used cell)
   * @param shiftKey - Whether shift key is held (extend selection)
   */
  keyEnd(ctrlKey: boolean, shiftKey?: boolean): void;

  /**
   * Handle Tab key for cycling within selection.
   * @param shiftKey - Whether shift key is held (reverse direction)
   */
  keyTab(shiftKey: boolean): void;

  /**
   * Handle Enter key for cycling within selection.
   * @param shiftKey - Whether shift key is held (reverse direction)
   */
  keyEnter(shiftKey: boolean): void;

  /**
   * Handle Ctrl+A to select all cells.
   */
  selectAll(): void;

  // -------------------------------------------------------------------------
  // Page Navigation
  // -------------------------------------------------------------------------

  /**
   * Handle Page Up key.
   * @param visibleRows - Number of visible rows for page size
   * @param shiftKey - Whether shift key is held (extend selection)
   */
  pageUp(visibleRows: number, shiftKey?: boolean): void;

  /**
   * Handle Page Down key.
   * @param visibleRows - Number of visible rows for page size
   * @param shiftKey - Whether shift key is held (extend selection)
   */
  pageDown(visibleRows: number, shiftKey?: boolean): void;

  /**
   * Handle Alt+Page Left (horizontal page).
   * @param visibleCols - Number of visible columns for page size
   * @param shiftKey - Whether shift key is held (extend selection)
   */
  pageLeft(visibleCols: number, shiftKey?: boolean): void;

  /**
   * Handle Alt+Page Right (horizontal page).
   * @param visibleCols - Number of visible columns for page size
   * @param shiftKey - Whether shift key is held (extend selection)
   */
  pageRight(visibleCols: number, shiftKey?: boolean): void;

  /**
   * Go to a specific cell (Ctrl+G / Name Box).
   * @param cell - Target cell coordinates
   */
  goTo(cell: CellCoord): void;

  // -------------------------------------------------------------------------
  // Formula Range Mode
  // -------------------------------------------------------------------------

  /**
   * Enter formula range mode for range reference highlighting.
   * @param color - Highlight color for the range
   */
  enterFormulaRangeMode(color: string): void;

  /**
   * Exit formula range mode.
   */
  exitFormulaRangeMode(): void;

  /**
   * Enter range selection mode for dialog inputs.
   */
  enterRangeSelectionMode(): void;

  /**
   * Exit range selection mode.
   */
  exitRangeSelectionMode(): void;

  // -------------------------------------------------------------------------
  // Fill Handle
  // -------------------------------------------------------------------------

  /**
   * Start fill handle drag.
   */
  startFillHandleDrag(): void;

  /**
   * Update fill handle drag position.
   * @param cell - Current cell under cursor
   */
  fillHandleDrag(cell: CellCoord): void;

  /**
   * End fill handle drag and execute fill.
   */
  endFillHandleDrag(): void;

  /**
   * Start right-click fill handle drag (shows menu).
   */
  startRightFillHandleDrag(): void;

  /**
   * Update right-click fill handle drag position.
   * @param cell - Current cell under cursor
   */
  rightFillHandleDrag(cell: CellCoord): void;

  /**
   * End right-click fill handle drag.
   */
  endRightFillHandleDrag(): void;

  /**
   * Clear fill context after fill operation completes.
   */
  clearFillContext(): void;

  // -------------------------------------------------------------------------
  // Header Selection
  // -------------------------------------------------------------------------

  /**
   * Select entire column(s).
   * @param col - Column index
   * @param shiftKey - Whether shift key is held (extend selection)
   * @param ctrlKey - Whether ctrl/cmd key is held (multi-select)
   * @param fromKeyboard - Whether triggered by keyboard shortcut (stays in idle, no drag state)
   */
  selectColumn(col: number, shiftKey: boolean, ctrlKey: boolean, fromKeyboard?: boolean): void;

  /**
   * Select entire row(s).
   * @param row - Row index
   * @param shiftKey - Whether shift key is held (extend selection)
   * @param ctrlKey - Whether ctrl/cmd key is held (multi-select)
   * @param fromKeyboard - Whether triggered by keyboard shortcut (stays in idle, no drag state)
   */
  selectRow(row: number, shiftKey: boolean, ctrlKey: boolean, fromKeyboard?: boolean): void;

  /**
   * Handle column header mouse move (for range selection).
   * @param col - Column index under cursor
   */
  columnMouseMove(col: number): void;

  /**
   * Handle row header mouse move (for range selection).
   * @param row - Row index under cursor
   */
  rowMouseMove(row: number): void;

  // -------------------------------------------------------------------------
  // Cell Drag-Drop
  // -------------------------------------------------------------------------

  /**
   * Start dragging cells.
   * @param cell - Cell where drag started
   * @param ctrlKey - Whether ctrl key is held (copy mode)
   */
  startDragCells(cell: CellCoord, ctrlKey: boolean): void;

  /**
   * Update cell drag position.
   * @param cell - Current target cell
   * @param ctrlKey - Whether ctrl key is held (copy mode)
   */
  dragCellsMove(cell: CellCoord, ctrlKey: boolean): void;

  /**
   * End cell drag and execute move/copy.
   */
  endDragCells(): void;

  /**
   * Cancel cell drag operation.
   */
  cancelDragCells(): void;

  // -------------------------------------------------------------------------
  // Header Resize
  // -------------------------------------------------------------------------

  /**
   * Start column resize.
   * @param col - Column index being resized
   * @param startPosition - Starting mouse position (screen coordinates)
   * @param startSize - Starting column width (pixels)
   * @param cols - Optional array of column indexes for multi-select resize
   * @param startSizes - Optional map of starting sizes for multi-select
   */
  startColumnResize(
    col: number,
    startPosition: number,
    startSize: number,
    cols?: number[],
    startSizes?: Map<number, number>,
  ): void;

  /**
   * Start row resize.
   * @param row - Row index being resized
   * @param startPosition - Starting mouse position (screen coordinates)
   * @param startSize - Starting row height (pixels)
   * @param rows - Optional array of row indexes for multi-select resize
   * @param startSizes - Optional map of starting sizes for multi-select
   */
  startRowResize(
    row: number,
    startPosition: number,
    startSize: number,
    rows?: number[],
    startSizes?: Map<number, number>,
  ): void;

  /**
   * Update resize position during drag.
   * @param position - Current mouse position (screen coordinates)
   */
  resizeMove(position: number): void;

  /**
   * End resize operation.
   */
  endResize(): void;

  /**
   * Cancel resize operation.
   */
  cancelResize(): void;

  /**
   * Clear resize state.
   */
  clearResize(): void;

  // -------------------------------------------------------------------------
  // Table Resize
  // -------------------------------------------------------------------------

  /**
   * Start table resize.
   * @param tableId - ID of table being resized
   * @param tableBounds - Starting table bounds
   */
  startTableResize(tableId: string, tableBounds: CellRange): void;

  /**
   * Update table resize position.
   * @param targetRow - Target bottom-right row
   * @param targetCol - Target bottom-right column
   */
  tableResizeMove(targetRow: number, targetCol: number): void;

  /**
   * End table resize operation.
   */
  endTableResize(): void;

  /**
   * Cancel table resize operation.
   */
  cancelTableResize(): void;

  /**
   * Clear table resize state.
   */
  clearTableResize(): void;

  // -------------------------------------------------------------------------
  // External Events
  // -------------------------------------------------------------------------

  /**
   * Handle remote selection change (collaboration).
   * @param ranges - New selection ranges from remote user
   */
  remoteSelectionChanged(ranges: CellRange[]): void;

  /**
   * Set selection programmatically.
   * @param ranges - Selection ranges
   * @param activeCell - Active cell coordinates
   * @param anchor - Optional anchor for shift-click extension
   * @param anchorCol - Optional anchor column for column selection
   * @param anchorRow - Optional anchor row for row selection
   * @param source - Provenance of the selection change. `'user'` (default) is
   *   a local user action and triggers viewport-follow; `'remote'`/`'agent'`/
   *   `'restore'` skip the viewport-follow emit. This preserves viewport-follow semantics.
   */
  setSelection(
    ranges: CellRange[],
    activeCell: CellCoord,
    anchor?: CellCoord | null,
    anchorCol?: number | null,
    anchorRow?: number | null,
    source?: 'user' | 'remote' | 'agent' | 'restore',
  ): void;

  /**
   * Reset selection to default state.
   */
  reset(): void;

  /**
   * Handle table Tab navigation.
   * @param targetCell - Target cell for navigation
   */
  tabNavigate(targetCell: CellCoord): void;

  /**
   * Update workbook settings.
   * @param allowDragFill - Whether fill handle dragging is enabled
   */
  updateSettings(allowDragFill?: boolean): void;

  /**
   * Handle structure change (row/column insert/delete).
   * @param sheetId - Sheet where change occurred
   * @param change - Structure change details
   */
  structureChange(
    sheetId: string,
    change: {
      type: 'insertRows' | 'deleteRows' | 'insertColumns' | 'deleteColumns';
      index: number;
      count: number;
    },
  ): void;

  /**
   * Set layout-predicate callbacks. Renamed from
   * `setVisibilityCallbacks` and extended to carry `getMergedRegionAt`.
   * Wired by the coordinator at machine bootstrap and on sheet switch so
   * navigation events resolve hidden rows/cols and merged regions through
   * one machine-internal path.
   *
   * @param isRowHidden - Function to check if row is hidden
   * @param isColHidden - Function to check if column is hidden
   * @param getMergedRegionAt - Resolve a (row, col) to its containing merge, if any
   */
  setLayoutCallbacks(
    isRowHidden?: (row: number) => boolean,
    isColHidden?: (col: number) => boolean,
    getMergedRegionAt?: (row: number, col: number) => CellRange | null,
  ): void;

  /**
   * Handle external selection context taking focus.
   * @param context - Which context took focus
   */
  externalSelectionActive(context: 'cells' | 'objects' | 'chart'): void;

  // -------------------------------------------------------------------------
  // Selection-mode lifecycle
  // -------------------------------------------------------------------------

  /**
   * Set a single mode flag. Enforces the `extend ⊕ additive` mutual-exclusion
   * invariant: turning one on forces the other off. Toggling
   * `additive: true → false` flattens to a single range at the active cell
   * (Excel's flatten-on-Esc behavior).
   *
   * @param mode - Mode flag to set ('end' | 'extend' | 'additive')
   * @param value - New value
   */
  setMode(mode: 'end' | 'extend' | 'additive', value: boolean): void;

  /**
   * Clear all three mode flags and flatten to a single range at the active
   * cell. Triggered by Esc.
   */
  exitAllModes(): void;

  /**
   * Commit the current pending range into committed ranges and open a new
   * single-cell pending range at the active cell. Triggered by the second
   * Shift+F8 (Excel commit-and-continue), click outside the pending range,
   * or other "stop editing this range, start a new one" gestures.
   */
  commitPending(): void;
}

// =============================================================================
// EDITOR COMMANDS
// =============================================================================

/**
 * Commands for the editor state machine.
 * Handles cell editing, formula entry, IME composition, and rich text.
 *
 * @see state-machines/src/editor-machine.ts
 * @see state-machines/src/editor/types.ts
 */
export interface EditorCommands {
  // -------------------------------------------------------------------------
  // Editing Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Signal that editor has activated.
   */
  activated(): void;

  /**
   * Update editor input value.
   *
   * The cursor position MUST be the DOM textarea's actual `selectionStart`
   * — the editor machine mirrors it instead of inventing one. Inventing
   * the cursor (e.g. `value.length`) corrupts every mid-string edit
   * because the inline editor's `useLayoutEffect` writes the machine's
   * cursor back onto the DOM with `setSelectionRange`.
   *
   * @param value - New value
   * @param cursorPosition - DOM caret position after the change
   */
  input(value: string, cursorPosition: number): void;

  /**
   * Set cursor position.
   * @param position - Cursor position within value
   */
  setCursor(position: number): void;

  /**
   * Mirror a non-collapsed DOM text selection into the editor machine.
   */
  setTextSelection(cursorPosition: number, selectionAnchor: number): void;

  /**
   * Commit the edit.
   * @param direction - Direction to move after commit
   * @param commitKey - Optional key that triggered the commit (for Tab/Enter routing)
   */
  commit(
    direction: Direction | 'none',
    commitKey?: 'tab' | 'shift-tab' | 'enter' | 'shift-enter',
  ): void;

  /**
   * Cancel the edit.
   */
  cancel(): void;

  /**
   * Atomically set picker value and commit. Single compound event to the machine —
   * no intermediate state between value update and commit.
   * Routed exclusively through PICKER_COMMIT action handler — never called directly.
   */
  pickerCommit(value: unknown, direction: Direction | 'none'): void;

  /**
   * Commit a date picker calendar selection through the typed date write path.
   */
  datePickerCommit(isoDate: string, kind: 'date' | 'datetime', direction: Direction | 'none'): void;

  // -------------------------------------------------------------------------
  // IME Composition
  // -------------------------------------------------------------------------

  /**
   * Start IME composition.
   */
  imeStart(): void;

  /**
   * Update IME composition text.
   * @param compositionText - Current composition text
   */
  imeUpdate(compositionText: string): void;

  /**
   * End IME composition with final text.
   * @param finalText - Final composed text
   */
  imeEnd(finalText: string): void;

  /**
   * Cancel IME composition.
   */
  imeCancelComposition(): void;

  // -------------------------------------------------------------------------
  // Cursor Movement (Edit Mode)
  // -------------------------------------------------------------------------

  /**
   * Move cursor left one character.
   */
  cursorMoveLeft(): void;

  /**
   * Move cursor right one character.
   */
  cursorMoveRight(): void;

  /**
   * Move cursor left one word.
   */
  cursorMoveWordLeft(): void;

  /**
   * Move cursor right one word.
   */
  cursorMoveWordRight(): void;

  /**
   * Move cursor to start of line.
   */
  cursorMoveStart(): void;

  /**
   * Move cursor to end of line.
   */
  cursorMoveEnd(): void;

  /**
   * Move cursor up one line.
   */
  cursorUp(): void;

  /**
   * Move cursor down one line.
   */
  cursorDown(): void;

  // -------------------------------------------------------------------------
  // Text Selection (Edit Mode)
  // -------------------------------------------------------------------------

  /**
   * Extend selection left one character.
   */
  selectLeft(): void;

  /**
   * Extend selection right one character.
   */
  selectRight(): void;

  /**
   * Extend selection left one word.
   */
  selectWordLeft(): void;

  /**
   * Extend selection right one word.
   */
  selectWordRight(): void;

  /**
   * Extend selection to start.
   */
  selectToStart(): void;

  /**
   * Extend selection to end.
   */
  selectToEnd(): void;

  /**
   * Select all text.
   */
  selectAll(): void;

  // -------------------------------------------------------------------------
  // Text Deletion
  // -------------------------------------------------------------------------

  /**
   * Delete word forward.
   */
  deleteWordForward(): void;

  /**
   * Delete word backward.
   */
  deleteWordBackward(): void;

  /**
   * Delete to end of line.
   */
  deleteToEndOfLine(): void;

  // -------------------------------------------------------------------------
  // Edit Mode Toggle
  // -------------------------------------------------------------------------

  /**
   * Toggle between Enter Mode and Edit Mode.
   */
  toggleEditMode(): void;

  /**
   * Insert newline (Alt+Enter).
   */
  insertNewline(): void;

  // -------------------------------------------------------------------------
  // Formula Events
  // -------------------------------------------------------------------------

  /**
   * Handle formula range selection.
   * @param range - Selected range
   * @param color - Highlight color
   * @param structuredRef - Optional structured reference text
   */
  formulaRangeSelected(range: CellRange, color: string, structuredRef?: string): void;

  /**
   * Update formula range after drag-resize.
   * @param rangeIndex - Index of range being updated
   * @param newRange - New range bounds
   */
  updateFormulaRange(rangeIndex: number, newRange: CellRange): void;

  /**
   * Cycle reference type (F4).
   */
  cycleReference(): void;

  /**
   * Enter array formula (Ctrl+Shift+Enter).
   */
  enterArrayFormula(): void;

  /**
   * Insert function arguments (Ctrl+Shift+A).
   */
  insertFunctionArgs(): void;

  // -------------------------------------------------------------------------
  // Autocomplete
  // -------------------------------------------------------------------------

  /**
   * Show function suggestions.
   */
  showSuggestions(): void;

  /**
   * Hide function suggestions.
   */
  hideSuggestions(): void;

  /**
   * Select a suggestion by index.
   * @param index - Suggestion index
   */
  selectSuggestion(index: number): void;

  /**
   * Accept a suggestion.
   * @param name - Function name to accept
   */
  acceptSuggestion(name: string): void;

  /**
   * Navigate suggestions.
   * @param direction - Navigation direction
   */
  navigateSuggestion(direction: 'up' | 'down'): void;

  // -------------------------------------------------------------------------
  // Rich Text Events
  // -------------------------------------------------------------------------

  /**
   * Start rich text editing.
   * @param segments - Initial rich text segments
   */
  startRichTextEditing(segments: RichTextSegment[]): void;

  /**
   * Update rich text input.
   * @param segments - New rich text segments
   */
  inputRichText(segments: RichTextSegment[]): void;

  /**
   * Apply character format to selection.
   * @param format - Format to apply
   */
  applyCharFormat(format: Partial<TextFormat>): void;

  /**
   * Clear character format from selection.
   */
  clearCharFormat(): void;

  /**
   * Handle character selection change.
   * @param start - Selection start position
   * @param end - Selection end position
   */
  charSelectionChanged(start: number, end: number): void;

  // -------------------------------------------------------------------------
  // Picker Events
  // -------------------------------------------------------------------------

  /**
   * Set editor type based on cell schema.
   * @param editorType - Type of editor
   * @param cellSchema - Cell schema (if any)
   * @param enumItems - Enum items for dropdowns
   */
  setEditorType(
    editorType: CellEditorType,
    cellSchema: CellSchema | null,
    enumItems: unknown[] | null,
  ): void;

  /**
   * Open the picker (dropdown, date picker, etc.).
   */
  openPicker(): void;

  /**
   * Close the picker.
   */
  closePicker(): void;

  /**
   * Select a value from the picker.
   * @param value - Selected value
   */
  pickerSelect(value: unknown): void;

  // -------------------------------------------------------------------------
  // Dialog Events
  // -------------------------------------------------------------------------

  /**
   * Signal that a dialog has opened.
   * @param dialogId - Dialog identifier
   */
  dialogOpened(dialogId: string): void;

  /**
   * Signal that a dialog has closed.
   */
  dialogClosed(): void;

  // -------------------------------------------------------------------------
  // Validation Events
  // -------------------------------------------------------------------------

  /**
   * Signal validation success.
   */
  validationSuccess(): void;

  /**
   * Signal validation error.
   * @param message - Error message
   */
  validationError(message: string): void;

  /**
   * Retry after validation error.
   */
  retry(): void;

  /**
   * Signal commit complete.
   */
  commitComplete(): void;

  // -------------------------------------------------------------------------
  // Remote Events
  // -------------------------------------------------------------------------

  /**
   * Handle remote cell change.
   * @param cell - Changed cell
   * @param newValue - New value
   */
  remoteCellChanged(cell: CellCoord, newValue: unknown): void;

  /**
   * Handle remote cell deletion.
   * @param cell - Deleted cell
   */
  remoteCellDeleted(cell: CellCoord): void;

  /**
   * Handle remote sheet deletion.
   * @param sheetId - Deleted sheet ID
   */
  remoteSheetDeleted(sheetId: string): void;

  /**
   * Handle remote schema change.
   * @param cell - Cell with changed schema
   */
  remoteSchemaChanged(cell: CellCoord): void;

  /**
   * Handle structure change.
   * @param sheetId - Sheet where change occurred
   * @param change - Structure change details
   */
  structureChange(
    sheetId: string,
    change: {
      type: 'insertRows' | 'deleteRows' | 'insertColumns' | 'deleteColumns';
      index: number;
      count: number;
    },
  ): void;

  /**
   * Handle remote structure change.
   * @param sheetId - Sheet where change occurred
   * @param operation - Type of structure operation
   * @param startIndex - Starting index
   * @param count - Number of rows/columns affected
   */
  remoteStructureChange(
    sheetId: string,
    operation: 'insertRows' | 'deleteRows' | 'insertColumns' | 'deleteColumns',
    startIndex: number,
    count: number,
  ): void;

  // -------------------------------------------------------------------------
  // Dependency Injection
  // -------------------------------------------------------------------------

  /**
   * Set function registry for formula argument hints.
   * @param registry - Function registry
   */
  setFunctionRegistry(registry: {
    getMetadata(name: string): { minArgs?: number; maxArgs?: number } | undefined;
  }): void;
}

// =============================================================================
// CLIPBOARD COMMANDS
// =============================================================================

/**
 * Paste option for data-less paste operations.
 * Used by handlers that trigger paste without providing target data
 * (the integration layer determines the target).
 */
export type PasteOption =
  | 'values'
  | 'formulas'
  | 'formatting'
  | 'transpose'
  | 'link'
  | 'picture'
  | 'linkedPicture';

/**
 * Commands for the clipboard state machine.
 * Handles copy, cut, paste, and paste special operations.
 *
 * This interface has two patterns:
 * 1. Data-accepting methods (copy, cut, paste, pasteSpecial) - Used by integration layer
 *    which gathers and provides the actual data
 * 2. Data-less trigger methods (triggerCopy, triggerCut, triggerPaste) - Used by handlers
 *    which just trigger the operation; the machine sources data internally via integrations
 *
 * @see state-machines/src/clipboard-machine.ts
 */
export interface ClipboardCommands {
  // -------------------------------------------------------------------------
  // Data-accepting methods (for integration layer)
  // -------------------------------------------------------------------------

  /**
   * Copy cells to clipboard with explicit data.
   * Used by integration layer which gathers the clipboard data.
   * @param ranges - Ranges to copy
   * @param data - Clipboard data
   */
  copy(ranges: CellRange[], data: ClipboardData): void;

  /**
   * Cut cells to clipboard with explicit data.
   * Used by integration layer which gathers the clipboard data.
   * @param ranges - Ranges to cut
   * @param data - Clipboard data
   */
  cut(ranges: CellRange[], data: ClipboardData): void;

  /**
   * Paste clipboard contents to a specific target cell.
   * Used by integration layer which determines the target.
   * @param targetCell - Target cell for paste
   * @param skipSizeCheck - Whether to skip size mismatch warning
   * @param skipOverwriteCheck - Whether to skip cut-paste overwrite confirmation
   *   (set after the user has explicitly confirmed the overwrite)
   */
  paste(targetCell: CellCoord, skipSizeCheck?: boolean, skipOverwriteCheck?: boolean): void;

  /**
   * Paste with special options to a specific target cell.
   * Used by integration layer which determines the target.
   * @param targetCell - Target cell for paste
   * @param options - Paste special options
   * @param skipSizeCheck - Whether to skip size mismatch warning
   * @param skipOverwriteCheck - Whether to skip cut-paste overwrite confirmation
   *   (set after the user has explicitly confirmed the overwrite)
   */
  pasteSpecial(
    targetCell: CellCoord,
    options: PasteSpecialOptions,
    skipSizeCheck?: boolean,
    skipOverwriteCheck?: boolean,
  ): void;

  // -------------------------------------------------------------------------
  // Data-less trigger methods (for handlers)
  // -------------------------------------------------------------------------

  /**
   * Trigger copy operation.
   * The clipboard machine's integration layer handles gathering the data.
   * Used by keyboard handlers (Ctrl+C).
   */
  triggerCopy(): void;

  /**
   * Trigger cut operation.
   * The clipboard machine's integration layer handles gathering the data.
   * Used by keyboard handlers (Ctrl+X).
   */
  triggerCut(): void;

  /**
   * Trigger paste operation.
   * The clipboard machine's integration layer handles determining the target.
   * Used by keyboard handlers (Ctrl+V) and context menu paste options.
   * @param option - Optional paste option (values, formulas, formatting, etc.)
   */
  triggerPaste(option?: PasteOption): void;

  /**
   * Show paste preview.
   * @param targetCell - Target cell for preview
   */
  showPastePreview(targetCell: CellCoord): void;

  /**
   * Hide paste preview.
   */
  hidePastePreview(): void;

  /**
   * Signal paste complete.
   */
  pasteComplete(): void;

  /**
   * Signal paste error.
   * @param message - Error message
   */
  pasteError(message: string): void;

  /**
   * Invalidate cut operation (source modified).
   */
  invalidateCut(): void;

  /**
   * Clear clipboard.
   */
  clear(): void;

  /**
   * Handle external paste (from other apps).
   * @param payload - External clipboard payload
   */
  externalPaste(payload: ExternalPastePayload): void;

  /**
   * Bridge edit-mode copy/cut text into the clipboard machine.
   * Called when the user copies or cuts text while editing a cell.
   * @param text - The selected text from the editor
   */
  editModeCopy(text: string): void;

  /**
   * Advance marching ants animation.
   */
  tickMarchingAnts(): void;

  /**
   * Handle structure change.
   * @param sheetId - Sheet where change occurred
   * @param change - Structure change details
   */
  structureChange(
    sheetId: string,
    change: {
      type: 'insertRows' | 'deleteRows' | 'insertColumns' | 'deleteColumns';
      index: number;
      count: number;
    },
  ): void;

  /**
   * Signal that user started editing a cell (clears clipboard).
   */
  cellEdit(): void;

  /**
   * Mark clipboard as stale (app lost focus).
   */
  focusLost(): void;

  /**
   * Re-apply paste with different options to a specific range.
   * Used by paste options button/menu to change paste behavior after initial paste.
   * @param option - Paste option to apply
   * @param range - Target range to paste to
   * @param sheetId - Target sheet ID
   */
  pasteWithOption(option: PasteOption, range: CellRange, sheetId: string): void;
}

// =============================================================================
// CHART COMMANDS
// =============================================================================

/**
 * Resize handle direction type.
 */
export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/**
 * Chart element types that can be selected.
 */
export type ChartElementType =
  | 'title'
  | 'legend'
  | 'xAxis'
  | 'yAxis'
  | 'series'
  | 'dataPoint'
  | 'gridLine'
  | 'tooltip';

/**
 * Commands for the chart state machine.
 * Handles chart selection, editing, creation, and interaction.
 *
 * @see state-machines/src/chart-machine.ts
 */
export interface ChartCommands {
  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------

  /**
   * Select a chart.
   * @param chartId - Chart ID to select
   */
  select(chartId: string): void;

  /**
   * Deselect the current chart.
   */
  deselect(): void;

  /**
   * Deselect all charts.
   */
  deselectAll(): void;

  /**
   * Add chart to multi-selection (Shift+click).
   * @param chartId - Chart ID to add
   */
  addToSelection(chartId: string): void;

  /**
   * Toggle chart in selection (Ctrl/Cmd+click).
   * @param chartId - Chart ID to toggle
   */
  toggleSelection(chartId: string): void;

  // -------------------------------------------------------------------------
  // Editing
  // -------------------------------------------------------------------------

  /**
   * Start editing the selected chart.
   */
  startEdit(): void;

  /**
   * Stop editing the chart.
   */
  stopEdit(): void;

  // -------------------------------------------------------------------------
  // Creation Wizard
  // -------------------------------------------------------------------------

  /**
   * Start chart creation wizard.
   * @param initialDataRange - Optional initial data range
   */
  create(initialDataRange?: string): void;

  /**
   * Set chart type in creation wizard.
   * @param chartType - Chart type to set
   */
  setType(chartType: ChartType): void;

  /**
   * Set data range in creation wizard.
   * @param dataRange - Data range string (A1 notation)
   */
  setDataRange(dataRange: string): void;

  /**
   * Move to next wizard step.
   */
  nextStep(): void;

  /**
   * Move to previous wizard step.
   */
  prevStep(): void;

  /**
   * Cancel creation/editing.
   */
  cancel(): void;

  /**
   * Confirm chart creation.
   */
  confirm(): void;

  // -------------------------------------------------------------------------
  // Deletion
  // -------------------------------------------------------------------------

  /**
   * Delete the selected chart.
   */
  delete(): void;

  // -------------------------------------------------------------------------
  // Drag/resize
  // -------------------------------------------------------------------------

  /**
   * Start drag operation.
   * @param pointerId - Pointer ID for capture
   * @param clientX - Starting X position
   * @param clientY - Starting Y position
   */
  pointerDownBody(pointerId: number, clientX: number, clientY: number): void;

  /**
   * Start resize operation.
   * @param pointerId - Pointer ID for capture
   * @param clientX - Starting X position
   * @param clientY - Starting Y position
   * @param handle - Resize handle being used
   * @param shiftKey - Whether shift key is held (aspect ratio lock)
   * @param ctrlKey - Whether ctrl key is held (resize from center)
   * @param originalWidth - Original chart width
   * @param originalHeight - Original chart height
   */
  pointerDownHandle(
    pointerId: number,
    clientX: number,
    clientY: number,
    handle: ResizeHandle,
    shiftKey?: boolean,
    ctrlKey?: boolean,
    originalWidth?: number,
    originalHeight?: number,
  ): void;

  /**
   * Update pointer position during drag/resize.
   * @param clientX - Current X position
   * @param clientY - Current Y position
   * @param shiftKey - Whether shift key is held
   * @param ctrlKey - Whether ctrl key is held
   */
  pointerMove(clientX: number, clientY: number, shiftKey?: boolean, ctrlKey?: boolean): void;

  /**
   * End drag/resize operation.
   */
  pointerUp(): void;

  /**
   * Reset drag/resize operation (e.g., on blur).
   */
  reset(): void;

  /**
   * Update modifier key state during drag/resize.
   * @param shiftKey - Whether shift key is held
   * @param ctrlKey - Whether ctrl key is held
   */
  updateModifiers(shiftKey: boolean, ctrlKey: boolean): void;

  // -------------------------------------------------------------------------
  // Element selection
  // -------------------------------------------------------------------------

  /**
   * Click on a chart element.
   * @param elementType - Type of element clicked
   */
  clickElement(elementType: ChartElementType): void;

  /**
   * Double-click on chart or element.
   * @param elementType - Optional element type
   */
  doubleClick(elementType?: ChartElementType): void;

  /**
   * Click on a data series.
   * @param seriesIndex - Index of series clicked
   */
  clickSeries(seriesIndex: number): void;

  /**
   * Click on a data point.
   * @param seriesIndex - Series index
   * @param pointIndex - Point index within series
   */
  clickPoint(seriesIndex: number, pointIndex: number): void;

  /**
   * Start title editing.
   * @param originalValue - Original title value (for revert)
   */
  startTitleEdit(originalValue: string): void;

  /**
   * End title editing (commit).
   */
  endTitleEdit(): void;

  /**
   * Cancel title editing (revert).
   */
  cancelTitleEdit(): void;

  /**
   * Clear element selection.
   */
  clearElementSelection(): void;

  // -------------------------------------------------------------------------
  // External Events
  // -------------------------------------------------------------------------

  /**
   * Handle sheet switch.
   */
  sheetSwitched(): void;

  /**
   * Handle remote chart deletion.
   * @param chartId - Deleted chart ID
   */
  remoteChartDeleted(chartId: string): void;

  /**
   * Handle external selection context taking focus.
   * @param context - Which context took focus
   */
  externalSelectionActive(context: 'cells' | 'objects' | 'chart'): void;
}

// =============================================================================
// OBJECT COMMANDS
// =============================================================================

// Re-export Point from viewport for convenience
export type { Point } from '@mog/types-viewport';

/**
 * Commands for the object interaction state machine.
 * Handles floating object (shapes, pictures, text boxes) interactions.
 *
 * @see state-machines/src/object-interaction-machine.ts
 */
export interface ObjectCommands {
  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------

  /**
   * Select an object.
   * @param objectId - Object ID to select
   * @param shiftKey - Whether shift key is held
   * @param ctrlKey - Whether ctrl/cmd key is held
   */
  selectObject(objectId: string, shiftKey: boolean, ctrlKey: boolean): void;

  /**
   * Select multiple objects.
   * @param objectIds - Array of object IDs to select
   */
  selectMultiple(objectIds: string[]): void;

  /**
   * Deselect all objects.
   */
  deselectAll(): void;

  // -------------------------------------------------------------------------
  // Keyboard Events
  // -------------------------------------------------------------------------

  /**
   * Delete key pressed.
   */
  keyDelete(): void;

  /**
   * Escape key pressed.
   */
  keyEscape(): void;

  /**
   * Arrow key for nudging.
   * @param direction - Arrow direction
   * @param shiftKey - Whether shift key is held (larger nudge)
   */
  keyArrow(direction: 'up' | 'down' | 'left' | 'right', shiftKey: boolean): void;

  /**
   * Duplicate shortcut (Ctrl+D).
   */
  keyDuplicate(): void;

  // -------------------------------------------------------------------------
  // Text Editing
  // -------------------------------------------------------------------------

  /**
   * Double-click to enter text editing.
   * @param objectId - Object ID to edit
   */
  doubleClick(objectId: string): void;

  /**
   * Double-click to enter TextEffect text editing.
   * Used for textboxes with textEffect configuration.
   * @param objectId - TextEffect object ID to edit
   *
   */
  doubleClickTextEffect(objectId: string): void;

  /**
   * Stop TextEffect editing mode.
   * Called when user clicks outside, presses Escape, or commits.
   *
   */
  stopTextEffectEditing(): void;

  /**
   * Commit text changes.
   * @param text - Final text content
   */
  commitText(text: string): void;

  /**
   * Cancel text editing.
   */
  cancelText(): void;

  // -------------------------------------------------------------------------
  // External Events
  // -------------------------------------------------------------------------

  /**
   * Handle remote selection change.
   * @param selectedIds - IDs selected by remote user
   */
  remoteSelectionChanged(selectedIds: string[]): void;

  /**
   * Handle object deletion.
   * @param objectId - Deleted object ID
   */
  objectDeleted(objectId: string): void;

  /**
   * Reset to initial state.
   */
  reset(): void;

  /**
   * Handle external selection context taking focus.
   * @param context - Which context took focus
   */
  externalSelectionActive(context: 'cells' | 'objects' | 'chart'): void;

  // ===========================================================================
  // Unified Operation Commands
  // ===========================================================================

  /**
   * Start a drag operation.
   * Transitions from selected/multiSelected to operating state.
   * @param objectIds - Objects being dragged
   * @param position - Starting mouse position (viewport coordinates)
   * @param originalStates - Original geometric states of all objects
   */
  startDrag(
    objectIds: string[],
    position: Point,
    originalStates: Map<string, OperationObjectState>,
  ): void;

  /**
   * Start a resize operation.
   * Transitions from selected/multiSelected to operating state.
   * @param objectIds - Objects being resized
   * @param position - Starting mouse position (viewport coordinates)
   * @param handle - Resize handle being used
   * @param originalStates - Original geometric states of all objects
   */
  startResize(
    objectIds: string[],
    position: Point,
    handle: OperationResizeHandle,
    originalStates: Map<string, OperationObjectState>,
  ): void;

  /**
   * Start a rotate operation.
   * Transitions from selected/multiSelected to operating state.
   * @param objectIds - Objects being rotated
   * @param position - Starting mouse position (viewport coordinates)
   * @param rotationCenter - Center point for rotation calculation
   * @param originalStates - Original geometric states of all objects
   */
  startRotate(
    objectIds: string[],
    position: Point,
    rotationCenter: Point,
    originalStates: Map<string, OperationObjectState>,
  ): void;

  /**
   * Update position during an operation.
   * Fires on mouse move while in operating state.
   * @param position - Current mouse position (viewport coordinates)
   */
  updatePosition(position: Point): void;

  /**
   * Complete the current operation.
   * Transitions from operating to selected state.
   * Operation remains in context for completion subscription to read.
   */
  completeOperation(): void;

  /**
   * Cancel the current operation.
   * Transitions from operating to selected state and clears operation.
   * Objects return to their original positions.
   */
  cancelOperation(): void;

  /**
   * Clear the operation from context after commit.
   * Called by completion subscription after persisting to Yjs.
   */
  clearOperation(): void;

  // -------------------------------------------------------------------------
  // Insert Mode
  // -------------------------------------------------------------------------

  /**
   * Enter insert mode for a shape type.
   * Transitions from idle → inserting state.
   * @param shapeType - The shape type to insert (e.g. 'rect', 'ellipse')
   */
  startInsert(shapeType: string): void;

  /**
   * Record the start position for drag-to-insert.
   * Called on pointerdown during inserting state.
   * @param position - Canvas position where the user pressed down
   */
  setInsertStart(position: { x: number; y: number }): void;

  /**
   * Update the current position during drag-to-insert.
   * Called on pointermove during inserting state.
   * @param position - Current canvas position
   */
  updateInsertBounds(position: { x: number; y: number }): void;

  /**
   * Complete the insert on pointerup.
   * Coordinator reads context and dispatches INSERT_SHAPE before calling this.
   */
  completeInsert(): void;

  /**
   * Cancel the insert (e.g. Escape key).
   * Clears insert context and returns to idle.
   */
  cancelInsert(): void;
}

// =============================================================================
// COMMENT COMMANDS
// =============================================================================

// Import comment-specific types
import type { RichText } from '@mog/types-core/rich-text';
import type { CommentTarget } from './comment';

/**
 * Commands for the comment state machine.
 * Handles comment popover interactions (viewing, editing, composing, deleting).
 *
 * @see state-machines/src/comment-machine.ts
 */
export interface CommentCommands {
  // -------------------------------------------------------------------------
  // Navigation Events
  // -------------------------------------------------------------------------

  /**
   * Hover over a cell with comments.
   * @param target - Target cell information
   */
  hoverCell(target: CommentTarget): void;

  /**
   * Click on a cell with comments.
   * @param target - Target cell information
   */
  clickCell(target: CommentTarget): void;

  /**
   * Leave the current cell (mouse out).
   */
  leaveCell(): void;

  /**
   * Close the comment popover.
   */
  close(): void;

  // -------------------------------------------------------------------------
  // Action Events
  // -------------------------------------------------------------------------

  /**
   * Start composing a new comment.
   */
  startCompose(commentType?: ComposeCommentType): void;

  /**
   * Start editing an existing comment.
   * @param commentId - ID of comment to edit
   * @param content - Current content of the comment
   */
  startEdit(commentId: string, content: RichText): void;

  /**
   * Update draft content while editing/composing.
   * @param content - Updated draft content
   */
  updateDraft(content: RichText): void;

  /**
   * Save the current draft (create or update comment).
   */
  save(): void;

  /**
   * Cancel the current edit/compose operation.
   */
  cancel(): void;

  // -------------------------------------------------------------------------
  // Delete Events
  // -------------------------------------------------------------------------

  /**
   * Request to delete a comment (shows confirmation).
   * @param commentId - ID of comment to delete
   */
  requestDelete(commentId: string): void;

  /**
   * Confirm deletion of the pending comment.
   */
  confirmDelete(): void;

  /**
   * Cancel the delete operation.
   */
  cancelDelete(): void;

  // -------------------------------------------------------------------------
  // Reply Events
  // -------------------------------------------------------------------------

  /**
   * Start replying to a thread.
   * @param threadId - ID of thread to reply to
   */
  startReply(threadId: string): void;

  // -------------------------------------------------------------------------
  // Resolve Events
  // -------------------------------------------------------------------------

  /**
   * Resolve a comment thread.
   * @param threadId - ID of thread to resolve
   */
  resolveThread(threadId: string): void;
}

// =============================================================================
// DRAW BORDER COMMANDS
// =============================================================================

/**
 * Border style configuration for draw border commands.
 */
export interface DrawBorderStyleConfig {
  /** Border color (hex, rgb, or theme color) */
  color: string;
  /** Border line style */
  style: 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double' | 'hair';
}

/**
 * Commands for the draw border state machine.
 * Handles draw border, draw border grid, and erase border operations.
 *
 * @see state-machines/src/draw-border-machine.ts
 */
export interface DrawBorderCommands {
  // -------------------------------------------------------------------------
  // Activation
  // -------------------------------------------------------------------------

  /**
   * Activate draw border mode.
   * @param borderStyle - Border style to apply
   * @param sheetId - Sheet ID where drawing occurs
   */
  activateDrawBorder(borderStyle: DrawBorderStyleConfig, sheetId: string): void;

  /**
   * Activate draw border grid mode.
   * @param borderStyle - Border style to apply
   * @param sheetId - Sheet ID where drawing occurs
   */
  activateDrawBorderGrid(borderStyle: DrawBorderStyleConfig, sheetId: string): void;

  /**
   * Activate erase border mode.
   * @param sheetId - Sheet ID where erasing occurs
   */
  activateEraseBorder(sheetId: string): void;

  // -------------------------------------------------------------------------
  // Drawing Operations
  // -------------------------------------------------------------------------

  /**
   * Handle mouse down to start drawing.
   * @param cell - Cell where drawing starts
   */
  mouseDown(cell: CellCoord): void;

  /**
   * Handle mouse move during drawing.
   * @param cell - Current cell under cursor
   */
  mouseMove(cell: CellCoord): void;

  /**
   * Handle mouse up to end drawing.
   */
  mouseUp(): void;

  // -------------------------------------------------------------------------
  // Deactivation
  // -------------------------------------------------------------------------

  /**
   * Cancel the current drawing operation and reset.
   */
  cancel(): void;

  /**
   * Deactivate drawing mode and return to inactive state.
   */
  deactivate(): void;
}

// =============================================================================
// DIAGRAM COMMANDS
// =============================================================================

/**
 * Diagram node ID type.
 */
export type DiagramNodeId = string;

/**
 * Commands for the Diagram state machine.
 * Handles Diagram node selection and editing interactions.
 *
 * Architecture Note:
 * - Selection state (selectedObjectId, selectedNodeIds, editingNodeId) lives in XState
 * - UI state (dialogOpen, textPaneVisible, gallery states) lives in UIStore
 * - This follows the same pattern as ChartCommands
 *
 * @see state-machines/src/diagram-machine.ts
 */
export interface DiagramCommands {
  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------

  /**
   * Select a single node (replaces existing selection).
   * @param objectId - Diagram object ID
   * @param nodeId - Node ID to select
   */
  selectNode(objectId: string, nodeId: DiagramNodeId): void;

  /**
   * Toggle a node in multi-selection (Ctrl/Cmd+click).
   * @param objectId - Diagram object ID
   * @param nodeId - Node ID to toggle
   */
  multiSelectNode(objectId: string, nodeId: DiagramNodeId): void;

  /**
   * Clear all selection.
   */
  deselect(): void;

  /**
   * Handle external selection (cell, chart, etc.) becoming active.
   * Clears Diagram selection to avoid multiple active selections.
   */
  externalSelectionActive(): void;

  // -------------------------------------------------------------------------
  // Editing
  // -------------------------------------------------------------------------

  /**
   * Start in-place text editing for a node.
   * @param nodeId - Node ID to edit
   */
  startEdit(nodeId: DiagramNodeId): void;

  /**
   * Commit text changes and exit editing mode.
   * @param text - New text value
   */
  commitEdit(text: string): void;

  /**
   * Cancel editing and discard changes.
   */
  cancelEdit(): void;
}

// =============================================================================
// AGGREGATED ACTOR COMMANDS
// =============================================================================

/**
 * Aggregated interface containing all actor commands.
 * This is the main interface used by hooks and handlers to interact with actors.
 *
 * @example
 * ```ts
 * function MyComponent() {
 *   const actors = useActorCommands();
 *
 *   const handleClick = () => {
 *     actors.selection.selectAll();
 *     // Start edit sessions through the grid edit-entry service.
 *   };
 * }
 * ```
 */
export interface ActorCommands {
  /** Selection machine commands */
  selection: SelectionCommands;
  /** Editor machine commands */
  editor: EditorCommands;
  /** Clipboard machine commands */
  clipboard: ClipboardCommands;
  /** Chart machine commands */
  chart: ChartCommands;
  /** Object interaction machine commands */
  object: ObjectCommands;
  /** Find-replace machine commands (optional - not all contexts have it) */
  findReplace?: FindReplaceCommands;
  /** Pane focus machine commands (optional - not all contexts have it) */
  paneFocus?: PaneFocusCommands;
  /** Comment machine commands (optional - not all contexts have it) */
  comment?: CommentCommands;
  /** Draw border machine commands (optional - not all contexts have it) */
  drawBorder?: DrawBorderCommands;
  /** Renderer machine commands (optional - not all contexts have it) */
  renderer?: RendererCommands;
  /** Diagram machine commands (optional - not all contexts have it) */
  diagram?: DiagramCommands;
}
