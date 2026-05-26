/**
 * Derived Selection State - Computation and Caching
 *
 * This module handles efficient computation and caching of derived selection state.
 * It provides:
 * - Memoized computation of full row/column selection flags
 * - Efficient Set-based tracking of selected rows and columns
 * - Snapshot extraction for hooks and consumers
 *
 * Key optimizations:
 * - For full row/column selections, we DON'T iterate over all 16K columns or 1M rows
 * - Results are cached by ranges array reference (XState creates new arrays on change)
 *
 * ARCHITECTURE: This module uses selectors from contracts as the single source of truth.
 *
 * @see selection-machine.ts - Source of selection state
 * @see ARCHITECTURE.md - State Machine 2: Selection
 */

import { selectionSelectors } from '../../../../selectors';
import { MAX_COLS, MAX_ROWS, type CellRange } from '@mog-sdk/contracts/core';
import type { CellCoord, SelectionDirection } from '../../../shared/types';

// =============================================================================
// SELECTION STATE TYPE
// =============================================================================

/**
 * Selection state snapshot from XState machine.
 * This is the structure returned by SelectionActor.getSnapshot().
 *
 * We define the minimal shape needed by derived state functions here
 * to avoid circular imports with the selection machine.
 *
 * Note: We use a flexible type for matches() to accommodate XState's specific signature
 * while still allowing string-based state checking.
 */
export interface SelectionStateForDerived {
  context: {
    // previous `ranges: CellRange[]` is gone — read effective
    // ranges via `selectionSelectors.ranges(state)`.
    committedRanges: CellRange[];
    pendingRange: CellRange;
    modes: {
      end: boolean;
      extend: boolean;
      additive: boolean;
    };
    activeCell: CellCoord;
    anchor: CellCoord | null;
    fillHandleStart: CellCoord | null;
    fillHandleEnd: CellCoord | null;
    direction: SelectionDirection;
    anchorCol: number | null;
    anchorRow: number | null;
    // Cell drag-drop state
    dragSourceRange: CellRange | null;
    dragTargetCell: CellCoord | null;
    dragMode: 'move' | 'copy';
    // Header resize state
    resizeType: 'column' | 'row' | null;
    resizeIndex: number | null;
    resizeCurrentSize: number | null;
    // Table resize state (Tables - 10.4)
    tableResizeId: string | null;
    tableResizeStartBounds: CellRange | null;
    tableResizeTargetRow: number | null;
    tableResizeTargetCol: number | null;
    // Allow additional properties from XState context
    [key: string]: any;
  };
  // matches() can accept either specific state values or string for flexibility
  matches: (state: any) => boolean;
  // Allow additional properties from XState snapshot
  [key: string]: any;
}

// =============================================================================
// DERIVED STATE CACHE
// =============================================================================

/**
 * Cache for derived selection state (Issue 7: Object Identity & Performance).
 *
 * Architecture:
 * - XState context.ranges is stable (same reference) when unchanged
 * - We cache by reference equality on ranges array
 * - No Yjs observer needed - ranges come from state machine context
 * - When selection changes, XState creates a new ranges array, invalidating cache
 */
export interface DerivedSelectionCache {
  ranges: CellRange[];
  result: {
    hasFullRowSelection: boolean;
    hasFullColumnSelection: boolean;
    selectedRows: Set<number>;
    selectedCols: Set<number>;
    fullySelectedRows: Set<number>;
    fullySelectedCols: Set<number>;
  };
}

let derivedSelectionCache: DerivedSelectionCache | null = null;

const MAX_MATERIALIZED_AXIS_MEMBERS = 10_000;

// =============================================================================
// CACHE MANAGEMENT
// =============================================================================

/**
 * Clear the derived selection cache.
 * Useful for testing or when forcing a recomputation.
 */
export function clearDerivedSelectionCache(): void {
  derivedSelectionCache = null;
}

/**
 * Get the current cache state (for testing/debugging).
 */
export function getDerivedSelectionCache(): DerivedSelectionCache | null {
  return derivedSelectionCache;
}

// =============================================================================
// DERIVED STATE COMPUTATION
// =============================================================================

