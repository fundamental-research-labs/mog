/**
 * Keyboard Hook
 *
 * React hook that provides access to the centralized KeyboardCoordinator
 * for Excel-parity keyboard shortcut handling.
 *
 * This hook integrates with the KeyboardCoordinator which handles:
 * - Platform normalization (Cmd on Mac = Ctrl on Windows)
 * - Context-aware shortcuts (grid, editing, formula editing, objects)
 * - Browser conflict resolution (override vs defer)
 * - Routing to appropriate XState machines
 *
 * @see contracts/src/keyboard/ - Registry and types
 * @see engine/src/state/coordinator/keyboard-coordination.ts - Implementation
 */

import { useCallback, useMemo } from 'react';

import type { KeyboardShortcut, ShortcutContext } from '@mog-sdk/contracts/keyboard';
import { useCoordinator } from '../shared/use-coordinator';

// =============================================================================
// HOOK RETURN TYPE
// =============================================================================

export interface UseKeyboardReturn {
  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Main keyboard event handler.
   *
   * Attach this to your container's onKeyDown event. The handler:
   * 1. Normalizes platform-specific keys (Cmd↔Ctrl)
   * 2. Looks up the shortcut in the registry
   * 3. Checks if the shortcut is active in the current context
   * 4. Dispatches to the appropriate machine if implemented
   * 5. Calls preventDefault if the event was handled
   *
   * @example
   * ```tsx
   * function Grid() {
   * const keyboard = useKeyboard;
   * return (
   * <div tabIndex={0} onKeyDown={keyboard.handleKeyDown}>
   * <canvas />
   * </div>
   * );
   * }
   * ```
   */
  handleKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;

  /**
   * Keyup event handler.
   *
   * Attach this to your container's onKeyUp event. Currently handles:
   * - Ctrl key release: shows paste options menu if shortly after paste
   *
   * Keyboard Shortcuts
   *
   * @example
   * ```tsx
   * function Grid() {
   * const keyboard = useKeyboard;
   * return (
   * <div tabIndex={0} onKeyDown={keyboard.handleKeyDown} onKeyUp={keyboard.handleKeyUp}>
   * <canvas />
   * </div>
   * );
   * }
   * ```
   */
  handleKeyUp: (event: React.KeyboardEvent<HTMLElement>) => void;

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE QUERIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get the current keyboard context.
   * Returns 'grid', 'editing', 'formulaEditing', or 'objectSelected'.
   */
  getContext: () => ShortcutContext;

  /**
   * Check if a shortcut is available (exists and is implemented).
   *
   * @param keys - Key combination (e.g., 'Ctrl+C', 'F2')
   * @returns true if the shortcut exists and is implemented
   *
   * @example
   * ```tsx
   * if (keyboard.isShortcutAvailable('Ctrl+Shift+ArrowDown')) {
   * // Show hint in UI
   * }
   * ```
   */
  isShortcutAvailable: (keys: string) => boolean;

  /**
   * Get all shortcuts for a given key combination.
   * Returns an array because the same key can have different actions in different contexts.
   *
   * @param keys - Key combination (e.g., 'Ctrl+C', 'F2')
   * @returns Array of shortcuts for this key combination
   */
  getShortcutsForKey: (keys: string) => KeyboardShortcut[];

  /**
   * Check if the KeyboardCoordinator has its dependencies set.
   * Returns false if config.enableKeyboard wasn't set at construction time.
   */
  isReady: boolean;
}

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

/**
 * Hook for centralized keyboard shortcut handling.
 *
 * Uses the KeyboardCoordinator from SheetCoordinator to handle all
 * Excel-parity keyboard shortcuts.
 *
 * Note: Keyboard must be enabled via config.enableKeyboard
 * at SheetCoordinator construction time.
 *
 * Uses coordinator/Workbook for all operations. SpreadsheetStore removed.
 *
 * @example
 * ```tsx
 * function SpreadsheetGrid() {
 * const coordinator = useCoordinator;
 * const keyboard = useKeyboard;
 *
 * return (
 * <div tabIndex={0} onKeyDown={keyboard.handleKeyDown}>
 * <canvas />
 * </div>
 * );
 * }
 * ```
 */
export function useKeyboard(): UseKeyboardReturn {
  const coordinator = useCoordinator();
  const keyboardCoordinator = coordinator.input.keyboardCoordinator;

  // ============================================================================
  // Event Handler
  // ============================================================================

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      const result = keyboardCoordinator.handleKeyboardEvent(e.nativeEvent);

      if (result.handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    [keyboardCoordinator],
  );

  /**
   * Handle keyup events.
   * Keyboard Shortcuts - Ctrl key trigger for paste options.
   */
  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      const handled = keyboardCoordinator.handleKeyUp(e.nativeEvent);

      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    [keyboardCoordinator],
  );

  // ============================================================================
  // State Queries
  // ============================================================================

  const getContext = useCallback(() => {
    return keyboardCoordinator.getContext();
  }, [keyboardCoordinator]);

  const isShortcutAvailable = useCallback(
    (keys: string) => {
      return keyboardCoordinator.isShortcutAvailable(keys);
    },
    [keyboardCoordinator],
  );

  const getShortcutsForKey = useCallback(
    (keys: string) => {
      return keyboardCoordinator.getShortcutsForKey(keys);
    },
    [keyboardCoordinator],
  );

  const isReady = keyboardCoordinator.hasDependencies();

  // ============================================================================
  // Return Memoized Value
  // ============================================================================

  return useMemo(
    () => ({
      handleKeyDown,
      handleKeyUp,
      getContext,
      isShortcutAvailable,
      getShortcutsForKey,
      isReady,
    }),
    [handleKeyDown, handleKeyUp, getContext, isShortcutAvailable, getShortcutsForKey, isReady],
  );
}
