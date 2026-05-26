/**
 * Table Resize Hook - Granular Selection Subscription
 *
 * This hook provides a granular subscription to ONLY table resize state,
 * NOT the full selection state. This is a performance optimization.
 *
 * Use Case: Components that need to track table resize operations (e.g., SpreadsheetGrid
 * for rendering resize handles and preview overlays).
 *
 * Performance: Uses XState's useSelector with custom equality to only trigger
 * re-renders when table resize state actually changes.
 *
 * @see engine/src/state/hooks/use-active-cell.ts - Similar pattern for active cell
 * @see engine/src/state/hooks/use-granular-selection.ts - Granular hooks pattern
 */

import { useSelector } from '@xstate/react';
import { useMemo } from 'react';

import { selectionSelectors } from '../../selectors';
import type { CellRange } from '@mog-sdk/contracts/core';
import { useCoordinator } from '../shared/use-coordinator';

// Type alias for the selector input type, derived from the selectors themselves
// This ensures type compatibility with XState's actual snapshot type
type SelectorState = Parameters<(typeof selectionSelectors)['activeCell']>[0];

// =============================================================================
// TYPES
// =============================================================================

/**
 * Table resize state for components that need to track table resize operations.
 */
export interface TableResizeState {
  /** Whether a table is currently being resized */
  isResizing: boolean;
  /** ID of table being resized (null if not resizing) */
  tableId: string | null;
  /** Current target row during resize (null if not resizing) */
  targetRow: number | null;
  /** Current target column during resize (null if not resizing) */
  targetCol: number | null;
  /** Original table bounds when resize started (null if not resizing) */
  startBounds: CellRange | null;
}

/**
 * Table resize actions for controlling table resize operations.
 */
export interface TableResizeActions {
  /** Start table resize operation */
  startTableResize: (tableId: string, tableBounds: CellRange) => void;
  /** Update resize target during drag */
  onTableResizeMove: (targetRow: number, targetCol: number) => void;
  /** End table resize operation */
  endTableResize: () => void;
  /** Cancel table resize operation */
  cancelTableResize: () => void;
}

/**
 * Return type for useTableResize hook.
 */
export interface UseTableResizeReturn extends TableResizeState, TableResizeActions {}

// =============================================================================
// SELECTOR & EQUALITY
// =============================================================================

/**
 * Composite selector for table resize state.
 * Uses individual selectors from selectionSelectors (single source of truth).
 */
function selectTableResizeState(state: SelectorState): TableResizeState {
  return {
    isResizing: selectionSelectors.isResizingTable(state),
    tableId: selectionSelectors.tableResizeId(state),
    targetRow: selectionSelectors.tableResizeTargetRow(state),
    targetCol: selectionSelectors.tableResizeTargetCol(state),
    startBounds: selectionSelectors.tableResizeStartBounds(state),
  };
}

/**
 * Custom equality function for table resize state comparison.
 * Only returns true (preventing re-render) if all fields are identical.
 */
function tableResizeStateEqual(a: TableResizeState, b: TableResizeState): boolean {
  return (
    a.isResizing === b.isResizing &&
    a.tableId === b.tableId &&
    a.targetRow === b.targetRow &&
    a.targetCol === b.targetCol &&
    // Compare startBounds (both null or same values)
    (a.startBounds === b.startBounds ||
      (a.startBounds !== null &&
        b.startBounds !== null &&
        a.startBounds.startRow === b.startBounds.startRow &&
        a.startBounds.startCol === b.startBounds.startCol &&
        a.startBounds.endRow === b.startBounds.endRow &&
        a.startBounds.endCol === b.startBounds.endCol))
  );
}

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

/**
 * Hook for accessing table resize state and actions.
 *
 * This is a performance-optimized alternative to useSelection() for components
 * that only need to track table resize operations.
 *
 * Key optimization: Uses useSelector with custom equality function to prevent
 * re-renders when other selection state changes (active cell, ranges, etc.).
 *
 * @example
 * ```tsx
 * function TableResizeOverlay() {
 * const {
 * isResizing,
 * tableId,
 * targetRow,
 * targetCol,
 * startBounds,
 * onTableResizeMove
 * } = useTableResize;
 *
 * if (!isResizing || !startBounds) return null;
 *
 * // Render resize preview overlay
 * return (
 * <div
 * onMouseMove={(e) => {
 * const { row, col } = getCellFromPoint(e);
 * onTableResizeMove(row, col);
 * }}
 * />
 * );
 * }
 * ```
 */
export function useTableResize(): UseTableResizeReturn {
  const coordinator = useCoordinator();
  const actor = coordinator.grid.access.actors.selection;

  // Subscribe to ONLY table resize state with custom equality
  // This prevents re-renders when other selection changes occur
  const tableResizeState = useSelector(actor, selectTableResizeState, tableResizeStateEqual);

  // Get pre-created commands from the grid system (stable references)
  const commands = coordinator.grid.access.commands.selection;

  // ═══════════════════════════════════════════════════════════════════════════
  // TABLE RESIZE ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  const startTableResize = useMemo(
    () => (tableId: string, tableBounds: CellRange) => {
      commands.startTableResize(tableId, tableBounds);
    },
    [commands],
  );

  const onTableResizeMove = useMemo(
    () => (targetRow: number, targetCol: number) => {
      commands.tableResizeMove(targetRow, targetCol);
    },
    [commands],
  );

  const endTableResize = useMemo(
    () => () => {
      commands.endTableResize();
    },
    [commands],
  );

  const cancelTableResize = useMemo(
    () => () => {
      commands.cancelTableResize();
    },
    [commands],
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // RETURN VALUE
  // ═══════════════════════════════════════════════════════════════════════════

  return useMemo(
    () => ({
      // State
      isResizing: tableResizeState.isResizing,
      tableId: tableResizeState.tableId,
      targetRow: tableResizeState.targetRow,
      targetCol: tableResizeState.targetCol,
      startBounds: tableResizeState.startBounds,

      // Actions
      startTableResize,
      onTableResizeMove,
      endTableResize,
      cancelTableResize,
    }),
    [tableResizeState, startTableResize, onTableResizeMove, endTableResize, cancelTableResize],
  );
}
