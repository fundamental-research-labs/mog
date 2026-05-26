/**
 * Granular Selection Hooks
 *
 * Performance-optimized hooks that subscribe to specific slices of selection state.
 * Use these instead of useSelection() when you only need a subset of selection data.
 *
 * Problem: ToolbarContainer subscribes to full selection state via useSelection(),
 * causing re-renders on every mouse movement (78.5% of commits exceed frame budget).
 *
 * Solution: These hooks use XState's useSelector with granular selectors that only
 * trigger re-renders when the specific data they return actually changes.
 *
 * Performance Pattern:
 * - Components that need selection data DURING user interaction (SpreadsheetGrid)
 * should use useSelection for the full state
 * - Components that only need selection data AT ACTION TIME (ToolbarContainer)
 * should use coordinator.getSelectionSnapshot on-demand, not subscribe
 * - Components that need specific slices (FormulaBar, StatusBar)
 * should use these granular hooks
 *
 * NOTE: useActiveCell is in a separate file (use-active-cell.ts) for historical reasons.
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 4: State Machine / Coordinator Pattern
 */

import { useSelector } from '@xstate/react';
import { useEffect, useRef, useState } from 'react';

import { selectionSelectors } from '../../selectors';
import type { CellRange } from '@mog-sdk/contracts/core';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import { useCoordinator } from '../shared/use-coordinator';

// Type alias for the selector input type, derived from the selectors themselves
// This ensures type compatibility with XState's actual snapshot type
type SelectorState = Parameters<(typeof selectionSelectors)['activeCell']>[0];

/**
 * Selection-mode bundle.
 *
 * Replaces the legacy UIStore `endMode` / `extendSelectionMode` /
 * `addToSelectionMode` slice fields. Source of truth is the selection
 * actor's `ctx.modes` bundle.
 */
export interface SelectionModes {
  end: boolean;
  extend: boolean;
  additive: boolean;
}

/** Compare two SelectionModes objects for equality. */
function selectionModesEqual(a: SelectionModes, b: SelectionModes): boolean {
  if (a === b) return true;
  return a.end === b.end && a.extend === b.extend && a.additive === b.additive;
}

// =============================================================================
// EQUALITY FUNCTIONS
// =============================================================================

/**
 * Compare two CellRange values for equality.
 * Returns true if both are null, or if both have the same bounds and flags.
 */
function cellRangeEqual(a: CellRange | null, b: CellRange | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return (
    a.startRow === b.startRow &&
    a.startCol === b.startCol &&
    a.endRow === b.endRow &&
    a.endCol === b.endCol &&
    a.isFullRow === b.isFullRow &&
    a.isFullColumn === b.isFullColumn
  );
}

/**
 * Compare two readonly arrays of CellRange for equality.
 * Uses deep comparison of each range.
 */
function rangesEqual(a: readonly CellRange[], b: readonly CellRange[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!cellRangeEqual(a[i], b[i])) return false;
  }
  return true;
}

/**
 * Compare two CellCoord values for equality.
 * Returns true if both have the same row and col.
 */
function cellCoordEqual(a: CellCoord, b: CellCoord): boolean {
  if (a === b) return true;
  return a.row === b.row && a.col === b.col;
}

/**
 * Compare two SelectionFlags objects for equality.
 * Returns true if all boolean flags are the same.
 */
function selectionFlagsEqual(
  a: {
    isSelecting: boolean;
    isExtending: boolean;
    isFormulaMode: boolean;
    isDraggingFillHandle: boolean;
    isResizingHeader: boolean;
    isResizingTable: boolean;
    isDraggingCells: boolean;
  },
  b: {
    isSelecting: boolean;
    isExtending: boolean;
    isFormulaMode: boolean;
    isDraggingFillHandle: boolean;
    isResizingHeader: boolean;
    isResizingTable: boolean;
    isDraggingCells: boolean;
  },
): boolean {
  if (a === b) return true;
  return (
    a.isSelecting === b.isSelecting &&
    a.isExtending === b.isExtending &&
    a.isFormulaMode === b.isFormulaMode &&
    a.isDraggingFillHandle === b.isDraggingFillHandle &&
    a.isResizingHeader === b.isResizingHeader &&
    a.isResizingTable === b.isResizingTable &&
    a.isDraggingCells === b.isDraggingCells
  );
}

/**
 * Compare two summary data objects for equality.
 * Used by useSelectionSummary to prevent unnecessary re-renders.
 */
