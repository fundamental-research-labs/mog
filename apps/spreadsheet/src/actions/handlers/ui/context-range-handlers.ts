/**
 * Context Menu and Range Selection Handlers
 *
 * Pure handler functions for context menu and range selection mode actions.
 * These handlers are called by the unified action dispatcher.
 *
 * This file handles:
 * - Context menu invocation via keyboard (Shift+F10 / Menu key)
 * - Range selection mode for CollapsibleRangeInput dialogs
 *
 */

import type { ActionDependencies, ActionHandler, ActionResult } from '@mog-sdk/contracts/actions';
import type { CellRange } from '@mog-sdk/contracts/core';

import { getUIStore, handled, notHandled } from '../handler-utils';

// =============================================================================
// Type Helpers
// =============================================================================

type RangeSelectionInputMode = 'range' | 'single-cell';

/**
 * Get selection context (active cell and ranges) using the Actor Access Layer.
 *
 * MIGRATION: Uses deps.accessors.selection instead of direct actor access.
 */
function getSelectionContext(deps: ActionDependencies): {
  activeCell: { row: number; col: number } | null;
  ranges: CellRange[];
} {
  if (!deps.accessors?.selection) {
    return { activeCell: null, ranges: [] };
  }
  return {
    activeCell: deps.accessors.selection.getActiveCell() ?? null,
    ranges: deps.accessors.selection.getRanges() ?? [],
  };
}

// =============================================================================
// Context Menu Actions (Context Menus)
// =============================================================================

/**
 * Invoke context menu via keyboard (Shift+F10 or Menu key).
 *
 * Context Menus - Item 4.5
 *
 * Calculates the position from the active cell and opens the context menu.
 * This is a critical accessibility requirement (WCAG 2.1 AA).
 */
export const INVOKE_CONTEXT_MENU: ActionHandler = (deps): ActionResult => {
  const { activeCell } = getSelectionContext(deps);

  if (!activeCell) {
    return notHandled('disabled');
  }

  // Dispatch a synthetic contextmenu event via the typed callback.
  // Radix ContextMenu is uncontrolled — it only opens in response to native
  // contextmenu DOM events on its trigger, ignoring any `open` prop.
  // The callback encapsulates DOM access (grid container element) so handlers
  // never need raw HTMLElement references. Called without arguments so the
  // implementation computes a default position inside the cells area.
  if (deps.dispatchContextMenu) {
    const dispatched = deps.dispatchContextMenu();
    if (dispatched) {
      return handled();
    }
  }

  // Fallback: set UIStore directly (menu won't be visible via Radix but won't crash)
  const uiStore = getUIStore(deps).getState();
  uiStore.openContextMenu({
    x: 200,
    y: 200,
    target: 'cell',
    targetRow: activeCell.row,
    targetCol: activeCell.col,
  });
  return handled();
};

// =============================================================================
// Range Selection Mode Actions
// =============================================================================

/**
 * Start range selection mode (for CollapsibleRangeInput).
 *
 * This action type is defined for consistency but range selection is primarily
 * handled through direct UIStore method calls from CollapsibleRangeInput.
 * The action exists for cases where dispatch is preferred over direct store access.
 */
export const START_RANGE_SELECTION_MODE: ActionHandler = (
  deps,
  payload?: {
    dialogId: string;
    inputId: string;
    initialRange: string;
    allowMultipleRanges?: boolean;
    inputMode?: RangeSelectionInputMode;
    onComplete?: (range: string) => void;
    onCancel?: () => void;
  },
): ActionResult => {
  if (!payload?.dialogId || !payload?.inputId) {
    return notHandled('disabled');
  }

  const uiStore = getUIStore(deps);
  uiStore
    .getState()
    .startRangeSelectionMode(payload.dialogId, payload.inputId, payload.initialRange, {
      allowMultipleRanges: payload.allowMultipleRanges,
      inputMode: payload.inputMode,
      onComplete: payload.onComplete,
      onCancel: payload.onCancel,
    });

  return handled();
};

/**
 * Update range selection during selection mode.
 *
 * Updates the current range value while in range selection mode.
 * Typically called by selection coordination when selection changes.
 */
export const UPDATE_RANGE_SELECTION: ActionHandler = (
  deps,
  payload?: { range: string },
): ActionResult => {
  if (!payload?.range === undefined) {
    return notHandled('disabled');
  }

  const uiStore = getUIStore(deps);
  uiStore.getState().updateRangeSelection(payload?.range ?? '');

  return handled();
};

/**
 * Complete range selection mode (confirm selection).
 *
 * Confirms the current range selection and restores the dialog.
 */
export const COMPLETE_RANGE_SELECTION: ActionHandler = (deps): ActionResult => {
  const uiStore = getUIStore(deps);
  uiStore.getState().completeRangeSelection();

  return handled();
};

/**
 * Cancel range selection mode (discard selection).
 *
 * Cancels the range selection and restores the dialog with original value.
 */
export const CANCEL_RANGE_SELECTION: ActionHandler = (deps): ActionResult => {
  const uiStore = getUIStore(deps);
  uiStore.getState().cancelRangeSelection();

  return handled();
};
