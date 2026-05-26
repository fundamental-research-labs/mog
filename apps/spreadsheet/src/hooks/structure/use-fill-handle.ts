/**
 * Fill Handle Hook - Granular Selection Subscription
 *
 * This hook provides a granular subscription to ONLY the fill handle state,
 * NOT the full selection state. This is a performance optimization for components
 * that only need to track fill handle drag operations.
 *
 * Use Case: SpreadsheetGrid's fill handle rendering, which needs to know when
 * fill handle drag is active and track the start/end positions during drag.
 *
 * Performance Pattern:
 * - Uses XState's useSelector with custom equality function
 * - Only triggers re-renders when fill handle state actually changes
 * - Separates state (reactive) from actions (stable references)
 *
 * @see engine/src/state/hooks/use-active-cell.ts - Similar granular pattern
 * @see engine/src/state/hooks/use-granular-selection.ts - More granular patterns
 */

import { useSelector } from '@xstate/react';
import { useMemo } from 'react';

import { selectionSelectors } from '../../selectors';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import { createSelectionCommands } from '../../coordinator/actor-access';
import { useCoordinator } from '../shared/use-coordinator';

// Type alias for the selector input type
type SelectorState = Parameters<(typeof selectionSelectors)['activeCell']>[0];

// =============================================================================
// TYPES
// =============================================================================

/**
 * Fill handle state extracted from selection machine.
 */
export interface FillHandleState {
  /** Whether fill handle is being dragged (left-click) */
  isDragging: boolean;
  /** Whether fill handle is being right-dragged */
  isRightDragging: boolean;
  /** Fill handle drag start position */
  start: CellCoord | null;
  /** Fill handle drag current end position */
  end: CellCoord | null;
}

/**
 * Fill handle actions for controlling drag operations.
 */
export interface FillHandleActions {
  /** Start left-click fill handle drag */
  startDrag: () => void;
  /** Update drag position */
  onDrag: (cell: CellCoord) => void;
  /** End left-click drag */
  endDrag: () => void;
  /** Start right-click fill handle drag */
  startRightDrag: () => void;
  /** Update right-drag position */
  onRightDrag: (cell: CellCoord) => void;
  /** End right-click drag */
  endRightDrag: () => void;
}

/**
 * Complete return type combining state and actions.
 */
export interface UseFillHandleReturn extends FillHandleState, FillHandleActions {}

// =============================================================================
// SELECTOR & EQUALITY
// =============================================================================

/**
 * Composite selector that extracts fill handle state from selection snapshot.
 * Uses individual selectors from selectionSelectors (single source of truth).
 */
function selectFillHandleState(state: SelectorState): FillHandleState {
  return {
    isDragging: selectionSelectors.isDraggingFillHandle(state),
    isRightDragging: selectionSelectors.isRightDraggingFillHandle(state),
    start: selectionSelectors.fillHandleStart(state),
    end: selectionSelectors.fillHandleEnd(state),
  };
}

/**
 * Custom equality function for fill handle state comparison.
 * Only returns true (preventing re-render) if all fields are identical.
 */
function fillHandleStateEqual(a: FillHandleState, b: FillHandleState): boolean {
  if (a === b) return true;

  // Compare boolean flags first (fast)
  if (a.isDragging !== b.isDragging || a.isRightDragging !== b.isRightDragging) {
    return false;
  }

  // Compare CellCoord fields
  if (!cellCoordEqual(a.start, b.start) || !cellCoordEqual(a.end, b.end)) {
    return false;
  }

  return true;
}

/**
 * Compare two CellCoord values for equality.
 * Returns true if both are null, or if both have the same row and col.
 */
function cellCoordEqual(a: CellCoord | null, b: CellCoord | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.row === b.row && a.col === b.col;
}

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

/**
 * Hook for accessing ONLY fill handle state and actions from selection state.
 *
 * This is a performance-optimized alternative to useSelection() for components
 * that only need to know about fill handle drag operations.
 *
 * Key optimization: Uses useSelector with custom equality function to prevent
 * re-renders when other selection state changes (ranges, active cell, etc.).
 *
 * @example
 * ```tsx
 * function FillHandleOverlay() {
 * const { isDragging, start, end, startDrag, onDrag, endDrag } = useFillHandle;
 *
 * if (!isDragging || !start || !end) return null;
 *
 * return (
 * <div
 * onMouseDown={startDrag}
 * onMouseMove={(e) => onDrag(getCellFromPoint(e))}
 * onMouseUp={endDrag}
 * >
 * Fill handle active: {start.row},{start.col} → {end.row},{end.col}
 * </div>
 * );
 * }
 * ```
 */
export function useFillHandle(): UseFillHandleReturn {
  const coordinator = useCoordinator();
  const actor = coordinator.grid.access.actors.selection;

  // Subscribe to ONLY fill handle state with custom equality
  // This prevents re-renders when other selection changes don't affect fill handle
  const fillHandleState = useSelector(actor, selectFillHandleState, fillHandleStateEqual);

  // Create commands from the actor (memoized to maintain stable references)
  const commands = useMemo(() => createSelectionCommands(actor), [actor]);

  // ═══════════════════════════════════════════════════════════════════════════
  // FILL HANDLE ACTIONS (use commands for type-safe event sending)
  // ═══════════════════════════════════════════════════════════════════════════

  const startDrag = useMemo(
    () => () => {
      commands.startFillHandleDrag();
    },
    [commands],
  );

  const onDrag = useMemo(
    () => (cell: CellCoord) => {
      commands.fillHandleDrag(cell);
    },
    [commands],
  );

  const endDrag = useMemo(
    () => () => {
      commands.endFillHandleDrag();
    },
    [commands],
  );

  const startRightDrag = useMemo(
    () => () => {
      commands.startRightFillHandleDrag();
    },
    [commands],
  );

  const onRightDrag = useMemo(
    () => (cell: CellCoord) => {
      commands.rightFillHandleDrag(cell);
    },
    [commands],
  );

  const endRightDrag = useMemo(
    () => () => {
      commands.endRightFillHandleDrag();
    },
    [commands],
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // RETURN VALUE
  // ═══════════════════════════════════════════════════════════════════════════

  return useMemo(
    () => ({
      // State
      isDragging: fillHandleState.isDragging,
      isRightDragging: fillHandleState.isRightDragging,
      start: fillHandleState.start,
      end: fillHandleState.end,

      // Actions
      startDrag,
      onDrag,
      endDrag,
      startRightDrag,
      onRightDrag,
      endRightDrag,
    }),
    [fillHandleState, startDrag, onDrag, endDrag, startRightDrag, onRightDrag, endRightDrag],
  );
}
