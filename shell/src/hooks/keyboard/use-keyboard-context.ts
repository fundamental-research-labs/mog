/**
 * useKeyboardContext - Derives the current ShortcutContext from application state.
 *
 * This hook encapsulates the context hierarchy logic that determines which
 * keyboard shortcuts are active based on the current application state.
 *
 * CONTEXT HIERARCHY (highest priority first):
 * 1. dialog - Modal dialog is open
 * 2. menu - Dropdown menu is open
 * 3. objectSelected - A floating object (chart/image) is selected
 * 4. formulaEditMode - Formula bar in edit mode (arrows move cursor)
 * 5. formulaEnterMode - Formula bar in enter mode (arrows insert refs)
 * 6. editMode - Cell editor in edit mode (arrows move cursor)
 * 7. enterMode - Cell editor in enter mode (arrows commit and move)
 * 8. grid - Default grid navigation mode
 *
 * The key distinction between "enter mode" and "edit mode":
 * - Enter Mode: Started by typing or clicking formula bar. Arrow keys
 *   commit the edit and move selection (or insert formula refs in formulas).
 * - Edit Mode: Started by F2 or double-click. Arrow keys move the cursor
 *   within the cell content.
 *
 * @example
 * ```tsx
 * function SpreadsheetGrid() {
 *   // Get state from your application
 *   const isEditing = editorState.matches('editing');
 *   const isEnterMode = editorState.context.mode === 'enter';
 *   const isFormulaBarFocused = focusState.matches('formulaBar');
 *   const isObjectSelected = objectState.hasSelection();
 *   const isDialogOpen = !!dialogStore.openDialog;
 *   const isMenuOpen = !!menuStore.openMenu;
 *
 *   const context = useKeyboardContext({
 *     isEditing,
 *     isEnterMode,
 *     isFormulaBarFocused,
 *     isObjectSelected,
 *     isDialogOpen,
 *     isMenuOpen
 *   });
 *
 *   // context will be 'grid', 'enterMode', 'editMode', etc.
 *   const { handleKeyDown } = useKeyboard({ context, ... });
 * }
 * ```
 *
 * @module shell/hooks/keyboard/use-keyboard-context
 */

import { useMemo } from 'react';

import type { ShortcutContext } from '@mog-sdk/kernel/keyboard';

// =============================================================================
// Types
// =============================================================================

/**
 * Options for deriving keyboard context from application state.
 */
export interface UseKeyboardContextOptions {
  /**
   * Is a cell being edited (inline editor or formula bar)?
   *
   * This indicates the editor machine is in an editing state.
   */
  isEditing: boolean;

  /**
   * Is the editor in "enter mode"?
   *
   * Enter mode is when:
   * - User started typing a character (type-to-edit)
   * - User clicked the formula bar to start editing
   *
   * In enter mode, arrow keys commit the edit and move selection.
   * For formula editing, arrows insert cell references.
   *
   * @default true (if isEditing is true and not specified)
   */
  isEnterMode?: boolean;

  /**
   * Is the formula bar focused?
   *
   * When the formula bar has focus (as opposed to inline editor),
   * some shortcuts may behave differently. Formula-specific
   * shortcuts are active in this context.
   */
  isFormulaBarFocused?: boolean;

  /**
   * Is a floating object (chart, image, shape) selected?
   *
   * When a floating object is selected, object-specific shortcuts
   * become active (Delete to remove, arrow keys to nudge, etc.).
   */
  isObjectSelected?: boolean;

  /**
   * Is a modal dialog open?
   *
   * Dialogs have highest priority - most shortcuts are blocked
   * when a dialog is open. Only dialog-specific shortcuts work.
   */
  isDialogOpen?: boolean;

  /**
   * Is a dropdown menu open?
   *
   * Menus have high priority - arrow keys navigate the menu,
   * Enter selects, Escape closes.
   */
  isMenuOpen?: boolean;

  /**
   * Is the user editing text within an object?
   *
   * For example, editing the title of a chart or text in a shape.
   * This puts us in 'editing' context even though an object is selected.
   */
  isEditingObjectText?: boolean;
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Derives the current ShortcutContext from application state.
 *
 * This hook encapsulates the context hierarchy logic. The returned context
 * determines which shortcuts are active in the useKeyboard hook.
 *
 * @param options - Application state indicators
 * @returns The current ShortcutContext
 */
export function useKeyboardContext(options: UseKeyboardContextOptions): ShortcutContext {
  const {
    isEditing,
    isEnterMode = true, // Default to enter mode if editing
    isFormulaBarFocused = false,
    isObjectSelected = false,
    isDialogOpen = false,
    isMenuOpen = false,
    isEditingObjectText = false,
  } = options;

  return useMemo(() => {
    // ========================================================================
    // Priority 1: Dialog (highest priority)
    // ========================================================================

    if (isDialogOpen) {
      return 'dialog';
    }

    // ========================================================================
    // Priority 2: Menu
    // ========================================================================

    if (isMenuOpen) {
      return 'menu';
    }

    // ========================================================================
    // Priority 3: Object Selected (but not editing text in object)
    // ========================================================================

    if (isObjectSelected && !isEditingObjectText) {
      return 'objectSelected';
    }

    // ========================================================================
    // Priority 4: Editing (cell or object text)
    // ========================================================================

    if (isEditing || isEditingObjectText) {
      // Distinguish between formula bar and inline editing
      if (isFormulaBarFocused) {
        // Formula bar editing - distinguish enter vs edit mode
        return isEnterMode ? 'formulaEnterMode' : 'formulaEditMode';
      }

      // Inline cell editing - distinguish enter vs edit mode
      return isEnterMode ? 'enterMode' : 'editMode';
    }

    // ========================================================================
    // Priority 5: Grid (default)
    // ========================================================================

    return 'grid';
  }, [
    isDialogOpen,
    isMenuOpen,
    isObjectSelected,
    isEditingObjectText,
    isEditing,
    isFormulaBarFocused,
    isEnterMode,
  ]);
}

// =============================================================================
// Helper: Context Hierarchy Checks
// =============================================================================

/**
 * Check if a context is an "editing" context.
 *
 * Editing contexts are where text input is happening:
 * - enterMode
 * - editMode
 * - formulaEnterMode
 * - formulaEditMode
 *
 * @param context - The context to check
 * @returns true if this is an editing context
 */
export function isEditingContext(context: ShortcutContext): boolean {
  return ['enterMode', 'editMode', 'formulaEnterMode', 'formulaEditMode', 'editing'].includes(
    context,
  );
}

/**
 * Check if a context is a "formula editing" context.
 *
 * Formula editing contexts have formula-specific behavior:
 * - Arrow keys insert cell references (in enter mode)
 * - Formula autocomplete is active
 *
 * @param context - The context to check
 * @returns true if this is a formula editing context
 */
export function isFormulaEditingContext(context: ShortcutContext): boolean {
  return ['formulaEnterMode', 'formulaEditMode', 'formulaEditing'].includes(context);
}

/**
 * Check if a context supports type-to-edit.
 *
 * Type-to-edit starts editing when user presses a printable character.
 * This is only active in 'grid' context.
 *
 * @param context - The context to check
 * @returns true if type-to-edit should be active
 */
export function supportsTypeToEdit(context: ShortcutContext): boolean {
  return context === 'grid';
}

/**
 * Check if a context blocks most shortcuts.
 *
 * Some contexts (dialog, menu) block most shortcuts.
 *
 * @param context - The context to check
 * @returns true if most shortcuts should be blocked
 */
export function isBlockingContext(context: ShortcutContext): boolean {
  return context === 'dialog' || context === 'menu';
}
