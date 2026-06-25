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

import { useCallback, useMemo, useRef } from 'react';

import { type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { MutationResult } from '@mog-sdk/contracts/protection';

import { withHandlerErrors } from '../../devtools/handler-error-boundary';
import { useReadOnly, useUIStore, useUIStoreApi } from '../../infra/context';
import { useEditorActions } from '../editing/use-editor-actions';
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
  const pendingTypeToEditRef = useRef<PendingTypeToEdit | null>(null);
  const pendingTypeToEditSequenceRef = useRef(0);

  // Protection alert for blocked edits
  const showProtectionAlert = useUIStore((s) => s.showProtectionAlert);

  // Format Painter state
  const formatPainterActive = useUIStore((s) => s.formatPainter.isActive);
  const dispatch = useDispatch();

  // Scroll Lock state (toggle now handled by KeyboardCoordinator via TOGGLE_SCROLL_LOCK action)
  const scrollLockEnabled = useUIStore((s) => s.scrollLockEnabled);

  // Compose state hooks
  const focus = useFocus();

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

      const editorSnapshot = coordinator.grid.getEditorSnapshot();
      if (
        handlePendingTypeToEditKey(
          e,
          pendingTypeToEditRef,
          editorSnapshot,
          () => coordinator.grid.getEditorSnapshot(),
          editorActions.input,
          editorActions.commitWithKey,
        )
      ) {
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
      const currentActiveCell =
        coordinator.grid.access.actors.selection.getSnapshot().context.activeCell;
      handleTypeToEdit(
        e,
        currentActiveCell,
        editorActions.startEditing,
        toSheetId(currentActiveSheetId),
        showProtectionAlert,
        pendingTypeToEditRef,
        () => ++pendingTypeToEditSequenceRef.current,
      );
    },
    [
      focus,
      coordinator,
      editorActions.startEditing,
      keyboard,
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
  pendingTypeToEditRef?: React.MutableRefObject<PendingTypeToEdit | null>,
  nextPendingSequence?: () => number,
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

    const pending = pendingTypeToEditRef?.current;
    if (pending && samePendingTarget(pending, activeSheetId, activeCell)) {
      pending.value += e.key;
      return;
    }

    const sequence = nextPendingSequence?.() ?? 0;
    if (pendingTypeToEditRef) {
      pendingTypeToEditRef.current = {
        cell: { ...activeCell },
        sheetId: activeSheetId,
        value: e.key,
        sequence,
      };
    }

    // Start editing with the typed character as initial value
    // This replaces cell content (like Excel) rather than appending
    // Typing starts in Enter Mode (arrows commit and move)
    //
    // / O-A: route the fire-and-forget chain through
    // `withHandlerErrors` so a thrown error from the editor / kernel surfaces
    // in `__dt.recentErrors` as 'handler:EDIT_CELL' rather than dying silent
    // at the React boundary. Re-throw is fine — the global
    // `unhandledrejection` listener will then capture it too (no swallow).
    const editPromise = withHandlerErrors('EDIT_CELL', () =>
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
        if (!pendingTypeToEditRef) return;
        const current = pendingTypeToEditRef.current;
        if (!current || current.sequence !== sequence) return;
        if (!result.success) {
          pendingTypeToEditRef.current = null;
          return;
        }
        current.ready = true;
      }),
    );
    if (pendingTypeToEditRef?.current?.sequence === sequence) {
      pendingTypeToEditRef.current.startPromise = editPromise
        .catch(() => undefined)
        .then(() => undefined);
    }
    void editPromise;
  }
}

type GridEditorSnapshotForPending = {
  readonly isEditing: boolean;
  readonly editingCell: { readonly row: number; readonly col: number } | null;
  readonly sheetId: string | null;
};

type PendingTypeToEdit = {
  readonly cell: { readonly row: number; readonly col: number };
  readonly sheetId: SheetId;
  value: string;
  readonly sequence: number;
  ready?: boolean;
  startPromise?: Promise<void>;
};

