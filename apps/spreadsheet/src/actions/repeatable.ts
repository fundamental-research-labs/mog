/**
 * Repeatable Actions Set
 *
 * Defines which action types can be repeated with F4.
 * Used by dispatcher to track repeatable actions in UIStore.
 *
 * What is "Repeatable"?
 * - Formatting changes (bold, font size, borders, colors)
 * - Structure operations (insert row, delete column)
 * - Fill operations (fill down, fill right)
 * - Sort operations
 * - Clear operations
 *
 * What is NOT repeatable?
 * - Navigation (MOVE_*, PAGE_*, TAB_*, etc.)
 * - Selection (SELECT_*, EXTEND_*, etc.)
 * - Clipboard (COPY, CUT - but PASTE is repeatable)
 * - Undo/Redo (UNDO, REDO)
 * - UI actions (dialogs, view toggles)
 * - Comments (INSERT_COMMENT, etc.)
 * - REPEAT_LAST_ACTION itself (would cause infinite recursion)
 *
 */

import type { ActionType } from '@mog-sdk/contracts/actions';

/**
 * Set of action types that can be repeated with F4.
 * This is the authoritative list - add new repeatable actions here.
 */
export const REPEATABLE_ACTIONS = new Set<ActionType>([
  // ===========================================================================
  // Font Formatting
  // ===========================================================================
  'TOGGLE_BOLD',
  'TOGGLE_ITALIC',
  'TOGGLE_UNDERLINE',
  'TOGGLE_STRIKETHROUGH',
  'TOGGLE_WRAP_TEXT',
  'SET_FONT_SIZE',
  'SET_FONT_FAMILY',
  'INCREASE_FONT_SIZE',
  'DECREASE_FONT_SIZE',
  'APPLY_FONT_FORMAT',

  // ===========================================================================
  // Alignment Formatting
  // ===========================================================================
  'APPLY_ALIGNMENT_FORMAT',

  // ===========================================================================
  // Fill/Background Formatting
  // ===========================================================================
  'APPLY_FILL_FORMAT',

  // ===========================================================================
  // Number Formats
  // ===========================================================================
  'FORMAT_GENERAL',
  'FORMAT_NUMBER',
  'FORMAT_TIME',
  'FORMAT_DATE',
  'FORMAT_CURRENCY',
  'FORMAT_PERCENTAGE',
  'FORMAT_SCIENTIFIC',
  'FORMAT_COMMA',
  'APPLY_NUMBER_FORMAT',
  'INCREASE_DECIMALS',
  'DECREASE_DECIMALS',

  // ===========================================================================
  // Border Formatting
  // ===========================================================================
  'APPLY_BORDERS',
  'APPLY_OUTLINE_BORDER',
  'REMOVE_BORDERS',

  // ===========================================================================
  // Cell Structure
  // ===========================================================================
  'INSERT_TABLE',
  'TOGGLE_MERGE',

  // ===========================================================================
  // Row/Column Structure
  // ===========================================================================
  'INSERT_ROW_ABOVE',
  'INSERT_ROW_BELOW',
  'INSERT_COLUMN_LEFT',
  'INSERT_COLUMN_RIGHT',
  'DELETE_ROWS',
  'DELETE_COLUMNS',
  'HIDE_ROW',
  'UNHIDE_ROW',
  'HIDE_COLUMN',
  'UNHIDE_COLUMN',

  // ===========================================================================
  // Fill Operations
  // ===========================================================================
  'FILL_DOWN',
  'FILL_RIGHT',
  'FILL_UP',
  'FILL_LEFT',

  // ===========================================================================
  // Sort Operations
  // ===========================================================================
  'SORT_ASCENDING',
  'SORT_DESCENDING',

  // ===========================================================================
  // Clear Operations (content modification)
  // ===========================================================================
  'CLEAR_CONTENTS',
  'CLEAR_ALL',
  'CLEAR_FORMATS',
  'CLEAR_COMMENTS',

  // ===========================================================================
  // Paste (can be repeated to paste again)
  // ===========================================================================
  'PASTE',
  'PASTE_VALUES',
  'PASTE_FORMULAS',
  'PASTE_FORMATTING',
  'PASTE_TRANSPOSE',
]);

// String-indexed lookup for dispatch() which accepts arbitrary strings
const REPEATABLE_ACTIONS_SET: ReadonlySet<string> = REPEATABLE_ACTIONS;

/**
 * Check if an action type is repeatable.
 * Accepts string for use from dispatch() which accepts arbitrary strings.
 */
export function isRepeatableAction(actionType: string): boolean {
  return REPEATABLE_ACTIONS_SET.has(actionType);
}
