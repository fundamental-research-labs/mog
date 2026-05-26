/**
 * Selection Keyboard Shortcuts (Unified v2)
 *
 * Physical-key-based shortcuts for selecting cells and ranges:
 * - Shift+Arrow (extend selection)
 * - Ctrl+Shift+Arrow (extend to data edges)
 * - Select all (Ctrl+A)
 * - Row/column selection
 * - Selection modes (F8, Shift+F8)
 * - Special selections (precedents, dependents)
 *
 * Total: 28 shortcuts
 */

import type { KeyboardShortcut } from '../types';
import { altBinding, crossPlatformBinding, universalBinding } from '@mog-sdk/kernel/keyboard';

export const SELECTION_SHORTCUTS: KeyboardShortcut[] = [
  // ===========================================================================
  // Shift+Arrow (extend selection)
  // ===========================================================================

  {
    id: 'extend-selection-up',
    bindings: universalBinding('ArrowUp', 'shift'),
    description: 'Extend selection up one cell',
    action: 'EXTEND_SELECTION_UP',
    enabled: true,
    priority: 'critical',
    category: 'selection',
    contexts: ['grid'],
    muscleMemory: 'essential',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'extend-selection-down',
    bindings: universalBinding('ArrowDown', 'shift'),
    description: 'Extend selection down one cell',
    action: 'EXTEND_SELECTION_DOWN',
    enabled: true,
    priority: 'critical',
    category: 'selection',
    contexts: ['grid'],
    muscleMemory: 'essential',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'extend-selection-left',
    bindings: universalBinding('ArrowLeft', 'shift'),
    description: 'Extend selection left one cell',
    action: 'EXTEND_SELECTION_LEFT',
    enabled: true,
    priority: 'critical',
    category: 'selection',
    contexts: ['grid'],
    muscleMemory: 'essential',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'extend-selection-right',
    bindings: universalBinding('ArrowRight', 'shift'),
    description: 'Extend selection right one cell',
    action: 'EXTEND_SELECTION_RIGHT',
    enabled: true,
    priority: 'critical',
    category: 'selection',
    contexts: ['grid'],
    muscleMemory: 'essential',
    matchBy: 'code',
    allowRepeat: true,
  },

  // ===========================================================================
  // Ctrl+Shift+Arrow (extend to data edge)
  // ===========================================================================

  {
    id: 'extend-to-edge-up',
    bindings: crossPlatformBinding('ArrowUp', 'ctrl', 'shift'),
    description: 'Extend selection to top edge of data region',
    action: 'EXTEND_TO_EDGE_UP',
    enabled: true,
    priority: 'high',
    category: 'selection',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'extend-to-edge-down',
    bindings: crossPlatformBinding('ArrowDown', 'ctrl', 'shift'),
    description: 'Extend selection to bottom edge of data region',
    action: 'EXTEND_TO_EDGE_DOWN',
    enabled: true,
    priority: 'high',
    category: 'selection',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'extend-to-edge-left',
    bindings: crossPlatformBinding('ArrowLeft', 'ctrl', 'shift'),
    description: 'Extend selection to left edge of data region',
    action: 'EXTEND_TO_EDGE_LEFT',
    enabled: true,
    priority: 'high',
    category: 'selection',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'extend-to-edge-right',
    bindings: crossPlatformBinding('ArrowRight', 'ctrl', 'shift'),
    description: 'Extend selection to right edge of data region',
    action: 'EXTEND_TO_EDGE_RIGHT',
    enabled: true,
    priority: 'high',
    category: 'selection',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
    allowRepeat: true,
  },

  // ===========================================================================
  // Select All
  // ===========================================================================

  {
    id: 'cycle-table-selection',
    bindings: crossPlatformBinding('KeyA', 'ctrl'),
    description: 'Select all cells (or current region/table, then all)',
    action: 'CYCLE_TABLE_SELECTION',
    enabled: true,
    priority: 'critical',
    category: 'selection',
    contexts: ['grid'],
    muscleMemory: 'essential',
    matchBy: 'key',
    expectedCharacter: 'a',
    notes: 'Progressive selection in tables (data -> full table -> all)',
  },
  {
    id: 'select-current-region',
    // Ctrl+Shift+* - The asterisk is Shift+Digit8 on US keyboard
    bindings: crossPlatformBinding('Digit8', 'ctrl', 'shift'),
    description: 'Select current region around active cell',
    action: 'SELECT_CURRENT_REGION',
    enabled: true,
    priority: 'high',
    category: 'selection',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },

  // ===========================================================================
  // Row/Column Selection
  // ===========================================================================

  {
    id: 'select-entire-row',
    bindings: universalBinding('Space', 'shift'),
    description: 'Select entire row',
    action: 'SELECT_ENTIRE_ROW',
    enabled: true,
    priority: 'high',
    category: 'selection',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
  },
  {
    id: 'cycle-table-column-selection',
    bindings: crossPlatformBinding('Space', 'ctrl'),
    description: 'Select entire column (or progressive table column)',
    action: 'CYCLE_TABLE_COLUMN_SELECTION',
    enabled: true,
    priority: 'high',
    category: 'selection',
    contexts: ['grid'],
    muscleMemory: 'common',
    browserConflict: {
      conflictsWith: 'Spotlight (Mac)',
      policy: 'override',
      workaround: 'Users can remap Spotlight in macOS settings',
    },
    matchBy: 'code',
    notes: 'Progressive selection in tables (data -> data+header -> full column)',
  },
  {
    id: 'select-all',
    bindings: crossPlatformBinding('Space', 'ctrl', 'shift'),
    description: 'Select entire worksheet',
    action: 'SELECT_ALL',
    enabled: true,
    priority: 'high',
    category: 'selection',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },

  // ===========================================================================
  // Extend to Home/End
  // ===========================================================================

  {
    id: 'extend-to-row-start',
    bindings: universalBinding('Home', 'shift'),
    description: 'Extend selection to column A',
    action: 'EXTEND_TO_ROW_START',
    enabled: true,
    priority: 'medium',
    category: 'selection',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'extend-to-row-end',
    bindings: universalBinding('End', 'shift'),
    description: 'Extend selection to end of row',
    action: 'EXTEND_TO_ROW_END',
    enabled: true,
    priority: 'high',
    category: 'selection',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
    allowRepeat: false,
  },
  {
    id: 'extend-to-a1',
    bindings: crossPlatformBinding('Home', 'ctrl', 'shift'),
    description: 'Extend selection to A1',
    action: 'EXTEND_TO_A1',
    enabled: true,
    priority: 'medium',
    category: 'selection',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'extend-to-last-used-cell',
    bindings: crossPlatformBinding('End', 'ctrl', 'shift'),
    description: 'Extend selection to last used cell',
    action: 'EXTEND_TO_LAST_USED_CELL',
    enabled: true,
    priority: 'medium',
    category: 'selection',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },

  // ===========================================================================
  // Special Selections (Precedents/Dependents)
  // ===========================================================================

  {
    id: 'select-precedents',
    // Ctrl+[ - BracketLeft is the [ key
    bindings: crossPlatformBinding('BracketLeft', 'ctrl'),
    description: 'Select direct precedents',
    action: 'SELECT_PRECEDENTS',
    enabled: true,
    priority: 'medium',
    category: 'selection',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'select-dependents',
    // Ctrl+] - BracketRight is the ] key
    bindings: crossPlatformBinding('BracketRight', 'ctrl'),
    description: 'Select direct dependents',
    action: 'SELECT_DEPENDENTS',
    enabled: true,
    priority: 'medium',
    category: 'selection',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'select-visible-cells',
    // Alt+; - Semicolon is the ; key
    bindings: altBinding('Semicolon'),
    description: 'Select visible cells only',
    action: 'SELECT_VISIBLE_CELLS',
    enabled: true,
    priority: 'low',
    category: 'selection',
    contexts: ['grid'],
    muscleMemory: 'rare',
    matchBy: 'code',
  },

  // ===========================================================================
  // Row/Column Differences
  // ===========================================================================

  {
    id: 'select-row-differences',
    // Ctrl+\ - Backslash key
    bindings: crossPlatformBinding('Backslash', 'ctrl'),
    description: 'Select cells in row that differ from comparison cell',
    action: 'SELECT_ROW_DIFFERENCES',
    enabled: true,
    priority: 'low',
    category: 'selection',
    contexts: ['grid'],
    muscleMemory: 'rare',
    matchBy: 'code',
    notes:
      'Compares each cell in row to the cell in the active column. Go To Special: Row Differences.',
  },
  {
    id: 'select-column-differences',
    // Ctrl+Shift+\ - Backslash with shift
    bindings: crossPlatformBinding('Backslash', 'ctrl', 'shift'),
    description: 'Select cells in column that differ from comparison cell',
    action: 'SELECT_COLUMN_DIFFERENCES',
    enabled: true,
    priority: 'low',
    category: 'selection',
    contexts: ['grid'],
    muscleMemory: 'rare',
    matchBy: 'code',
    notes:
      'Compares each cell in column to the cell in the active row. Go To Special: Column Differences.',
  },

  // ===========================================================================
  // Selection Modes
  // ===========================================================================

  {
    id: 'toggle-extend-selection-mode',
    bindings: universalBinding('F8'),
    description: 'Extend selection mode (arrow keys extend without Shift)',
    action: 'TOGGLE_EXTEND_SELECTION_MODE',
    enabled: true,
    priority: 'low',
    category: 'selection',
    contexts: ['grid'],
    muscleMemory: 'rare',
    matchBy: 'code',
  },
  {
    id: 'toggle-add-to-selection',
    bindings: universalBinding('F8', 'shift'),
    description: 'Add to selection mode (non-adjacent ranges)',
    action: 'TOGGLE_ADD_TO_SELECTION',
    enabled: true,
    priority: 'low',
    category: 'selection',
    contexts: ['grid'],
    muscleMemory: 'rare',
    matchBy: 'code',
  },

  // ===========================================================================
  // Corner Rotation
  // ===========================================================================

  {
    id: 'rotate-selection-corner',
    // Ctrl+. - Period key
    bindings: crossPlatformBinding('Period', 'ctrl'),
    description: 'Rotate active cell through corners of selection',
    action: 'ROTATE_SELECTION_CORNER',
    enabled: true,
    priority: 'medium',
    category: 'selection',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
  },

  // ===========================================================================
  // Ink/Drawing Selection
  // ===========================================================================

  {
    id: 'toggle-lasso-selection',
    // 'l' key - in drawing context, no modifiers
    bindings: universalBinding('KeyL'),
    description: 'Toggle Lasso Selection',
    action: 'TOGGLE_LASSO_SELECTION',
    enabled: true,
    priority: 'high',
    category: 'selection',
    contexts: ['drawing'],
    muscleMemory: 'common',
    matchBy: 'code',
    notes: 'Wave 5: Toggles lasso selection mode for selecting strokes',
  },
  {
    id: 'select-all-strokes',
    // Ctrl+A in drawing context
    bindings: crossPlatformBinding('KeyA', 'ctrl'),
    description: 'Select All Strokes',
    action: 'SELECT_ALL_STROKES',
    enabled: true,
    priority: 'high',
    category: 'selection',
    contexts: ['drawing'],
    muscleMemory: 'essential',
    matchBy: 'key',
    expectedCharacter: 'a',
    notes: 'Wave 5: Selects all strokes in the active drawing',
  },

  // ===========================================================================
  // Page-based Selection Extension
  // ===========================================================================

  {
    id: 'extend-selection-page-down',
    bindings: universalBinding('PageDown', 'shift'),
    description: 'Extend selection down one screen',
    action: 'EXTEND_SELECTION_PAGE_DOWN',
    enabled: true,
    priority: 'medium',
    category: 'selection',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'extend-selection-page-up',
    bindings: universalBinding('PageUp', 'shift'),
    description: 'Extend selection up one screen',
    action: 'EXTEND_SELECTION_PAGE_UP',
    enabled: true,
    priority: 'medium',
    category: 'selection',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    allowRepeat: true,
  },

  // ===========================================================================
  // Special Selections: Constants and Array Range
  // ===========================================================================

  {
    id: 'select-constants',
    bindings: crossPlatformBinding('KeyJ', 'ctrl', 'shift'),
    description: 'Select constant cells (Go To Special)',
    action: 'SELECT_CONSTANTS',
    enabled: true,
    priority: 'low',
    category: 'selection',
    contexts: ['grid'],
    muscleMemory: 'rare',
    matchBy: 'key',
    expectedCharacter: 'j',
    notes:
      'Go To Special: selects cells containing constants (non-formulas) in the current selection',
  },
  {
    id: 'select-array-range',
    // Ctrl+/ - Slash key
    bindings: crossPlatformBinding('Slash', 'ctrl'),
    description: 'Select array formula range containing active cell',
    action: 'SELECT_CURRENT_ARRAY',
    enabled: true,
    priority: 'low',
    category: 'selection',
    contexts: ['grid'],
    muscleMemory: 'rare',
    matchBy: 'code',
    notes: 'Selects the entire array formula range that contains the active cell',
  },

  // ===========================================================================
  // Reduce selection
  // ===========================================================================

  {
    id: 'reduce-selection',
    bindings: universalBinding('Backspace', 'shift'),
    description: 'Reduce selection to active cell',
    action: 'REDUCE_SELECTION',
    enabled: true,
    priority: 'high',
    category: 'selection',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
  },
];