function handlePendingTypeToEditKey(
  e: React.KeyboardEvent<HTMLElement>,
  pendingTypeToEditRef: React.MutableRefObject<PendingTypeToEdit | null>,
  snapshot: GridEditorSnapshotForPending,
  readEditorSnapshot: () => GridEditorSnapshotForPending,
  input: (value: string, cursorPosition: number) => void,
  commitWithKey: (commitKey: 'enter' | 'shift-enter' | 'tab' | 'shift-tab') => void,
): boolean {
  const pending = pendingTypeToEditRef.current;
  if (!pending) return false;

  if (isSpreadsheetEditorEventTarget(e)) {
    pendingTypeToEditRef.current = null;
    return false;
  }

  if (pending.ready && !matchesPendingEditor(pending, snapshot)) {
    pendingTypeToEditRef.current = null;
    return false;
  }

  if (isPrintableTypeToEditKey(e)) {
    e.preventDefault();
    pending.value += e.key;
    void (pending.startPromise ?? Promise.resolve()).then(() => {
      mirrorPendingTypeToEdit(pendingTypeToEditRef, readEditorSnapshot(), input);
    });
    return true;
  }

  const commitKey = pendingCommitKey(e);
  if (!commitKey) return false;

  e.preventDefault();
  void (pending.startPromise ?? Promise.resolve()).then(() => {
    const snapshot = readEditorSnapshot();
    if (flushPendingTypeToEdit(pendingTypeToEditRef, snapshot, input)) {
      commitWithKey(commitKey);
    }
  });
  return true;
}

function isPrintableTypeToEditKey(e: React.KeyboardEvent<HTMLElement>): boolean {
  return (
    e.key.length === 1 &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !e.nativeEvent.isComposing &&
    e.nativeEvent.keyCode !== 229
  );
}

function isSpreadsheetEditorEventTarget(e: React.KeyboardEvent<HTMLElement>): boolean {
  const target = e.target;
  const targetWindow = e.currentTarget.ownerDocument.defaultView;
  const elementCtor =
    targetWindow?.HTMLElement ?? (typeof HTMLElement === 'undefined' ? undefined : HTMLElement);
  if (!elementCtor || !(target instanceof elementCtor)) return false;
  return Boolean(
    target.closest('[data-testid="inline-cell-editor"], [data-testid="formula-bar-input"]'),
  );
}

function pendingCommitKey(
  e: React.KeyboardEvent<HTMLElement>,
): 'enter' | 'shift-enter' | 'tab' | 'shift-tab' | null {
  if (e.key === 'Enter') return e.shiftKey ? 'shift-enter' : 'enter';
  if (e.key === 'Tab') return e.shiftKey ? 'shift-tab' : 'tab';
  return null;
}

function flushPendingTypeToEdit(
  pendingTypeToEditRef: React.MutableRefObject<PendingTypeToEdit | null>,
  snapshot: GridEditorSnapshotForPending,
  input: (value: string, cursorPosition: number) => void,
): boolean {
  const pending = pendingTypeToEditRef.current;
  if (!pending) return false;
  if (!matchesPendingEditor(pending, snapshot)) return false;

  pendingTypeToEditRef.current = null;
  input(pending.value, pending.value.length);
  return true;
}

function mirrorPendingTypeToEdit(
  pendingTypeToEditRef: React.MutableRefObject<PendingTypeToEdit | null>,
  snapshot: GridEditorSnapshotForPending,
  input: (value: string, cursorPosition: number) => void,
): void {
  const pending = pendingTypeToEditRef.current;
  if (!pending) return;
  if (!matchesPendingEditor(pending, snapshot)) return;

  input(pending.value, pending.value.length);
}

function matchesPendingEditor(
  pending: PendingTypeToEdit,
  snapshot: GridEditorSnapshotForPending,
): boolean {
  return (
    snapshot.isEditing &&
    snapshot.sheetId === pending.sheetId &&
    snapshot.editingCell?.row === pending.cell.row &&
    snapshot.editingCell.col === pending.cell.col
  );
}

function samePendingTarget(
  pending: PendingTypeToEdit,
  sheetId: SheetId,
  cell: { readonly row: number; readonly col: number },
): boolean {
  return (
    pending.sheetId === sheetId && pending.cell.row === cell.row && pending.cell.col === cell.col
  );
}
