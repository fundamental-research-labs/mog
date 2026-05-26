/**
 * Header Resize Hook - Granular Selection Subscription
 *
 * This hook provides a granular subscription to ONLY the header resize state,
 * NOT the full selection state. This is a critical performance optimization.
 *
 * Problem: Components were subscribing to full selection state via useSelection(),
 * causing unnecessary re-renders when other selection properties changed.
 *
 * Solution: Use XState's useSelector with a custom equality function that
 * only triggers re-renders when header resize state actually changes.
 *
 * @see engine/src/state/hooks/use-selection.ts - Lines 317-360 (header resize state/actions)
 * @see engine/src/state/hooks/use-active-cell.ts - Pattern reference
 * @see engine/src/state/hooks/use-granular-selection.ts - Pattern reference
 */

import { useSelector } from '@xstate/react';
import { useMemo } from 'react';

import { selectionSelectors } from '../../selectors';
import { createSelectionCommands } from '../../coordinator/actor-access';
import { useCoordinator } from '../shared/use-coordinator';

// Type alias for the selector input type
type SelectorState = Parameters<(typeof selectionSelectors)['isResizingHeader']>[0];

// =============================================================================
// TYPES
// =============================================================================

/**
 * Header resize state for components that manage column/row resizing.
 */
export interface HeaderResizeState {
  /** Whether currently resizing a column or row header */
  isResizing: boolean;
  /** Type of resize: 'column' | 'row' | null */
  type: 'column' | 'row' | null;
  /** Index of the column or row being resized */
  index: number | null;
  /** Current size during resize (for visual feedback) */
  currentSize: number | null;
}

/**
 * Header resize actions for controlling resize operations.
 */
export interface HeaderResizeActions {
  /** Start resizing a column header */
  startColumnResize: (
    col: number,
    startPosition: number,
    startSize: number,
    /** Optional array of columns for multi-select resize */
    cols?: number[],
    /** Optional map of starting sizes for multi-select resize */
    startSizes?: Map<number, number>,
  ) => void;

  /** Start resizing a row header */
  startRowResize: (
    row: number,
    startPosition: number,
    startSize: number,
    /** Optional array of rows for multi-select resize */
    rows?: number[],
    /** Optional map of starting sizes for multi-select resize */
    startSizes?: Map<number, number>,
  ) => void;

  /** Update resize position during drag */
  onResizeMove: (position: number) => void;

  /** End resize operation */
  endResize: () => void;

  /** Cancel resize operation (e.g., Escape key) */
  cancelResize: () => void;
}

/**
 * Complete return type combining state and actions.
 */
export interface UseHeaderResizeReturn extends HeaderResizeState, HeaderResizeActions {}

// =============================================================================
// SELECTOR & EQUALITY FUNCTION
// =============================================================================

/**
 * Selector that extracts just the header resize state fields.
 * Uses individual selectors from selectionSelectors (single source of truth).
 */
function selectHeaderResizeState(state: SelectorState): HeaderResizeState {
  return {
    isResizing: selectionSelectors.isResizingHeader(state),
    type: selectionSelectors.resizeType(state),
    index: selectionSelectors.resizeIndex(state),
    currentSize: selectionSelectors.resizeCurrentSize(state),
  };
}

/**
 * Custom equality function for HeaderResizeState comparison.
 * Only returns true (preventing re-render) if all fields are identical.
 */
function headerResizeStateEqual(a: HeaderResizeState, b: HeaderResizeState): boolean {
  return (
    a.isResizing === b.isResizing &&
    a.type === b.type &&
    a.index === b.index &&
    a.currentSize === b.currentSize
  );
}

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

/**
 * Hook for accessing header resize state and actions.
 *
 * This is a performance-optimized alternative to useSelection() for components
 * that only need header resize functionality (column/row headers, resize handles).
 *
 * Key optimization: Uses useSelector with custom equality function to prevent
 * re-renders when other selection state changes but resize state stays the same.
 *
 * @example
 * ```tsx
 * function ColumnHeader({ col }: { col: number }) {
 * const {
 * isResizing,
 * type,
 * index,
 * currentSize,
 * startColumnResize,
 * onResizeMove,
 * endResize
 * } = useHeaderResize;
 *
 * const isResizingThisColumn = isResizing && type === 'column' && index === col;
 *
 * return (
 * <div
 * onMouseDown={(e) => {
 * if (isResizeHandle(e)) {
 * const colWidth = getColumnWidth(col);
 * startColumnResize(col, e.clientX, colWidth);
 * }
 * }}
 * >
 * {isResizingThisColumn && currentSize ? `${currentSize}px` : null}
 * </div>
 * );
 * }
 * ```
 */
export function useHeaderResize(): UseHeaderResizeReturn {
  const coordinator = useCoordinator();
  const actor = coordinator.grid.access.actors.selection;

  // Subscribe to ONLY header resize state with custom equality
  // This prevents re-renders when ranges/activeCell change but resize state stays same
  const resizeState = useSelector(actor, selectHeaderResizeState, headerResizeStateEqual);

  // Create commands from the actor (memoized to maintain stable references)
  const commands = useMemo(() => createSelectionCommands(actor), [actor]);

  // Memoize action callbacks
  const startColumnResize = useMemo(
    () =>
      (
        col: number,
        startPosition: number,
        startSize: number,
        cols?: number[],
        startSizes?: Map<number, number>,
      ) => {
        commands.startColumnResize(col, startPosition, startSize, cols, startSizes);
      },
    [commands],
  );

  const startRowResize = useMemo(
    () =>
      (
        row: number,
        startPosition: number,
        startSize: number,
        rows?: number[],
        startSizes?: Map<number, number>,
      ) => {
        commands.startRowResize(row, startPosition, startSize, rows, startSizes);
      },
    [commands],
  );

  const onResizeMove = useMemo(
    () => (position: number) => {
      commands.resizeMove(position);
    },
    [commands],
  );

  const endResize = useMemo(
    () => () => {
      commands.endResize();
    },
    [commands],
  );

  const cancelResize = useMemo(
    () => () => {
      commands.cancelResize();
    },
    [commands],
  );

  // Combine state and actions
  return useMemo(
    () => ({
      // State
      isResizing: resizeState.isResizing,
      type: resizeState.type,
      index: resizeState.index,
      currentSize: resizeState.currentSize,

      // Actions
      startColumnResize,
      startRowResize,
      onResizeMove,
      endResize,
      cancelResize,
    }),
    [resizeState, startColumnResize, startRowResize, onResizeMove, endResize, cancelResize],
  );
}
