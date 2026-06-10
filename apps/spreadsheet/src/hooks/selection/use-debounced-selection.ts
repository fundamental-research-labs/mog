/**
 * Debounced Selection Hook
 *
 * Provides debounced access to selection state that only updates when selection settles.
 * This prevents unnecessary re-renders during high-frequency selection changes (60Hz during drag).
 *
 * Use this hook for low-frequency UI components (NameBox, StatusBar-like components)
 * that don't need real-time selection updates during drag operations.
 *
 * Architecture:
 * - Section 15: Render Isolation - High-frequency state changes must NOT trigger re-renders
 * in low-frequency UI components
 * - Pattern from StatusBar.tsx - Debounced subscription to selection actor
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 15: Render Isolation
 */

import { useEffect, useRef, useState } from 'react';

import type { CellRange } from '@mog-sdk/contracts/core';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import { getSelectionSnapshot } from '../../systems/grid-editing/machines/selection/derived-state';
import { useCoordinator } from '../shared/use-coordinator';

// =============================================================================
// Constants
// =============================================================================

/**
 * Default debounce delay for selection state updates (ms).
 * Selection should only update after it settles (mouse up, not during drag).
 * This prevents unnecessary re-renders during selection drag operations.
 * Same value as StatusBar uses for consistency.
 */
export const DEFAULT_SELECTION_SETTLE_DEBOUNCE_MS = 100;

// =============================================================================
// Types
// =============================================================================

/**
 * Return type for useDebouncedSelection hook.
 */
export interface DebouncedSelectionState {
  /** Current selection ranges (debounced) */
  ranges: CellRange[];
  /** Current active cell (debounced) */
  activeCell: CellCoord;
  /** Whether the selection is currently being dragged (not debounced - immediate) */
  isSelecting: boolean;
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook that provides debounced selection state.
 *
 * Only updates when selection transitions to 'idle' state (drag ends),
 * with an additional debounce to handle rapid state changes.
 *
 * This is ideal for:
 * - NameBox (A1 address display)
 * - StatusBar (selection statistics)
 * - Any UI that doesn't need real-time updates during drag
 *
 * @param debounceMs - Debounce delay in milliseconds (default: 100)
 * @returns Debounced selection state
 *
 * @example
 * ```tsx
 * function NameBox() {
 * const { ranges, activeCell } = useDebouncedSelection;
 * const address = toA1(activeCell.row, activeCell.col);
 * return <span>{address}</span>;
 * }
 * ```
 */
export function useDebouncedSelection(
  debounceMs: number = DEFAULT_SELECTION_SETTLE_DEBOUNCE_MS,
): DebouncedSelectionState {
  const coordinator = useCoordinator();

  // Debounced state
  const [debouncedRanges, setDebouncedRanges] = useState<CellRange[]>([]);
  const [debouncedActiveCell, setDebouncedActiveCell] = useState<CellCoord>({ row: 0, col: 0 });
  const [isSelecting, setIsSelecting] = useState(false);

  // Refs for debounce and transition detection
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousStateRef = useRef<string | null>(null);

  useEffect(() => {
    const selectionActor = coordinator.grid.access.actors.selection;

    const subscription = selectionActor.subscribe((state) => {
      const currentState = state.value as string;
      const wasIdle = previousStateRef.current === 'idle';
      const isIdle = currentState === 'idle' || state.matches('idle');

      // Track transition for optimization
      const transitionedToIdle = !wasIdle && isIdle;
      previousStateRef.current = isIdle ? 'idle' : currentState;

      // Update isSelecting immediately (not debounced) for UI feedback
      setIsSelecting(!isIdle);

      // Only update ranges when selection settles (transitions to idle)
      // This prevents re-renders during mouse drag
      if (transitionedToIdle) {
        // Transition from selecting → idle (mouse-up / click): update immediately.
        // Debouncing here adds latency that breaks UI components relying on prompt
        // Name Box display updates (e.g. named-range reverse-lookup after a click).
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
          debounceRef.current = null;
        }
        const snapshot = getSelectionSnapshot(state);
        setDebouncedRanges(snapshot.ranges);
        setDebouncedActiveCell(snapshot.activeCell);
      } else if (isIdle) {
        // Sustained idle (e.g. programmatic updates): debounce to avoid
        // redundant renders from rapid back-to-back mutations.
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
        }
        if (debounceMs <= 0) {
          const snapshot = getSelectionSnapshot(state);
          setDebouncedRanges(snapshot.ranges);
          setDebouncedActiveCell(snapshot.activeCell);
          debounceRef.current = null;
          return;
        }
        debounceRef.current = setTimeout(() => {
          const snapshot = getSelectionSnapshot(state);
          setDebouncedRanges(snapshot.ranges);
          setDebouncedActiveCell(snapshot.activeCell);
          debounceRef.current = null;
        }, debounceMs);
      }
    });

    // Get initial state
    const initialState = selectionActor.getSnapshot();
    const initialSnapshot = getSelectionSnapshot(initialState);
    setDebouncedRanges(initialSnapshot.ranges);
    setDebouncedActiveCell(initialSnapshot.activeCell);
    setIsSelecting(!initialState.matches('idle'));
    previousStateRef.current = initialState.matches('idle') ? 'idle' : null;

    return () => {
      subscription.unsubscribe();
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [coordinator, debounceMs]);

  return {
    ranges: debouncedRanges,
    activeCell: debouncedActiveCell,
    isSelecting,
  };
}

/**
 * Hook that provides only the debounced active cell.
 *
 * More granular than useDebouncedSelection when you only need the active cell.
 *
 * @param debounceMs - Debounce delay in milliseconds (default: 100)
 * @returns Debounced active cell
 */
export function useDebouncedActiveCell(
  debounceMs: number = DEFAULT_SELECTION_SETTLE_DEBOUNCE_MS,
): CellCoord {
  const { activeCell } = useDebouncedSelection(debounceMs);
  return activeCell;
}

/**
 * Hook that provides only the debounced selection ranges.
 *
 * More granular than useDebouncedSelection when you only need the ranges.
 *
 * @param debounceMs - Debounce delay in milliseconds (default: 100)
 * @returns Debounced selection ranges
 */
export function useDebouncedSelectionRanges(
  debounceMs: number = DEFAULT_SELECTION_SETTLE_DEBOUNCE_MS,
): CellRange[] {
  const { ranges } = useDebouncedSelection(debounceMs);
  return ranges;
}
