/**
 * Focus Actor Selectors
 *
 * Pure functions that extract data from focus state.
 * Moved from contracts to kernel (contracts holds types only).
 *
 * @module @mog-sdk/kernel/selectors
 */

import type { FocusState } from '@mog-sdk/contracts/actors/focus';

export { type FocusState } from '@mog-sdk/contracts/actors/focus';

/**
 * Focus selectors - pure functions that extract data from state.
 *
 * These are the SINGLE SOURCE OF TRUTH for extraction logic.
 * All other access patterns (accessors, snapshots, hooks) use these.
 */
export const focusSelectors = {
  // ===========================================================================
  // Value Selectors (context fields)
  // ===========================================================================

  /** Get the full focus layer stack */
  stack: (state: FocusState) => state.context.stack,

  /** Get the previous grid cell (for restoration) */
  previousGridCell: (state: FocusState) => state.context.previousGridCell,

  // ===========================================================================
  // Derived Selectors (computed from stack)
  // ===========================================================================

  /** Get the current (top) focus layer */
  currentLayer: (state: FocusState) => {
    const stack = state.context.stack;
    return stack[stack.length - 1];
  },

  /** Get the current focus layer type (state name) */
  state: (state: FocusState) => {
    const stack = state.context.stack;
    return stack[stack.length - 1].type;
  },

  /** Get the stack depth */
  stackDepth: (state: FocusState): number => state.context.stack.length,

  // ===========================================================================
  // State Matching Selectors (state.matches())
  // ===========================================================================

  /** Check if grid has focus */
  isGridFocused: (state: FocusState): boolean => state.matches('grid'),

  /** Check if editor has focus */
  isEditorFocused: (state: FocusState): boolean => state.matches('editor'),

  /** Check if formula bar has focus */
  isFormulaBarFocused: (state: FocusState): boolean => state.matches('formulaBar'),

  /** Check if a dialog has focus */
  isDialogFocused: (state: FocusState): boolean => state.matches('dialog'),

  /** Check if command palette has focus */
  isCommandPaletteFocused: (state: FocusState): boolean => state.matches('commandPalette'),

  /** Check if context menu has focus */
  isContextMenuFocused: (state: FocusState): boolean => state.matches('contextMenu'),

  /** Check if formula picker has focus */
  isFormulaPickerFocused: (state: FocusState): boolean => state.matches('formulaPicker'),

  /** Check if sheet tabs have focus */
  isSheetTabsFocused: (state: FocusState): boolean => state.matches('sheetTabs'),

  // ===========================================================================
  // Derived Boolean Selectors
  // ===========================================================================

  /** Check if grid should handle keyboard events (only in grid state) */
  shouldGridHandle: (state: FocusState): boolean => state.matches('grid'),

  /** Check if focus is in an overlay (not grid or editor) */
  isInOverlay: (state: FocusState): boolean => {
    const type = focusSelectors.state(state);
    return type !== 'grid' && type !== 'editor';
  },

  /** Check if focus is in any editing state (editor or formulaBar) */
  isEditing: (state: FocusState): boolean => state.matches('editor') || state.matches('formulaBar'),

  /** Check if focus is in a modal state (dialog, commandPalette, contextMenu) */
  isInModal: (state: FocusState): boolean =>
    state.matches('dialog') ||
    state.matches('commandPalette') ||
    state.matches('contextMenu') ||
    state.matches('formulaPicker'),
};