/**
 * Compute derived selection state efficiently.
 *
 * Key optimization: For full row/column selections, we DON'T iterate over all 16K columns
 * or 1M rows. Instead:
 * - Full row selection: iterate rows only (O(1-10)), skip column iteration entirely
 * - Full column selection: iterate cols only (O(1-10)), skip row iteration entirely
 * - Normal selection: iterate both (bounded by selection size, not sheet size)
 *
 * Caching (Issue 7): Results are cached by ranges array reference.
 * When selection changes, XState creates a new ranges array, automatically invalidating cache.
 */
export function computeDerivedSelectionState(ranges: CellRange[]): {
  hasFullRowSelection: boolean;
  hasFullColumnSelection: boolean;
  selectedRows: Set<number>;
  selectedCols: Set<number>;
  fullySelectedRows: Set<number>;
  fullySelectedCols: Set<number>;
} {
  // Return cached if ranges reference hasn't changed (Issue 7: Object Identity)
  if (derivedSelectionCache && derivedSelectionCache.ranges === ranges) {
    return derivedSelectionCache.result;
  }

  const addAxisMembers = (target: Set<number>, start: number, end: number): void => {
    if (end < start) return;
    if (end - start + 1 > MAX_MATERIALIZED_AXIS_MEMBERS) return;
    for (let value = start; value <= end; value++) {
      target.add(value);
    }
  };

  // Compute derived state
  let hasFullRowSelection = false;
  let hasFullColumnSelection = false;
  const selectedRows = new Set<number>();
  const selectedCols = new Set<number>();
  const fullySelectedRows = new Set<number>();
  const fullySelectedCols = new Set<number>();

  for (const range of ranges) {
    const coversAllRows = range.startRow === 0 && range.endRow === MAX_ROWS - 1;
    const coversAllCols = range.startCol === 0 && range.endCol === MAX_COLS - 1;
    const isFullRowSelection = range.isFullRow === true || coversAllCols;
    const isFullColumnSelection = range.isFullColumn === true || coversAllRows;

    if (isFullRowSelection && isFullColumnSelection) {
      hasFullRowSelection = true;
      hasFullColumnSelection = true;
      continue;
    }

    if (isFullRowSelection) {
      // Full row selection: iterate rows only (O(1-10 typically))
      // DON'T iterate columns - that's 16,384 iterations we're avoiding!
      hasFullRowSelection = true;
      addAxisMembers(fullySelectedRows, range.startRow, range.endRow);
      addAxisMembers(selectedRows, range.startRow, range.endRow);
      // Note: We don't add columns to selectedCols for full-row selections
      // because hasFullRowSelection flag tells consumers all cols are selected
    } else if (isFullColumnSelection) {
      // Full column selection: iterate cols only (O(1-10 typically))
      // DON'T iterate rows - that's 1,048,576 iterations we're avoiding!
      hasFullColumnSelection = true;
      addAxisMembers(fullySelectedCols, range.startCol, range.endCol);
      addAxisMembers(selectedCols, range.startCol, range.endCol);
      // Note: We don't add rows to selectedRows for full-column selections
      // because hasFullColumnSelection flag tells consumers all rows are selected
    } else {
      // Normal range: iterate both (bounded by actual selection size)
      for (let r = range.startRow; r <= range.endRow; r++) {
        selectedRows.add(r);
      }
      for (let c = range.startCol; c <= range.endCol; c++) {
        selectedCols.add(c);
      }
    }
  }

  const result = {
    hasFullRowSelection,
    hasFullColumnSelection,
    selectedRows,
    selectedCols,
    fullySelectedRows,
    fullySelectedCols,
  };

  // Cache the result
  derivedSelectionCache = { ranges, result };

  return result;
}

// =============================================================================
// SELECTION SNAPSHOT
// =============================================================================

/**
 * Selection snapshot return type.
 * This is what getSelectionSnapshot returns.
 */
