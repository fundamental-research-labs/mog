/**
 * Focus Hook
 *
 * React hook that wraps the focus state machine actor.
 * Provides type-safe access to focus state and actions for keyboard handling.
 *
 * The focus machine tracks which component should receive keyboard events.
 * Components use this hook to:
 * 1. Check if they should handle keyboard events (shouldGridHandle)
 * 2. Push/pop focus layers when dialogs open/close
 * 3. Check for global shortcuts that work regardless of focus state
 *
 * @see FOCUS-BASED-KEYBOARD-HANDLING.md for architecture details
 */

import { useSelector } from '@xstate/react';
import { useCallback, useMemo } from 'react';

import { getFocusSnapshot } from '@mog/shell';
import type { FocusLayer, FocusLayerType, FocusSnapshot } from '@mog-sdk/contracts/machines';
import { GLOBAL_SHORTCUTS, isGlobalShortcut } from '../../systems/shared/utils/focus-utils';
import { useCoordinator } from '../shared/use-coordinator';

// =============================================================================
// EQUALITY FUNCTION
// =============================================================================

/**
 * Compare two FocusLayer objects for equality.
 */
function focusLayerEqual(a: FocusLayer, b: FocusLayer): boolean {
  return a.type === b.type && a.id === b.id && a.returnFocusTarget === b.returnFocusTarget;
}

/**
 * Custom equality function for FocusSnapshot comparison.
 * Only returns true (preventing re-render) if all tracked fields are identical.
 *
 * This is critical for performance - we only want to re-render when
 * focus state actually changes, not on every state machine transition.
 */
function focusSnapshotEqual(a: FocusSnapshot, b: FocusSnapshot): boolean {
  // Quick checks for primitives
  if (a.state !== b.state) return false;
  if (a.isInOverlay !== b.isInOverlay) return false;
  if (a.shouldGridHandle !== b.shouldGridHandle) return false;

  // Compare currentLayer
  if (!focusLayerEqual(a.currentLayer, b.currentLayer)) return false;

  // Compare stack (shallow comparison - same length and same layers)
  if (a.stack.length !== b.stack.length) return false;
  for (let i = 0; i < a.stack.length; i++) {
    if (!focusLayerEqual(a.stack[i], b.stack[i])) return false;
  }

  return true;
}

// =============================================================================
// HOOK RETURN TYPE
// =============================================================================

export interface UseFocusReturn {
  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════

  /** Current focus state name */
  state: FocusLayerType;

  /** Current (top) focus layer */
  currentLayer: FocusLayer;

  /** Full focus stack (for debugging) */
  stack: readonly FocusLayer[];

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE CHECKS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Whether focus is in grid state (base state) */
  isGrid: boolean;

  /** Whether focus is in editor state (cell editing) */
  isEditor: boolean;

  /** Whether focus is in a dialog */
  isDialog: boolean;

  /** Whether focus is in the command palette */
  isCommandPalette: boolean;

  /** Whether focus is in a context menu */
  isContextMenu: boolean;

  /** Whether focus is in the formula picker */
  isFormulaPicker: boolean;

  /** Whether focus is in the formula bar */
  isFormulaBar: boolean;

  /** Whether focus is in sheet tabs */
  isSheetTabs: boolean;

  /** Whether focus is in an overlay (not grid or editor) */
  isInOverlay: boolean;

  // ═══════════════════════════════════════════════════════════════════════════
  // KEYBOARD HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check if grid should handle keyboard events.
   * Returns true only when focus is in 'grid' state.
   * Use this in your keyboard handler before processing grid shortcuts.
   */
  shouldGridHandle: () => boolean;

  /**
   * Check if a keyboard event is a global shortcut.
   * Global shortcuts (Cmd+S, Ctrl+Z, etc.) work regardless of focus state.
   * Check this BEFORE shouldGridHandle().
   */
  isGlobalShortcut: (e: KeyboardEvent) => boolean;

  // ═══════════════════════════════════════════════════════════════════════════
  // FOCUS LAYER ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Push a focus layer onto the stack.
   * Use this when opening dialogs, command palettes, context menus, etc.
   *
   * @param layerType - Type of focus layer
   * @param id - Unique identifier for this layer instance (for debugging)
   *
   * @example
   * ```tsx
   * // When opening a dialog
   * useEffect(() => {
   * pushLayer('dialog', 'format-cells-dialog');
   * return => popLayer;
   * }, [pushLayer, popLayer]);
   * ```
   */
  pushLayer: (layerType: FocusLayerType, id: string) => void;

