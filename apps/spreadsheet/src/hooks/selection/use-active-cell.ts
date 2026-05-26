/**
 * Active Cell Hook - Granular Selection Subscription
 *
 * This hook provides a granular subscription to ONLY the active cell position,
 * NOT the full selection state. This is a critical performance optimization.
 *
 * Problem: FormulaBarContainer and NameBoxDropdown were subscribing to full
 * selection state via useSelection(), causing 591 re-renders during selection
 * drag operations. These components only need to know the active cell position.
 *
 * Solution: Use XState's useSelector with a custom equality function that
 * only triggers re-renders when the active cell position actually changes.
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 14: Render Isolation
 */

import { useSelector } from '@xstate/react';

import { selectionSelectors } from '../../selectors';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import { useCoordinator } from '../shared/use-coordinator';

// =============================================================================
// TYPES
// =============================================================================

export interface UseActiveCellReturn {
  /** The active cell row (0-indexed) */
  row: number;
  /** The active cell column (0-indexed) */
  col: number;
  /** The active cell as a CellCoord object */
  activeCell: CellCoord;
}

// =============================================================================
// EQUALITY FUNCTION
// =============================================================================

/**
 * Custom equality function for active cell comparison.
 * Only returns true (preventing re-render) if row AND col are identical.
 */
function activeCellEqual(a: CellCoord | undefined, b: CellCoord | undefined): boolean {
  if (!a || !b) return a === b;
  return a.row === b.row && a.col === b.col;
}

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

/**
 * Hook for accessing ONLY the active cell position from selection state.
 *
 * This is a performance-optimized alternative to useSelection() for components
 * that only need to know the active cell (formula bar, name box, etc.).
 *
 * Key optimization: Uses useSelector with custom equality function to prevent
 * re-renders when selection ranges change but active cell stays the same.
 *
 * @example
 * ```tsx
 * function FormulaBar() {
 * const { row, col } = useActiveCell;
 * const cellAddress = toA1(row, col);
 * // Only re-renders when active cell position changes,
 * // NOT during selection drag operations
 * return <div>Current: {cellAddress}</div>;
 * }
 * ```
 */
export function useActiveCell(): UseActiveCellReturn {
  const coordinator = useCoordinator();
  const actor = coordinator.grid.access.actors.selection;

  // Subscribe to ONLY activeCell with custom equality
  // This prevents re-renders when ranges change but activeCell stays same
  // Uses selectionSelectors.activeCell - the single primitive for extraction logic
  const activeCell = useSelector(actor, selectionSelectors.activeCell, activeCellEqual);

  return {
    row: activeCell.row,
    col: activeCell.col,
    activeCell,
  };
}
