/**
 * Input State Hook - Granular Input Subscription
 *
 * This hook provides ONLY the input machine state (idle, panning, momentum, etc.).
 * It subscribes to machine state changes, which happen RARELY (on state transitions).
 *
 * Problem: useInput() subscribes to scrollState via useSyncExternalStore, causing
 * 842 React re-renders per second during scroll. SpreadsheetGrid uses isPanning
 * (derived from machineState) for cursor changes, but machineState only changes
 * on state transitions (start/end of pan), not every frame.
 *
 * Solution: Split useInput() into granular hooks. This hook subscribes only to
 * machineState, which changes on the order of seconds (user gesture boundaries),
 * not milliseconds (scroll frames).
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 14: Render Isolation
 */

import { useCallback, useSyncExternalStore } from 'react';

import type { InputMachineState } from '../../systems/input/machines/input-types';
import { useCoordinator } from '../shared/use-coordinator';

// =============================================================================
// TYPES
// =============================================================================

export interface UseInputStateReturn {
  /** Current input machine state (idle, scrolling, momentum, panning, pinching, zooming) */
  machineState: InputMachineState;

  /** Whether momentum scrolling is currently active */
  isMomentumScrolling: boolean;

  /** Whether currently panning (middle-click or space+drag) */
  isPanning: boolean;

  /** Whether currently pinching (touch) */
  isPinching: boolean;
}

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

/**
 * Hook for accessing the input machine state (interaction mode).
 *
 * This is a performance-optimized alternative to useInput() for components
 * that only need to know the current interaction mode (panning, scrolling, etc.)
 * without subscribing to continuous scroll position updates.
 *
 * Key optimization: Subscribes ONLY to machine state transitions, which happen
 * on gesture boundaries (start/end of pan, start/end of momentum), not on
 * every scroll frame.
 *
 * @example
 * ```tsx
 * function CursorController() {
 * const { isPanning } = useInputState;
 *
 * // Only re-renders when panning starts/ends, not every scroll frame
 * return <div style={{ cursor: isPanning ? 'grab' : 'default' }} />;
 * }
 * ```
 */
export function useInputState(): UseInputStateReturn {
  const coordinator = useCoordinator();
  const inputCoordinator = coordinator.input.inputCoordinator;

  // Subscribe to machine state changes only
  // This uses onStateChange, NOT onScrollChange
  const machineState = useSyncExternalStore(
    useCallback(
      (callback: () => void) => {
        return inputCoordinator.onStateChange(callback);
      },
      [inputCoordinator],
    ),
    useCallback(() => inputCoordinator.getMachineState(), [inputCoordinator]),
    useCallback(() => inputCoordinator.getMachineState(), [inputCoordinator]),
  );

  // Derived state - computed from machineState, no additional subscription
  const isMomentumScrolling = machineState === 'momentum';
  const isPanning = machineState === 'panning';
  const isPinching = machineState === 'pinching';

  return {
    machineState,
    isMomentumScrolling,
    isPanning,
    isPinching,
  };
}
