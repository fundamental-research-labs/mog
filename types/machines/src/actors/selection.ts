/**
 * Selection Actor Access
 *
 * Selectors (the primitive) + Accessor interface (the contract for handlers).
 * Co-located to prevent drift.
 *
 * ARCHITECTURE: Selectors are the single primitive for extraction logic.
 * - Snapshots compose selectors (no duplication)
 * - Accessors wrap selectors + getSnapshot() (no duplication)
 * - Hooks use selectors directly with useSelector (no duplication)
 *
 * @module @mog-sdk/contracts/actors/selection
 */

import type { CellRange, SheetId } from '@mog/types-core';
import type { SelectionDirection } from '../machines/types';
import type { CellCoord } from '@mog/types-viewport/rendering/primitives';

// =============================================================================
// STATE TYPE (minimal version for selectors)
// =============================================================================

/**
 * Selection-mode bundle. Mirrors `SelectionModes` in the machine. Kept here
 * (instead of imported) so this contracts package stays free of machine
 * imports.
 *
 */
export interface SelectionModes {
  /** End-mode: next navigation jumps to the data edge, then auto-deactivates. */
  end: boolean;
  /** Extend-mode (F8): arrows behave as if Shift were held. */
  extend: boolean;
  /** Additive-mode (Shift+F8): arrows mutate `pendingRange` only. */
  additive: boolean;
}

/**
 * Minimal state type for selectors - matches XState snapshot shape.
 * This is the input type for all selector functions.
 */
export interface SelectionState {
  context: {
    /** Anchor cell for range selection (where drag started) */
    anchor: CellCoord | null;
    /**
     * Committed (non-contiguous) ranges. Always empty when `modes.additive`
     * is false. The former flat `ranges: CellRange[]` field is gone —
     * use `selectionSelectors.ranges(state)` (which returns
     * `getEffectiveRanges(ctx)`) for the public read path.
     */
    committedRanges: CellRange[];
    /** The range currently being edited (always populated). */
    pendingRange: CellRange;
    /** Selection-mode bundle. */
    modes: SelectionModes;
    /** The active cell (where typing goes, shown with dark border) */
    activeCell: CellCoord;
    /** Direction the selection was created in (from anchor to active cell) */
    direction: SelectionDirection;
    /** Color for formula range mode highlighting */
    formulaRangeColor: string | null;
    /** Whether in range selection mode */
    inRangeSelectionMode: boolean;
    /** Fill handle drag start cell */
    fillHandleStart: CellCoord | null;
    /** Fill handle drag current end cell */
    fillHandleEnd: CellCoord | null;
    /** Source range captured at fill handle drag START */
    fillSourceRange: CellRange | null;
    /** Anchor column for column range selection */
    anchorCol: number | null;
    /** Anchor row for row range selection */
    anchorRow: number | null;
    /** Whether fill handle dragging is enabled */
    allowDragFill: boolean;
    /** Source range being dragged (cell drag-drop) */
    dragSourceRange: CellRange | null;
    /** Current target cell for the drag (top-left of drop location) */
    dragTargetCell: CellCoord | null;
    /** Drag mode: 'move' or 'copy' */
    dragMode: 'move' | 'copy';
    /** Type of header resize: 'column' or 'row' */
    resizeType: 'column' | 'row' | null;
    /** Index of the column or row being resized */
    resizeIndex: number | null;
    /** Array of column or row indexes being resized (multi-select mode) */
    resizeIndexes: number[];
    /** Current size during resize in pixels */
    resizeCurrentSize: number | null;
    /** Table ID being resized */
    tableResizeId: string | null;
    /** Starting table bounds when resize began */
    tableResizeStartBounds: CellRange | null;
    /** Current target row for table resize */
    tableResizeTargetRow: number | null;
    /** Current target column for table resize */
    tableResizeTargetCol: number | null;
  };
  // Use `any` for state parameter to be compatible with XState's specific union type
  matches(state: any): boolean;
}

// =============================================================================
// SELECTORS - Moved to @mog-sdk/kernel/selectors
// Import from '@mog-sdk/kernel/selectors' instead.
// =============================================================================

// =============================================================================
// ACCESSOR INTERFACE (mirrors selectors 1:1 for handlers)
// =============================================================================

/**
 * SelectionAccessor interface for handlers.
 * Mirrors selectors 1:1 with method names (get* prefix for values).
 *
 * This is the contract that handlers use to read selection state.
 * Implementation lives in engine/src/state/coordinator/actor-access/selection.ts
 */