function summaryDataEqual(
  a: { ranges: CellRange[]; activeCell: CellCoord },
  b: { ranges: CellRange[]; activeCell: CellCoord },
): boolean {
  if (a === b) return true;
  return rangesEqual(a.ranges, b.ranges) && cellCoordEqual(a.activeCell, b.activeCell);
}

// =============================================================================
// TYPES
// =============================================================================

/**
 * Selection flags for components that need interaction state.
 */
export interface SelectionFlags {
  /** Whether user is actively dragging to select */
  isSelecting: boolean;
  /** Whether user is extending selection (Shift+click) */
  isExtending: boolean;
  /** Whether in formula range selection mode */
  isFormulaMode: boolean;
  /** Whether dragging the fill handle */
  isDraggingFillHandle: boolean;
  /** Whether resizing a header */
  isResizingHeader: boolean;
  /** Whether resizing a table */
  isResizingTable: boolean;
  /** Whether dragging cells for move/copy */
  isDraggingCells: boolean;
}

/**
 * Selection summary for StatusBar (debounced).
 */
export interface SelectionSummary {
  /** Number of selected cells (approximation for large ranges) */
  cellCount: number;
  /** Number of selected ranges */
  rangeCount: number;
  /** The primary selection range */
  primaryRange: CellRange | null;
  /** Active cell position */
  activeCell: CellCoord;
}

/**
 * Hook that returns only the selection ranges.
 * Updates only when ranges change, not when active cell or flags change.
 *
 * Use Case: Formula range highlighting, StatusBar range display
 *
 * Performance: This hook only triggers re-renders when ranges array reference
 * changes (XState creates new arrays on mutation).
 *
 * @example
 * ```tsx
 * function RangeDisplay() {
 * const ranges = useSelectionRanges;
 * return <div>Selected: {ranges.length} ranges</div>;
 * }
 * ```
 */
export function useSelectionRanges(): readonly CellRange[] {
  const coordinator = useCoordinator();
  const actor = coordinator.grid.access.actors.selection;

  // Use selectionSelectors.ranges - the single primitive for extraction logic
  // Add rangesEqual to prevent re-renders when array reference changes but content is the same
  const ranges = useSelector(actor, selectionSelectors.ranges, rangesEqual);

  return ranges;
}

/**
 * Hook that returns only selection interaction flags.
 * Updates only when one of the flags changes, not on position changes.
 *
 * Use Case: Components that need to know if user is in a drag operation
 * to disable certain interactions or show different UI.
 *
 * Performance: This hook computes flags from machine state and only triggers
 * re-renders when the flags actually change.
 *
 * @example
 * ```tsx
 * function DragIndicator() {
 * const flags = useIsSelecting;
 * if (flags.isSelecting) return <div>Selecting...</div>;
 * return null;
 * }
 * ```
 */
/**
 * Composite selector for selection flags.
 * Uses individual selectors from selectionSelectors (single source of truth).
 */
function selectSelectionFlags(state: SelectorState): SelectionFlags {
  return {
    isSelecting: selectionSelectors.isActivelySelecting(state),
    isExtending: selectionSelectors.isExtending(state),
    isFormulaMode: selectionSelectors.isInFormulaMode(state),
    isDraggingFillHandle: selectionSelectors.isDraggingFillHandle(state),
    isResizingHeader: selectionSelectors.isResizingHeader(state),
    isResizingTable: selectionSelectors.isResizingTable(state),
    isDraggingCells: selectionSelectors.isDraggingCells(state),
  };
}

export function useIsSelecting(): SelectionFlags {
  const coordinator = useCoordinator();
  const actor = coordinator.grid.access.actors.selection;

  // Use composite selector that composes individual selectors from selectionSelectors
  // Add selectionFlagsEqual to prevent re-renders when object reference changes but content is the same
  const flags = useSelector(actor, selectSelectionFlags, selectionFlagsEqual);

  return flags;
}

/**
 * Hook that returns a debounced selection summary for StatusBar.
 * Only updates after selection "settles" (100ms after last change).
 *
 * Use Case: StatusBar that shows SUM, AVG, COUNT of selected cells.
 * These calculations can be expensive and don't need to update during drag.
 *
 * Performance: Uses debouncing to avoid expensive recalculations during
 * mouse drag operations. The aggregation will only happen after the user
 * stops selecting.
 *
 * @param debounceMs - Delay in milliseconds before updating (default: 100ms)
 *
 * @example
 * ```tsx
 * function StatusBar() {
 * const summary = useSelectionSummary;
 * return <div>{summary.cellCount} cells selected</div>;
 * }
 * ```
 */