  /**
   * Pop the current focus layer from the stack.
   * Focus restoration is handled automatically.
   *
   * @example
   * ```tsx
   * // When closing a dialog
   * const handleClose = () => {
   * popLayer;
   * onClose;
   * };
   * ```
   */
  popLayer: () => void;

  /**
   * Emergency reset - close all overlays and return to grid.
   * Use sparingly, e.g., on unrecoverable errors or explicit user escape.
   */
  resetToGrid: () => void;

  // ═══════════════════════════════════════════════════════════════════════════
  // SNAPSHOT ACCESS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Full snapshot for advanced usage */
  snapshot: FocusSnapshot;
}

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

/**
 * Hook for accessing and controlling the focus state machine.
 *
 * @example
 * ```tsx
 * // In a keyboard handler
 * function GridKeyboardHandler() {
 * const { shouldGridHandle, isGlobalShortcut } = useFocus;
 *
 * const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
 * // 1. Global shortcuts always work
 * if (isGlobalShortcut(e.nativeEvent)) {
 * handleGlobalShortcut(e);
 * return;
 * }
 *
 * // 2. Check if grid should handle keyboard
 * if (!shouldGridHandle) {
 * return; // Dialog or editor has focus
 * }
 *
 * // 3. Normal grid keyboard handling
 * switch (e.key) {
 * case 'Delete': // ...
 * }
 * }, [shouldGridHandle, isGlobalShortcut]);
 * }
 *
 * // In a dialog component
 * function MyDialog({ onClose }) {
 * const { pushLayer, popLayer } = useFocus;
 *
 * useEffect(() => {
 * pushLayer('dialog', 'my-dialog');
 * return => popLayer;
 * }, [pushLayer, popLayer]);
 *
 * return <div>Dialog content...</div>;
 * }
 * ```
 */
export function useFocus(): UseFocusReturn {
  const coordinator = useCoordinator();
  const actor = coordinator.input.access.actors.focus;
  if (!actor) {
    throw new Error('useFocus: focus actor not wired — call setFocusActor() before rendering');
  }

  // Subscribe to the full snapshot with custom equality to prevent unnecessary re-renders
  const snapshot = useSelector(actor, (state) => getFocusSnapshot(state), focusSnapshotEqual);

  // ═══════════════════════════════════════════════════════════════════════════
  // KEYBOARD HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  const shouldGridHandle = useCallback(() => {
    return coordinator.input.shouldGridHandleKeyboard();
  }, [coordinator]);

  const isGlobalShortcutFn = useCallback((e: KeyboardEvent) => {
    return isGlobalShortcut(e);
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // FOCUS LAYER ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  const pushLayer = useCallback(
    (layerType: FocusLayerType, id: string) => {
      coordinator.input.pushFocusLayer(layerType, id);
    },
    [coordinator],
  );

  const popLayer = useCallback(() => {
    coordinator.input.popFocusLayer();
  }, [coordinator]);

  const resetToGrid = useCallback(() => {
    coordinator.input.resetFocusToGrid();
  }, [coordinator]);

  // ═══════════════════════════════════════════════════════════════════════════
  // RETURN VALUE
  // ═══════════════════════════════════════════════════════════════════════════

  return useMemo(
    () => ({
      // State
      state: snapshot.state,
      currentLayer: snapshot.currentLayer,
      stack: snapshot.stack,

      // State checks
      isGrid: snapshot.state === 'grid',
      isEditor: snapshot.state === 'editor',
      isDialog: snapshot.state === 'dialog',
      isCommandPalette: snapshot.state === 'commandPalette',
      isContextMenu: snapshot.state === 'contextMenu',
      isFormulaPicker: snapshot.state === 'formulaPicker',
      isFormulaBar: snapshot.state === 'formulaBar',
      isSheetTabs: snapshot.state === 'sheetTabs',
      isInOverlay: snapshot.isInOverlay,

      // Keyboard handling
      shouldGridHandle,
      isGlobalShortcut: isGlobalShortcutFn,

      // Focus layer actions
      pushLayer,
      popLayer,
      resetToGrid,

      // Snapshot
      snapshot,
    }),
    [snapshot, shouldGridHandle, isGlobalShortcutFn, pushLayer, popLayer, resetToGrid],
  );
}

// =============================================================================
// RE-EXPORTS FOR CONVENIENCE
// =============================================================================

export { GLOBAL_SHORTCUTS, isGlobalShortcut };
export type { FocusLayer, FocusLayerType, FocusSnapshot };
