/**
 * Grid Keyboard Hook
 *
 * Provides React integration for keyboard handling in the grid.
 *
 * ARCHITECTURE:
 * - KeyboardCoordinator is the SINGLE SOURCE OF TRUTH for all shortcuts
 * - This hook provides:
 * 1. React integration layer (useCallback, event handling)
 * 2. Focus management (should grid handle this event?)
 * 3. Type-to-edit fallback (not a shortcut, triggered by printable characters)
 * 4. Special mode handling (ScrollLock, Format Painter)
 *
 * All keyboard shortcuts are defined in contracts/src/keyboard/registry.ts
 * and handled by the KeyboardCoordinator via action handlers.
 *
 * @see contracts/src/keyboard/registry.ts - Shortcut registry
 * @see engine/src/state/coordinator/keyboard-coordination.ts - Coordinator
 */

import { useCallback, useMemo } from 'react';

import { type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { MutationResult } from '@mog-sdk/contracts/protection';

import { withHandlerErrors } from '../../devtools/handler-error-boundary';
import { useReadOnly, useUIStore, useUIStoreApi } from '../../infra/context';
import { useEditorActions } from '../editing/use-editor-actions';
import { useActiveCell } from '../selection/use-active-cell';
import { useCoordinator } from '../shared/use-coordinator';
import { useDispatch } from '../toolbar/use-action-dependencies';
import { useFocus } from './use-focus';
import { useKeyboard } from './use-keyboard';

// =============================================================================
// Types
// =============================================================================

export interface UseGridKeyboardOptions {
  /** Active sheet ID */
  activeSheetId: string;
}

export interface UseGridKeyboardReturn {
  /** Main keyboard event handler - attach to container's onKeyDown */
  handleKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook for grid keyboard handling.
 *
 * Provides a unified handleKeyDown function that:
 * 1. Handles special modes (ScrollLock, Format Painter)
 * 2. Delegates to KeyboardCoordinator for all registry-based shortcuts
 * 3. Falls back to type-to-edit for printable characters
 *
 * @example
 * ```tsx
 * function Grid() {
 * const activeSheetId = useActiveSheetId;
 * const keyboard = useGridKeyboard({ activeSheetId });
 *
 * return (
 * <div tabIndex={0} onKeyDown={keyboard.handleKeyDown}>
 * <canvas />
 * </div>
 * );
 * }
 * ```
 */
export function useGridKeyboard(options: UseGridKeyboardOptions): UseGridKeyboardReturn {
  const { activeSheetId } = options;
  const readOnly = useReadOnly();

  // Protection alert for blocked edits
  const showProtectionAlert = useUIStore((s) => s.showProtectionAlert);

  // Format Painter state
  const formatPainterActive = useUIStore((s) => s.formatPainter.isActive);
  const dispatch = useDispatch();

  // Scroll Lock state (toggle now handled by KeyboardCoordinator via TOGGLE_SCROLL_LOCK action)
  const scrollLockEnabled = useUIStore((s) => s.scrollLockEnabled);

  // Compose state hooks
  const focus = useFocus();
  // Performance optimization: Only subscribe to activeCell, not full selection state
  // Type-to-edit only needs activeCell position
  const { activeCell } = useActiveCell();

  // Performance optimization: Use coordinator for on-demand editor state reads
  // and useEditorActions for stable action references (no re-renders on editor state changes)
  const coordinator = useCoordinator();
  const editorActions = useEditorActions();

  // Use centralized KeyboardCoordinator
  const keyboard = useKeyboard();

  // Read activeSheetId directly from the store at event time to avoid stale
  // closure issues. React's useCallback closure captures activeSheetId at
  // render time, but sheet tab clicks update Zustand synchronously before
  // React has re-rendered — so the closure can lag by one interaction.
  const uiStoreApi = useUIStoreApi();

  // ============================================================================
  // Main Keyboard Handler
  // ============================================================================

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (!isKeyboardEventFromGrid(e)) {
        return;
      }

      // ========================================================================
      // Special Mode Handling (before KeyboardCoordinator)
      // ========================================================================

      // Format Painter ESC handling
      if (e.key === 'Escape' && formatPainterActive) {
        e.preventDefault();
        dispatch('STOP_FORMAT_PAINTER');
        return;
      }

      // ========================================================================
      // KeyboardCoordinator - Single Source of Truth for Shortcuts
      // ========================================================================

      // If the event was already handled (e.g., by InlineCellEditor's autocomplete
      // Tab handler), don't let the KeyboardCoordinator process it again.
      if (e.defaultPrevented) {
        return;
      }

      if (keyboard.isReady) {
        keyboard.handleKeyDown(e);
        if (e.defaultPrevented) {
          return;
        }
      }

      // ========================================================================
      // Early Exit Conditions
      // ========================================================================

      // If editing, let editor handle remaining keys (typing flows to text input)
      // Performance: On-demand read via coordinator instead of subscribing to editor state
      const editorSnapshot = coordinator.grid.getEditorSnapshot();
      if (editorSnapshot.isEditing) {
        return;
      }

      // If focus is not on grid (dialog open, etc.), don't handle
      if (!focus.shouldGridHandle()) {
        return;
      }

      // Scroll Lock Arrow Key Handling
      // When scroll lock is enabled, arrow keys scroll viewport without moving selection
      if (
        scrollLockEnabled &&
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)
      ) {
        e.preventDefault();
        // TODO: Implement actual scroll-by-cell using inputCoordinator.scrollBy()
        return;
      }

      // ========================================================================
      // Type-to-Edit Fallback (not a shortcut - triggered by printable chars)
      // ========================================================================

      // Read-only mode: block type-to-edit entirely
      if (readOnly) return;

      // Read activeSheetId from store at event time, not from stale closure.
      const currentActiveSheetId = uiStoreApi.getState().activeSheetId as string;
      handleTypeToEdit(
        e,
        activeCell,
        editorActions.startEditing,
        toSheetId(currentActiveSheetId),
        showProtectionAlert,
      );
    },
    [
      focus,
      coordinator,
      editorActions.startEditing,
      keyboard,
      activeCell,
      uiStoreApi,
      showProtectionAlert,
      formatPainterActive,
      dispatch,
      scrollLockEnabled,
      readOnly,
    ],
  );

  return useMemo(() => ({ handleKeyDown }), [handleKeyDown]);
}