/**
 * Composite selector for selection summary data.
 * Uses individual selectors from selectionSelectors (single source of truth).
 */
function selectSummaryData(state: SelectorState): { ranges: CellRange[]; activeCell: CellCoord } {
  return {
    ranges: selectionSelectors.ranges(state),
    activeCell: selectionSelectors.activeCell(state),
  };
}

export function useSelectionSummary(debounceMs = 100): SelectionSummary {
  const coordinator = useCoordinator();
  const actor = coordinator.grid.access.actors.selection;

  // Get immediate data using selectors (single source of truth)
  // Add summaryDataEqual to prevent re-renders when object reference changes but content is the same
  const { ranges, activeCell } = useSelector(actor, selectSummaryData, summaryDataEqual);

  // Debounced state
  const [debouncedSummary, setDebouncedSummary] = useState<SelectionSummary>(() =>
    computeSummary(ranges, activeCell),
  );

  // Debounce timer ref
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Update debounced summary when selection changes
  useEffect(() => {
    // Clear any pending timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // Set new timer
    timerRef.current = setTimeout(() => {
      setDebouncedSummary(computeSummary(ranges, activeCell));
    }, debounceMs);

    // Cleanup on unmount
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [ranges, activeCell, debounceMs]);

  return debouncedSummary;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Compute a selection summary from ranges.
 * Approximates cell count for large ranges to avoid expensive iteration.
 */
function computeSummary(ranges: readonly CellRange[], activeCell: CellCoord): SelectionSummary {
  let cellCount = 0;

  for (const range of ranges) {
    // For full row/column selections, use approximate counts
    if (range.isFullRow || range.isFullColumn) {
      // Approximate: just count the bounded dimension
      const rows = range.endRow - range.startRow + 1;
      const cols = range.endCol - range.startCol + 1;
      cellCount += rows * cols;
    } else {
      // Normal range: compute exact count
      const rows = range.endRow - range.startRow + 1;
      const cols = range.endCol - range.startCol + 1;
      cellCount += rows * cols;
    }
  }

  return {
    cellCount,
    rangeCount: ranges.length,
    primaryRange: ranges.length > 0 ? ranges[0] : null,
    activeCell,
  };
}

// =============================================================================
// SELECTION-MODE HOOKS
// =============================================================================

/**
 * Hook returning the full selection-mode bundle.
 *
 * Subscribes to `selectionActor.context.modes` via XState's `useSelector`.
 * Re-renders only when one of the three flags actually changes.
 *
 * Replaces the legacy UIStore hooks `useEndMode` / `useExtendSelectionMode`
 * / `useAddToSelectionMode`.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 * const modes = useSelectionModes;
 * if (modes.end) return <div>End mode active</div>;
 * return null;
 * }
 * ```
 */
export function useSelectionModes(): SelectionModes {
  const coordinator = useCoordinator();
  const actor = coordinator.grid.access.actors.selection;
  return useSelector(actor, selectionSelectors.modes, selectionModesEqual);
}

/**
 * Hook returning a single mode flag from the selection actor.
 *
 * Convenience wrapper over `useSelectionModes()` for components that only
 * need one of `end` / `extend` / `additive`. Renders only when the
 * specified flag flips.
 *
 * @example
 * ```tsx
 * function StatusBar() {
 * const isEnd = useSelectionMode('end');
 * return <div>{isEnd ? 'End' : ''}</div>;
 * }
 * ```
 */
export function useSelectionMode(mode: keyof SelectionModes): boolean {
  const coordinator = useCoordinator();
  const actor = coordinator.grid.access.actors.selection;
  return useSelector(actor, (state: SelectorState) => selectionSelectors.modes(state)[mode]);
}

/**
 * Hook returning the status-bar mode indicator string.
 *
 * Derives `'End'` / `'EXT'` / `'ADD'` / `null` from the selection actor's
 * mode bundle. Priority order matches the legacy UIStore selector
 * `selectSelectionModeIndicator`: End wins over EXT wins over ADD. End is
 * a transient navigation modifier; the others are sticky modes.
 *
 * Replaces `useUIStore(selectSelectionModeIndicator)` which read from the
 * deleted UIStore slice fields.
 */
export function useSelectionModeIndicator(): string | null {
  const coordinator = useCoordinator();
  const actor = coordinator.grid.access.actors.selection;
  return useSelector(actor, (state: SelectorState) => {
    const modes = selectionSelectors.modes(state);
    if (modes.end) return 'End';
    if (modes.extend) return 'EXT';
    if (modes.additive) return 'ADD';
    return null;
  });
}