export interface SelectionSnapshotResult {
  ranges: CellRange[];
  activeCell: CellCoord;
  isSelecting: boolean;
  isFormulaMode: boolean;
  isDraggingFillHandle: boolean;
  // Right-click fill handle drag (shows context menu on release)
  isRightDraggingFillHandle: boolean;
  anchor: CellCoord | null;
  fillHandleStart: CellCoord | null;
  fillHandleEnd: CellCoord | null;
  // Selection direction for Tab/Enter cycling
  direction: SelectionDirection;
  // Column/row header selection state
  isSelectingColumn: boolean;
  isSelectingRow: boolean;
  anchorCol: number | null;
  anchorRow: number | null;
  // Pre-computed derived state for efficient rendering
  hasFullRowSelection: boolean;
  hasFullColumnSelection: boolean;
  selectedRows: ReadonlySet<number>;
  selectedCols: ReadonlySet<number>;
  fullySelectedRows: ReadonlySet<number>;
  fullySelectedCols: ReadonlySet<number>;
  // Cell drag-drop state
  isDraggingCells: boolean;
  dragSourceRange: CellRange | null;
  dragTargetCell: CellCoord | null;
  dragMode: 'move' | 'copy';
  // Header resize state
  isResizingHeader: boolean;
  resizeType: 'column' | 'row' | null;
  resizeIndex: number | null;
  resizeCurrentSize: number | null;
  // Table resize state (Tables - 10.4)
  isResizingTable: boolean;
  tableResizeId: string | null;
  tableResizeStartBounds: CellRange | null;
  tableResizeTargetRow: number | null;
  tableResizeTargetCol: number | null;
}

/**
 * Extract a SelectionSnapshot from the machine state.
 * Used by the coordinator and hooks.
 *
 * This function computes derived state ONCE, so consumers don't have to
 * re-compute it on every render frame.
 *
 * ARCHITECTURE: Uses selectors from contracts as the single source of truth.
 * Each field calls the corresponding selector - no extraction logic is duplicated here.
 */
export function getSelectionSnapshot(state: SelectionStateForDerived): SelectionSnapshotResult {
  // Cast state to compatible type for selectors
  // The SelectionStateForDerived interface is structurally compatible with SelectionState
  const s = state as Parameters<(typeof selectionSelectors)['activeCell']>[0];

  // Get ranges for derived state computation (caches by reference)
  const ranges = selectionSelectors.ranges(s);
  const derived = computeDerivedSelectionState(ranges);

  return {
    // Value selectors
    ranges,
    activeCell: selectionSelectors.activeCell(s),
    anchor: selectionSelectors.anchor(s),
    fillHandleStart: selectionSelectors.fillHandleStart(s),
    fillHandleEnd: selectionSelectors.fillHandleEnd(s),
    direction: selectionSelectors.direction(s),
    anchorCol: selectionSelectors.anchorCol(s),
    anchorRow: selectionSelectors.anchorRow(s),
    dragSourceRange: selectionSelectors.dragSourceRange(s),
    dragTargetCell: selectionSelectors.dragTargetCell(s),
    dragMode: selectionSelectors.dragMode(s),
    resizeType: selectionSelectors.resizeType(s),
    resizeIndex: selectionSelectors.resizeIndex(s),
    resizeCurrentSize: selectionSelectors.resizeCurrentSize(s),
    tableResizeId: selectionSelectors.tableResizeId(s),
    tableResizeStartBounds: selectionSelectors.tableResizeStartBounds(s),
    tableResizeTargetRow: selectionSelectors.tableResizeTargetRow(s),
    tableResizeTargetCol: selectionSelectors.tableResizeTargetCol(s),

    // State matching selectors
    isSelecting: selectionSelectors.isActivelySelecting(s),
    isFormulaMode: selectionSelectors.isSelectingRangeForFormula(s),
    isDraggingFillHandle: selectionSelectors.isDraggingFillHandle(s),
    isRightDraggingFillHandle: selectionSelectors.isRightDraggingFillHandle(s),
    isSelectingColumn: selectionSelectors.isSelectingColumn(s),
    isSelectingRow: selectionSelectors.isSelectingRow(s),
    isDraggingCells: selectionSelectors.isDraggingCells(s),
    isResizingHeader: selectionSelectors.isResizingHeader(s),
    isResizingTable: selectionSelectors.isResizingTable(s),

    // Pre-computed derived state (expensive, cached by reference)
    hasFullRowSelection: derived.hasFullRowSelection,
    hasFullColumnSelection: derived.hasFullColumnSelection,
    selectedRows: derived.selectedRows,
    selectedCols: derived.selectedCols,
    fullySelectedRows: derived.fullySelectedRows,
    fullySelectedCols: derived.fullySelectedCols,
  };
}
