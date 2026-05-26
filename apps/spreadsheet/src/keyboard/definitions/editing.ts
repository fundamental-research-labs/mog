/**
 * Editing Keyboard Shortcuts (Unified v2)
 *
 * Physical-key-based shortcuts for entering and modifying cell data:
 * - Enter/Exit edit mode (F2)
 * - Commit/Cancel entry
 * - Delete/Clear
 * - Insert/Delete cells (THE CORE BUG FIX: Ctrl++ now works!)
 * - Fill operations
 * - Undo/Redo
 * - Special entries (date, time)
 * - Enter Mode vs Edit Mode arrow handling
 * - Ink/Drawing tools
 *
 * CRITICAL: This file contains the fix for the Ctrl++ bug:
 * - Insert cells: Ctrl+Shift+= (physical key 'Equal' with 'shift')
 * - Delete cells: Ctrl+- (physical key 'Minus')
 *
 * Total: 55 shortcuts
 */

import type { KeyboardShortcut } from '../types';
import {
  altBinding,
  binding,
  crossPlatformBinding,
  macSpecificBinding,
  universalBinding,
} from '@mog-sdk/kernel/keyboard';

export const EDITING_SHORTCUTS: KeyboardShortcut[] = [
  // ===========================================================================
  // Enter/Exit Edit Mode
  // ===========================================================================

  {
    id: 'edit-cell',
    bindings: universalBinding('F2'),
    description: 'Edit active cell (position cursor at end)',
    action: 'EDIT_CELL',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['grid'],
    muscleMemory: 'essential',
    matchBy: 'code',
  },
  {
    id: 'edit-cell-mac-alt',
    // Mac-only: physical Ctrl+U edits cell (not Cmd+U which is underline).
    // Default binding uses Ctrl+Alt+U to avoid conflict with toggle-underline
    // (Ctrl+U) on Windows/Linux. Only the Mac binding (Ctrl+U) is practically used.
    bindings: macSpecificBinding('KeyU', ['ctrl', 'alt'], 'KeyU', ['ctrl']),
    description: 'Edit active cell (Mac alternative)',
    action: 'EDIT_CELL',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['grid'],
    muscleMemory: 'essential',
    matchBy: 'key',
    expectedCharacter: 'u',
    notes:
      'Mac-only: Ctrl+U (physical Control key, not Cmd) edits cell. On Windows/Linux, Ctrl+U is toggle-underline, so the default binding is Ctrl+Alt+U to avoid conflict.',
  },

  // ===========================================================================
  // Commit/Cancel Entry
  // ===========================================================================

  {
    id: 'commit-enter',
    bindings: universalBinding('Enter'),
    description: 'Complete entry and move down (Enter-key aware)',
    action: 'COMMIT_ENTER',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['editing', 'formulaEnterMode', 'formulaEditMode'],
    muscleMemory: 'essential',
    matchBy: 'code',
  },
  {
    id: 'commit-tab',
    bindings: universalBinding('Tab'),
    description: 'Complete entry and move right (Tab-key aware)',
    action: 'COMMIT_TAB',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['editing', 'formulaEnterMode', 'formulaEditMode'],
    muscleMemory: 'essential',
    matchBy: 'code',
  },
  {
    id: 'commit-shift-tab',
    bindings: universalBinding('Tab', 'shift'),
    description: 'Complete entry and move left (Shift+Tab-key aware)',
    action: 'COMMIT_SHIFT_TAB',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['editing', 'formulaEnterMode', 'formulaEditMode'],
    muscleMemory: 'common',
    matchBy: 'code',
  },
  {
    id: 'commit-shift-enter',
    bindings: universalBinding('Enter', 'shift'),
    description: 'Complete entry and move up (Shift+Enter-key aware)',
    action: 'COMMIT_SHIFT_ENTER',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['editing', 'formulaEnterMode', 'formulaEditMode'],
    muscleMemory: 'common',
    matchBy: 'code',
  },
  {
    id: 'cancel-edit',
    bindings: universalBinding('Escape'),
    description: 'Cancel entry',
    action: 'CANCEL_EDIT',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['editing'],
    muscleMemory: 'essential',
    matchBy: 'code',
  },
  {
    id: 'insert-newline',
    bindings: altBinding('Enter'),
    description: 'New line within cell',
    action: 'INSERT_NEWLINE',
    enabled: true,
    priority: 'high',
    category: 'editing',
    contexts: ['editing'],
    muscleMemory: 'common',
    matchBy: 'code',
  },

  // ===========================================================================
  // Delete/Clear
  // ===========================================================================

  {
    id: 'clear-contents-delete',
    bindings: universalBinding('Delete'),
    description: 'Clear cell contents',
    action: 'CLEAR_CONTENTS',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['grid'],
    muscleMemory: 'essential',
    matchBy: 'code',
  },
  {
    id: 'clear-contents-backspace',
    bindings: universalBinding('Backspace'),
    description: 'Clear cell contents and enter edit mode',
    action: 'CLEAR_AND_EDIT',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['grid'],
    muscleMemory: 'essential',
    matchBy: 'code',
  },
  {
    id: 'delete-to-end-of-line',
    bindings: crossPlatformBinding('Delete', 'ctrl'),
    description: 'Delete to end of line (in edit mode)',
    action: 'DELETE_TO_END_OF_LINE',
    enabled: false, // Not yet implemented
    priority: 'low',
    category: 'editing',
    contexts: ['editing'],
    muscleMemory: 'rare',
    matchBy: 'code',
  },

  // ===========================================================================
  // Insert/Delete Cells - THE CORE BUG FIX
  // ===========================================================================

  /**
   * Insert cells - Ctrl+Shift+= (Ctrl++ on US keyboard)
   *
   * THIS IS THE BUG WE'RE FIXING:
   * - Physical key: 'Equal' (the =/+ key)
   * - Modifiers: ctrl + shift (shift is needed to get '+' character)
   *
   * Old broken system: matched against "Ctrl++" but saw "Ctrl+Shift++"
   * New system: matches physical key 'Equal' with modifiers ['ctrl', 'shift']
   */
  {
    id: 'insert-cells',
    bindings: {
      default: binding('Equal', 'ctrl', 'shift'),
      macos: binding('Equal', 'meta', 'shift'),
    },
    description: 'Insert cells/rows/columns',
    action: 'OPEN_INSERT_CELLS_DIALOG',
    enabled: true,
    priority: 'high',
    category: 'editing',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
  },
  /**
   * Insert cells via numpad - Ctrl+NumpadAdd
   *
   * Numpad plus doesn't need Shift, so this is a simpler binding.
   * Physical key: 'NumpadAdd'
   */
  {
    id: 'insert-cells-numpad',
    bindings: crossPlatformBinding('NumpadAdd', 'ctrl'),
    description: 'Insert cells/rows/columns (numpad)',
    action: 'OPEN_INSERT_CELLS_DIALOG',
    enabled: true,
    priority: 'high',
    category: 'editing',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  /**
   * Delete cells - Ctrl+- (Ctrl+Minus)
   *
   * Physical key: 'Minus' (the -/_ key)
   * No Shift needed - we want the '-' character
   */
  {
    id: 'delete-cells',
    bindings: crossPlatformBinding('Minus', 'ctrl'),
    description: 'Delete cells/rows/columns',
    action: 'OPEN_DELETE_CELLS_DIALOG',
    enabled: true,
    priority: 'high',
    category: 'editing',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
  },
  /**
   * Delete cells via numpad - Ctrl+NumpadSubtract
   */
  {
    id: 'delete-cells-numpad',
    bindings: crossPlatformBinding('NumpadSubtract', 'ctrl'),
    description: 'Delete cells/rows/columns (numpad)',
    action: 'OPEN_DELETE_CELLS_DIALOG',
    enabled: true,
    priority: 'high',
    category: 'editing',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },

  // ===========================================================================
  // Fill Operations
  // ===========================================================================

  {
    id: 'fill-down',
    bindings: crossPlatformBinding('KeyD', 'ctrl'),
    description: 'Fill down (copy from above)',
    action: 'FILL_DOWN',
    enabled: true,
    priority: 'high',
    category: 'editing',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'key',
    expectedCharacter: 'd',
  },
  {
    id: 'flash-fill',
    bindings: crossPlatformBinding('KeyE', 'ctrl'),
    description: 'Flash Fill',
    action: 'FLASH_FILL',
    enabled: true,
    priority: 'high',
    category: 'editing',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'key',
    expectedCharacter: 'e',
    notes:
      'Flash Fill - pattern recognition feature that detects data transformation patterns from examples',
  },
  {
    id: 'fill-right',
    bindings: crossPlatformBinding('KeyR', 'ctrl'),
    description: 'Fill right (copy from left)',
    action: 'FILL_RIGHT',
    enabled: true,
    priority: 'high',
    category: 'editing',
    contexts: ['grid'],
    muscleMemory: 'common',
    browserConflict: {
      conflictsWith: 'Browser refresh',
      policy: 'override',
      workaround: 'F5 or browser menu still works for refresh',
    },
    matchBy: 'key',
    expectedCharacter: 'r',
  },
  {
    id: 'fill-selection',
    bindings: crossPlatformBinding('Enter', 'ctrl'),
    description: 'Fill selected cells with entry',
    action: 'FILL_SELECTION',
    enabled: true,
    priority: 'medium',
    category: 'editing',
    contexts: ['editing'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },

  // ===========================================================================
  // Undo/Redo
  // ===========================================================================

  {
    id: 'undo',
    bindings: crossPlatformBinding('KeyZ', 'ctrl'),
    description: 'Undo',
    action: 'UNDO',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['any'],
    muscleMemory: 'essential',
    matchBy: 'key',
    expectedCharacter: 'z',
  },
  {
    id: 'redo',
    bindings: crossPlatformBinding('KeyY', 'ctrl'),
    description: 'Redo',
    action: 'REDO',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['any'],
    muscleMemory: 'essential',
    matchBy: 'key',
    expectedCharacter: 'y',
  },
  {
    id: 'redo-alt',
    bindings: crossPlatformBinding('KeyZ', 'ctrl', 'shift'),
    description: 'Redo (alternative)',
    action: 'REDO',
    enabled: true,
    priority: 'high',
    category: 'editing',
    contexts: ['any'],
    muscleMemory: 'common',
    matchBy: 'key',
    expectedCharacter: 'z',
  },

  // ===========================================================================
  // Special Entries (Date, Time, Copy from Above)
  // ===========================================================================

  {
    id: 'insert-current-date',
    // Ctrl+; - Semicolon key
    bindings: crossPlatformBinding('Semicolon', 'ctrl'),
    description: 'Insert current date',
    action: 'INSERT_CURRENT_DATE',
    enabled: true,
    priority: 'high',
    category: 'editing',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
  },
  {
    id: 'insert-current-time',
    // Ctrl+Shift+: - Semicolon with Shift produces ':'
    bindings: crossPlatformBinding('Semicolon', 'ctrl', 'shift'),
    description: 'Insert current time',
    action: 'INSERT_CURRENT_TIME',
    enabled: true,
    priority: 'high',
    category: 'editing',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
  },
  {
    id: 'copy-value-from-above',
    // Ctrl+Shift+" - Quote with Shift produces '"'
    bindings: crossPlatformBinding('Quote', 'ctrl', 'shift'),
    description: 'Copy value from cell above',
    action: 'COPY_VALUE_FROM_ABOVE',
    enabled: true,
    priority: 'medium',
    category: 'editing',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'copy-formula-from-above',
    // Ctrl+' - Quote key without Shift
    bindings: crossPlatformBinding('Quote', 'ctrl'),
    description: 'Copy formula from cell above',
    action: 'COPY_FORMULA_FROM_ABOVE',
    enabled: true,
    priority: 'medium',
    category: 'editing',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },

  // ===========================================================================
  // Insert Table
  // ===========================================================================

  {
    id: 'insert-table',
    bindings: crossPlatformBinding('KeyT', 'ctrl'),
    description: 'Insert table',
    action: 'INSERT_TABLE',
    enabled: true,
    priority: 'high',
    category: 'editing',
    contexts: ['grid'],
    muscleMemory: 'common',
    browserConflict: {
      conflictsWith: 'New tab',
      policy: 'override',
      workaround: 'Use browser menu or Cmd+N for new window',
    },
    matchBy: 'key',
    expectedCharacter: 't',
  },
  {
    id: 'insert-table-alt',
    bindings: crossPlatformBinding('KeyL', 'ctrl'),
    description: 'Insert table (alternate)',
    action: 'INSERT_TABLE',
    enabled: true,
    priority: 'high',
    category: 'editing',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'key',
    expectedCharacter: 'l',
    notes: 'Excel supports both Ctrl+T and Ctrl+L for Create Table dialog',
  },

  // ===========================================================================
  // Merge Cells
  // ===========================================================================

  {
    id: 'toggle-merge',
    bindings: crossPlatformBinding('KeyM', 'ctrl', 'shift'),
    description: 'Toggle merge cells',
    action: 'TOGGLE_MERGE',
    enabled: true,
    priority: 'high',
    category: 'editing',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'key',
    expectedCharacter: 'm',
  },

  // ===========================================================================
  // Enter Mode vs Edit Mode - Arrow Key Handling
  // ===========================================================================

  // Enter Mode (regular editing): Arrow keys commit edit and move selection
  {
    id: 'enter-mode-arrow-up',
    bindings: universalBinding('ArrowUp'),
    description: 'Commit edit and move up',
    action: 'COMMIT_AND_MOVE_UP',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['enterMode'],
    muscleMemory: 'essential',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'enter-mode-arrow-down',
    bindings: universalBinding('ArrowDown'),
    description: 'Commit edit and move down',
    action: 'COMMIT_AND_MOVE_DOWN',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['enterMode'],
    muscleMemory: 'essential',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'enter-mode-arrow-left',
    bindings: universalBinding('ArrowLeft'),
    description: 'Commit edit and move left',
    action: 'COMMIT_AND_MOVE_LEFT',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['enterMode'],
    muscleMemory: 'essential',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'enter-mode-arrow-right',
    bindings: universalBinding('ArrowRight'),
    description: 'Commit edit and move right',
    action: 'COMMIT_AND_MOVE_RIGHT',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['enterMode'],
    muscleMemory: 'essential',
    matchBy: 'code',
    allowRepeat: true,
  },

  // Formula Enter Mode: Arrow keys insert cell references
  {
    id: 'formula-enter-mode-arrow-up',
    bindings: universalBinding('ArrowUp'),
    description: 'Insert/extend cell reference up',
    action: 'FORMULA_SELECT_UP',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['formulaEnterMode'],
    muscleMemory: 'essential',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'formula-enter-mode-arrow-down',
    bindings: universalBinding('ArrowDown'),
    description: 'Insert/extend cell reference down',
    action: 'FORMULA_SELECT_DOWN',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['formulaEnterMode'],
    muscleMemory: 'essential',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'formula-enter-mode-arrow-left',
    bindings: universalBinding('ArrowLeft'),
    description: 'Insert/extend cell reference left',
    action: 'FORMULA_SELECT_LEFT',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['formulaEnterMode'],
    muscleMemory: 'essential',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'formula-enter-mode-arrow-right',
    bindings: universalBinding('ArrowRight'),
    description: 'Insert/extend cell reference right',
    action: 'FORMULA_SELECT_RIGHT',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['formulaEnterMode'],
    muscleMemory: 'essential',
    matchBy: 'code',
    allowRepeat: true,
  },

  // Formula Enter Mode: Shift+Arrow keys extend formula range selection
  {
    id: 'formula-enter-mode-shift-arrow-up',
    bindings: universalBinding('ArrowUp', 'shift'),
    description: 'Extend formula range selection up',
    action: 'FORMULA_EXTEND_UP',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['formulaEnterMode'],
    muscleMemory: 'essential',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'formula-enter-mode-shift-arrow-down',
    bindings: universalBinding('ArrowDown', 'shift'),
    description: 'Extend formula range selection down',
    action: 'FORMULA_EXTEND_DOWN',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['formulaEnterMode'],
    muscleMemory: 'essential',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'formula-enter-mode-shift-arrow-left',
    bindings: universalBinding('ArrowLeft', 'shift'),
    description: 'Extend formula range selection left',
    action: 'FORMULA_EXTEND_LEFT',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['formulaEnterMode'],
    muscleMemory: 'essential',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'formula-enter-mode-shift-arrow-right',
    bindings: universalBinding('ArrowRight', 'shift'),
    description: 'Extend formula range selection right',
    action: 'FORMULA_EXTEND_RIGHT',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['formulaEnterMode'],
    muscleMemory: 'essential',
    matchBy: 'code',
    allowRepeat: true,
  },

  // Formula Enter Mode: Ctrl+Arrow keys jump point-mode reference to data edge
  // (Excel parity,). Each handler enters formula range mode if needed and
  // calls findDataEdge from the active cell, then goTo the result. The
  // cross-coordination subscription detects the anchor change and fires
  // FORMULA_RANGE_SELECTED to insert/replace the reference in the formula.
  {
    id: 'formula-enter-mode-ctrl-arrow-up',
    bindings: crossPlatformBinding('ArrowUp', 'ctrl'),
    description: 'Jump point-mode reference up to data edge',
    action: 'FORMULA_MOVE_TO_EDGE_UP',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['formulaEnterMode'],
    muscleMemory: 'common',
    matchBy: 'code',
  },
  {
    id: 'formula-enter-mode-ctrl-arrow-down',
    bindings: crossPlatformBinding('ArrowDown', 'ctrl'),
    description: 'Jump point-mode reference down to data edge',
    action: 'FORMULA_MOVE_TO_EDGE_DOWN',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['formulaEnterMode'],
    muscleMemory: 'common',
    matchBy: 'code',
  },
  {
    id: 'formula-enter-mode-ctrl-arrow-left',
    bindings: crossPlatformBinding('ArrowLeft', 'ctrl'),
    description: 'Jump point-mode reference left to data edge',
    action: 'FORMULA_MOVE_TO_EDGE_LEFT',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['formulaEnterMode'],
    muscleMemory: 'common',
    matchBy: 'code',
  },
  {
    id: 'formula-enter-mode-ctrl-arrow-right',
    bindings: crossPlatformBinding('ArrowRight', 'ctrl'),
    description: 'Jump point-mode reference right to data edge',
    action: 'FORMULA_MOVE_TO_EDGE_RIGHT',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['formulaEnterMode'],
    muscleMemory: 'common',
    matchBy: 'code',
  },

  // Formula Enter Mode: Ctrl+Shift+Arrow keys extend point-mode reference to
  // contiguous data edge (Excel parity,).
  {
    id: 'formula-enter-mode-ctrl-shift-arrow-up',
    bindings: crossPlatformBinding('ArrowUp', 'ctrl', 'shift'),
    description: 'Extend point-mode reference up to data edge',
    action: 'FORMULA_EXTEND_TO_EDGE_UP',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['formulaEnterMode'],
    muscleMemory: 'common',
    matchBy: 'code',
  },
  {
    id: 'formula-enter-mode-ctrl-shift-arrow-down',
    bindings: crossPlatformBinding('ArrowDown', 'ctrl', 'shift'),
    description: 'Extend point-mode reference down to data edge',
    action: 'FORMULA_EXTEND_TO_EDGE_DOWN',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['formulaEnterMode'],
    muscleMemory: 'common',
    matchBy: 'code',
  },
  {
    id: 'formula-enter-mode-ctrl-shift-arrow-left',
    bindings: crossPlatformBinding('ArrowLeft', 'ctrl', 'shift'),
    description: 'Extend point-mode reference left to data edge',
    action: 'FORMULA_EXTEND_TO_EDGE_LEFT',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['formulaEnterMode'],
    muscleMemory: 'common',
    matchBy: 'code',
  },
  {
    id: 'formula-enter-mode-ctrl-shift-arrow-right',
    bindings: crossPlatformBinding('ArrowRight', 'ctrl', 'shift'),
    description: 'Extend point-mode reference right to data edge',
    action: 'FORMULA_EXTEND_TO_EDGE_RIGHT',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['formulaEnterMode'],
    muscleMemory: 'common',
    matchBy: 'code',
  },

  // ===========================================================================
  // F2 Toggle: Switch between Enter Mode and Edit Mode
  // ===========================================================================

  {
    id: 'toggle-edit-mode-enter',
    bindings: universalBinding('F2'),
    description: 'Toggle between Enter Mode and Edit Mode',
    action: 'TOGGLE_EDIT_MODE',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['enterMode'],
    muscleMemory: 'essential',
    matchBy: 'code',
  },
  {
    id: 'toggle-edit-mode-edit',
    bindings: universalBinding('F2'),
    description: 'Toggle between Edit Mode and Enter Mode',
    action: 'TOGGLE_EDIT_MODE',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['editMode'],
    muscleMemory: 'essential',
    matchBy: 'code',
  },
  {
    id: 'toggle-edit-mode-formula-enter',
    bindings: universalBinding('F2'),
    description: 'Toggle between Enter Mode and Edit Mode',
    action: 'TOGGLE_EDIT_MODE',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['formulaEnterMode'],
    muscleMemory: 'essential',
    matchBy: 'code',
  },
  {
    id: 'toggle-edit-mode-formula-edit',
    bindings: universalBinding('F2'),
    description: 'Toggle between Edit Mode and Enter Mode',
    action: 'TOGGLE_EDIT_MODE',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['formulaEditMode'],
    muscleMemory: 'essential',
    matchBy: 'code',
  },

  // ===========================================================================
  // Edit Mode: Word Deletion Shortcuts
  // ===========================================================================

  {
    id: 'delete-word-forward',
    bindings: crossPlatformBinding('Delete', 'ctrl'),
    description: 'Delete word forward',
    action: 'DELETE_WORD_FORWARD',
    enabled: true,
    priority: 'high',
    category: 'editing',
    contexts: ['editMode'],
    muscleMemory: 'common',
    matchBy: 'code',
    notes: 'Deletes from cursor to end of current/next word. Standard text editing shortcut.',
  },
  {
    id: 'delete-word-backward',
    bindings: crossPlatformBinding('Backspace', 'ctrl'),
    description: 'Delete word backward',
    action: 'DELETE_WORD_BACKWARD',
    enabled: true,
    priority: 'high',
    category: 'editing',
    contexts: ['editMode'],
    muscleMemory: 'common',
    matchBy: 'code',
    notes:
      'Deletes from cursor to beginning of current/previous word. Standard text editing shortcut.',
  },
  {
    id: 'delete-word-forward-formula',
    bindings: crossPlatformBinding('Delete', 'ctrl'),
    description: 'Delete word forward (formula)',
    action: 'DELETE_WORD_FORWARD',
    enabled: true,
    priority: 'high',
    category: 'editing',
    contexts: ['formulaEditMode'],
    muscleMemory: 'common',
    matchBy: 'code',
    notes: 'Deletes from cursor to end of current/next word in formula.',
  },
  {
    id: 'delete-word-backward-formula',
    bindings: crossPlatformBinding('Backspace', 'ctrl'),
    description: 'Delete word backward (formula)',
    action: 'DELETE_WORD_BACKWARD',
    enabled: true,
    priority: 'high',
    category: 'editing',
    contexts: ['formulaEditMode'],
    muscleMemory: 'common',
    matchBy: 'code',
    notes: 'Deletes from cursor to beginning of current/previous word in formula.',
  },

  // ===========================================================================
  // F4: Repeat Last Action (grid context)
  // ===========================================================================

  {
    id: 'repeat-last-action',
    bindings: universalBinding('F4'),
    description: 'Repeat last action',
    action: 'REPEAT_LAST_ACTION',
    enabled: true,
    priority: 'high',
    category: 'editing',
    contexts: ['grid'],
    muscleMemory: 'essential',
    matchBy: 'code',
    notes: 'F4 repeats last formatting/structural action in grid context',
  },

  // ===========================================================================
  // Ink/Drawing Shortcuts
  // ===========================================================================

  {
    id: 'toggle-ink-mode',
    bindings: crossPlatformBinding('KeyD', 'ctrl', 'shift'),
    description: 'Toggle Ink Mode',
    action: 'TOGGLE_INK_MODE_DEFAULT',
    enabled: true,
    priority: 'medium',
    category: 'editing',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'key',
    expectedCharacter: 'd',
    notes: 'Wave 5: Toggles ink/drawing mode with pen tool',
  },
  {
    id: 'deactivate-ink-mode',
    bindings: universalBinding('Escape'),
    description: 'Exit Ink Mode',
    action: 'DEACTIVATE_INK_MODE',
    enabled: true,
    priority: 'high',
    category: 'editing',
    contexts: ['drawing'],
    muscleMemory: 'essential',
    matchBy: 'code',
    notes: 'Wave 5: Exits ink mode and returns to normal grid mode',
  },
  {
    id: 'ink-pen-tool',
    bindings: universalBinding('KeyP'),
    description: 'Pen Tool',
    action: 'SET_INK_TOOL',
    enabled: true,
    priority: 'high',
    category: 'editing',
    contexts: ['drawing'],
    muscleMemory: 'common',
    matchBy: 'code',
    notes: 'Wave 5: Switches to pen tool in ink mode',
  },
  {
    id: 'ink-eraser-tool',
    bindings: universalBinding('KeyE'),
    description: 'Eraser Tool',
    action: 'SET_INK_TOOL',
    enabled: true,
    priority: 'high',
    category: 'editing',
    contexts: ['drawing'],
    muscleMemory: 'common',
    matchBy: 'code',
    notes: 'Wave 5: Switches to eraser tool in ink mode',
  },
  {
    id: 'ink-highlighter-tool',
    bindings: universalBinding('KeyH'),
    description: 'Highlighter Tool',
    action: 'SET_INK_TOOL',
    enabled: true,
    priority: 'high',
    category: 'editing',
    contexts: ['drawing'],
    muscleMemory: 'common',
    matchBy: 'code',
    notes: 'Wave 5: Switches to highlighter tool in ink mode',
  },
  {
    id: 'delete-selected-strokes-delete',
    bindings: universalBinding('Delete'),
    description: 'Delete Selected Strokes',
    action: 'DELETE_SELECTED_STROKES',
    enabled: true,
    priority: 'high',
    category: 'editing',
    contexts: ['drawing'],
    muscleMemory: 'essential',
    matchBy: 'code',
    notes: 'Wave 5: Deletes selected strokes in ink mode',
  },
  {
    id: 'delete-selected-strokes-backspace',
    bindings: universalBinding('Backspace'),
    description: 'Delete Selected Strokes',
    action: 'DELETE_SELECTED_STROKES',
    enabled: true,
    priority: 'high',
    category: 'editing',
    contexts: ['drawing'],
    muscleMemory: 'essential',
    matchBy: 'code',
    notes: 'Wave 5: Deletes selected strokes in ink mode (alternative key)',
  },

  // ===========================================================================
  // Proofing
  // ===========================================================================

  {
    id: 'open-thesaurus-dialog',
    bindings: universalBinding('F7', 'shift'),
    description: 'Open Thesaurus dialog',
    action: 'OPEN_THESAURUS_DIALOG',
    enabled: true,
    priority: 'medium',
    category: 'editing',
    contexts: ['any'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Opens Thesaurus dialog for synonym/antonym lookup',
  },

  // ===========================================================================
  // Equation
  // ===========================================================================

  {
    id: 'insert-equation',
    // Alt+Shift+= - Equal key with Alt and Shift
    bindings: altBinding('Equal', 'shift'),
    description: 'Insert Equation',
    action: 'INSERT_EQUATION',
    enabled: true,
    priority: 'medium',
    category: 'editing',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes:
      'Opens Equation Editor dialog to insert a new equation. Only works in grid context (disabled when editing cells).',
  },

  // ===========================================================================
  // Insert Hyperlink
  // ===========================================================================

  {
    id: 'insert-hyperlink',
    bindings: crossPlatformBinding('KeyK', 'ctrl'),
    description: 'Insert or edit hyperlink',
    action: 'OPEN_HYPERLINK_DIALOG',
    enabled: true,
    priority: 'high',
    category: 'editing',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'key',
    expectedCharacter: 'k',
    notes: 'Opens the Insert Hyperlink dialog box for the selected cell',
  },

  // ===========================================================================
  // Spelling
  // ===========================================================================

  {
    id: 'open-spelling-dialog',
    bindings: universalBinding('F7'),
    description: 'Open Spelling dialog',
    action: 'OPEN_SPELLING_DIALOG',
    enabled: true,
    priority: 'medium',
    category: 'editing',
    contexts: ['any'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Opens the Spelling dialog box for spell-checking the worksheet',
  },
];