export interface SelectionAccessor {
  // ===========================================================================
  // Value Accessors (match value selectors)
  // ===========================================================================

  /** Get the active cell (where typing goes) */
  getActiveCell(): CellCoord;

  /** Get all selected ranges */
  getRanges(): CellRange[];

  /**
   * Get ranges constrained to actual data bounds.
   * For full column/row selections (isFullColumn/isFullRow), clips to used range.
   * For normal selections, returns as-is.
   * Ranges with no data are omitted from the result.
   *
   * Use this for: charts, filters, print areas, go-to-special
   * Use getRanges() for: structural ops, navigation, formatting
   */
  getDataBoundedRanges(sheetId: SheetId): CellRange[];

  /** Get the active range (first range or single-cell range from activeCell) */
  getActiveRange(): CellRange;

  /** Get the anchor cell (where drag started) */
  getAnchor(): CellCoord | null;

  /** Get the selection direction */
  getDirection(): SelectionDirection;

  /** Get the formula range color */
  getFormulaRangeColor(): string | null;

  /** Check if in range selection mode (for dialogs) */
  getInRangeSelectionMode(): boolean;

  /** Get fill handle start cell */
  getFillHandleStart(): CellCoord | null;

  /** Get fill handle end cell */
  getFillHandleEnd(): CellCoord | null;

  /** Get fill source range (captured at drag start) */
  getFillSourceRange(): CellRange | null;

  /** Get anchor column for column selection */
  getAnchorCol(): number | null;

  /** Get anchor row for row selection */
  getAnchorRow(): number | null;

  /** Check if fill handle dragging is allowed */
  getAllowDragFill(): boolean;

  /** Get drag source range (cell drag-drop) */
  getDragSourceRange(): CellRange | null;

  /** Get drag target cell (cell drag-drop) */
  getDragTargetCell(): CellCoord | null;

  /** Get drag mode ('move' or 'copy') */
  getDragMode(): 'move' | 'copy';

  /** Get resize type ('column' or 'row') */
  getResizeType(): 'column' | 'row' | null;

  /** Get resize index (single resize mode) */
  getResizeIndex(): number | null;

  /** Get resize indexes (multi-select mode) */
  getResizeIndexes(): number[];

  /** Get current resize size in pixels */
  getResizeCurrentSize(): number | null;

  /** Get table resize ID */
  getTableResizeId(): string | null;

  /** Get table resize start bounds */
  getTableResizeStartBounds(): CellRange | null;

  /** Get table resize target row */
  getTableResizeTargetRow(): number | null;

  /** Get table resize target column */
  getTableResizeTargetCol(): number | null;

  /**
   * Get the selection-mode bundle.
   *
   * Handlers consume `getModes()` to read End / Extend / Additive flags
   * (e.g. the End-toggle handler in `navigation.ts:TOGGLE_END_MODE` reads
   * the current value before deciding to set or clear).
   */
  getModes(): SelectionModes;

  // ===========================================================================
  // State Matching Accessors (match state selectors)
  // ===========================================================================

  /** Check if in idle state */
  isIdle(): boolean;

  /** Check if actively selecting */
  isSelecting(): boolean;

  /** Check if extending selection (Shift+click) */
  isExtending(): boolean;

  /** Check if multi-selecting (Ctrl+click) */
  isMultiSelecting(): boolean;

  /** Check if selecting range for formula */
  isSelectingRangeForFormula(): boolean;

  /** Check if dragging fill handle */
  isDraggingFillHandle(): boolean;

  /** Check if right-dragging fill handle */
  isRightDraggingFillHandle(): boolean;

  /** Check if dragging cells */
  isDraggingCells(): boolean;

  /** Check if selecting column */
  isSelectingColumn(): boolean;

  /** Check if selecting row */
  isSelectingRow(): boolean;

  /** Check if resizing header */
  isResizingHeader(): boolean;

  /** Check if resizing table */
  isResizingTable(): boolean;

  // ===========================================================================
  // Derived Accessors
  // ===========================================================================

  /** Check if actively selecting a range (selecting/extending/multiSelecting) */
  isActivelySelecting(): boolean;

  /** Check if in any drag operation */
  isInDragOperation(): boolean;

  /** Check if in formula mode */
  isInFormulaMode(): boolean;
}