function isKeyboardEventFromGrid(e: React.KeyboardEvent<HTMLElement>): boolean {
  const { currentTarget, target } = e;
  const targetWindow = currentTarget.ownerDocument.defaultView;
  const nodeCtor = targetWindow?.Node ?? (typeof Node === 'undefined' ? undefined : Node);

  if (!nodeCtor || !(target instanceof nodeCtor)) {
    return false;
  }

  return currentTarget.contains(target);
}

// =============================================================================
// Type-to-Edit Handler
// =============================================================================

/**
 * Handle type-to-edit: printable characters start editing the active cell.
 *
 * This is NOT a keyboard shortcut - it's a fallback behavior for any
 * printable character that wasn't handled by the KeyboardCoordinator.
 *
 * Typing starts in Enter Mode (arrows commit and move, or insert formula refs).
 *
 * Performance: Takes startEditing action directly instead of full editor hook
 * to avoid subscribing to editor state changes.
 */
function handleTypeToEdit(
  e: React.KeyboardEvent<HTMLElement>,
  activeCell: { row: number; col: number },
  startEditing: (
    cell: { row: number; col: number },
    sheetId: SheetId,
    initialValue?: string,
    entryMode?: 'typing' | 'F2' | 'doubleClick' | 'formulaBar',
  ) => Promise<MutationResult>,
  activeSheetId: SheetId,
  showProtectionAlert?: (message?: string) => void,
): void {
  // IME composition guard - prevent type-to-edit during IME composition
  // keyCode 229 is the "Process" key - indicates IME processing
  if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) {
    return; // Let browser/IME handle the event
  }

  // Check if this is a printable character that should start editing:
  // - Single character key (not special keys like Shift, Control, etc.)
  // - No Ctrl/Cmd modifier (those are shortcuts, handled by coordinator)
  // - No Alt modifier (those are often special characters or shortcuts)
  const isPrintableChar = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;

  if (isPrintableChar) {
    e.preventDefault();

    // Start editing with the typed character as initial value
    // This replaces cell content (like Excel) rather than appending
    // Typing starts in Enter Mode (arrows commit and move)
    //
    // / O-A: route the fire-and-forget chain through
    // `withHandlerErrors` so a thrown error from the editor / kernel surfaces
    // in `__dt.recentErrors` as 'handler:EDIT_CELL' rather than dying silent
    // at the React boundary. Re-throw is fine — the global
    // `unhandledrejection` listener will then capture it too (no swallow).
    void withHandlerErrors('EDIT_CELL', () =>
      startEditing(
        activeCell,
        activeSheetId,
        e.key,
        'typing', // Enter Mode: arrows commit and move (or insert formula refs)
      ).then((result) => {
        // Show protection alert if edit was blocked
        if (!result.success && result.reason?.includes('protected') && showProtectionAlert) {
          showProtectionAlert(result.reason);
        }
      }),
    );
  }
}
