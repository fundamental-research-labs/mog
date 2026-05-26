/**
 * Formula Bar Context Menu Actions Hook
 *
 * Provides action handlers for the formula bar context menu.
 * Handles text clipboard operations (Cut/Copy/Paste/Select All) and Insert Function.
 *
 * Architecture:
 * - Text operations: Use native browser APIs directly (intentional exception to dispatch rule)
 * because these operate on the input element's text selection, not cell data
 * - Insert Function: Uses dispatch('OPEN_INSERT_FUNCTION_DIALOG', deps) via unified action system
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Unified Action System
 */

import { useCallback } from 'react';

import { dispatch } from '../../actions';
import { useActionDependencies } from './use-action-dependencies';

// =============================================================================
// Types
// =============================================================================

export interface UseFormulaBarContextMenuActionsReturn {
  // Text editing actions
  cut: () => void;
  copy: () => void;
  paste: () => void;
  selectAll: () => void;

  // Insert Function action
  insertFunction: () => void;

  // State for enabling/disabling menu items
  hasSelection: boolean;
  canPaste: boolean;
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook for formula bar context menu actions.
 *
 * Text operations (Cut/Copy/Paste/Select All) use native browser APIs directly.
 * This is an intentional exception to the unified action system because these
 * operations work on the input element's text content, not spreadsheet cell data.
 *
 * Insert Function uses the unified action system via dispatch().
 *
 * @param inputRef - Reference to the formula bar input element
 *
 * @example
 * ```tsx
 * function FormulaBarContainer() {
 * const inputRef = useRef<HTMLInputElement>(null);
 * const actions = useFormulaBarContextMenuActions(inputRef);
 *
 * return (
 * <FormulaBarContextMenu
 * onCut={actions.cut}
 * onCopy={actions.copy}
 * onPaste={actions.paste}
 * onSelectAll={actions.selectAll}
 * onInsertFunction={actions.insertFunction}
 * hasSelection={actions.hasSelection}
 * canPaste={actions.canPaste}
 * />
 * );
 * }
 * ```
 */
export function useFormulaBarContextMenuActions(
  inputRef: React.RefObject<HTMLInputElement | null>,
): UseFormulaBarContextMenuActionsReturn {
  const deps = useActionDependencies();

  // =============================================================================
  // Text Editing Actions (Native Browser APIs)
  // =============================================================================

  /**
   * Cut selected text from input.
   * Uses native browser API (intentional exception to dispatch rule).
   */
  const cut = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;

    // Check if there's a selection
    if (input.selectionStart !== input.selectionEnd) {
      // Use modern Clipboard API if available
      if (navigator.clipboard && window.isSecureContext) {
        const selectedText = input.value.substring(input.selectionStart!, input.selectionEnd!);
        navigator.clipboard.writeText(selectedText).then(() => {
          // Delete the selected text
          const before = input.value.substring(0, input.selectionStart!);
          const after = input.value.substring(input.selectionEnd!);
          input.value = before + after;
          // Trigger input event so React's onChange fires
          input.dispatchEvent(new Event('input', { bubbles: true }));
          // Set cursor position
          input.setSelectionRange(before.length, before.length);
        });
      } else {
        // Fallback to document.execCommand (deprecated but widely supported)
        document.execCommand('cut');
      }
    }
  }, [inputRef]);

  /**
   * Copy selected text from input.
   * Uses native browser API (intentional exception to dispatch rule).
   */
  const copy = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;

    // Check if there's a selection
    if (input.selectionStart !== input.selectionEnd) {
      // Use modern Clipboard API if available
      if (navigator.clipboard && window.isSecureContext) {
        const selectedText = input.value.substring(input.selectionStart!, input.selectionEnd!);
        navigator.clipboard.writeText(selectedText);
      } else {
        // Fallback to document.execCommand (deprecated but widely supported)
        document.execCommand('copy');
      }
    }
  }, [inputRef]);

  /**
   * Paste text into input at cursor position.
   * Uses native browser API (intentional exception to dispatch rule).
   */
  const paste = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;

    // Use modern Clipboard API if available
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.readText().then((text) => {
        // Insert text at cursor position
        const start = input.selectionStart!;
        const end = input.selectionEnd!;
        const before = input.value.substring(0, start);
        const after = input.value.substring(end);
        input.value = before + text + after;
        // Trigger input event so React's onChange fires
        input.dispatchEvent(new Event('input', { bubbles: true }));
        // Set cursor position after pasted text
        input.setSelectionRange(start + text.length, start + text.length);
      });
    } else {
      // Fallback to document.execCommand (deprecated but widely supported)
      document.execCommand('paste');
    }
  }, [inputRef]);

  /**
   * Select all text in input.
   * Uses native browser API (intentional exception to dispatch rule).
   */
  const selectAll = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    input.select();
  }, [inputRef]);

  // =============================================================================
  // Insert Function Action (Unified Action System)
  // =============================================================================

  /**
   * Open Insert Function dialog.
   * Uses unified action system via dispatch() (correct approach per architecture).
   */
  const insertFunction = useCallback(() => {
    dispatch('OPEN_INSERT_FUNCTION_DIALOG', deps);
  }, [deps]);

  // =============================================================================
  // Menu Item State
  // =============================================================================

  /**
   * Check if there's text selected in the input.
   * Used to enable/disable Cut and Copy menu items.
   *
   * NOTE: This is computed as a getter function that checks the current selection
   * at the time it's called (i.e., when the context menu opens), rather than via
   * useMemo which would never recompute since inputRef is a stable reference.
   */
  const getHasSelection = useCallback(() => {
    const input = inputRef.current;
    if (!input) return false;
    return input.selectionStart !== input.selectionEnd;
  }, [inputRef]);

  // Compute hasSelection at hook call time (when context menu is about to open)
  // This ensures the value is fresh each time the menu renders
  const hasSelection = getHasSelection();

  /**
   * Check if clipboard paste is available.
   * For simplicity, we always enable Paste. The browser will handle permission prompts.
   */
  const canPaste = true;

  // =============================================================================
  // Return
  // =============================================================================

  return {
    cut,
    copy,
    paste,
    selectAll,
    insertFunction,
    hasSelection,
    canPaste,
  };
}
