/**
 * Formula Keyboard Shortcuts (Unified v2)
 *
 * Physical-key-based shortcuts for formula operations:
 * - Formula entry (=)
 * - Array formula (Ctrl+Shift+Enter)
 * - F4 (cycle reference in formula editing)
 * - Function insert
 * - AutoSum
 * - Name management
 * - Formula auditing
 * - Calculation
 *
 * Total: 21 shortcuts
 */

import type { KeyboardShortcut } from '../types';
import { altBinding, crossPlatformBinding, universalBinding } from '@mog-sdk/kernel/keyboard';

export const FORMULA_SHORTCUTS: KeyboardShortcut[] = [
  // ===========================================================================
  // Formula Entry
  // ===========================================================================

  {
    id: 'start-formula',
    // The = key is the 'Equal' physical key (without Shift)
    bindings: universalBinding('Equal'),
    description: 'Start formula',
    action: 'START_FORMULA',
    enabled: true,
    priority: 'critical',
    category: 'formula',
    contexts: ['grid'],
    muscleMemory: 'essential',
    matchBy: 'code',
  },
  {
    id: 'enter-array-formula',
    // Ctrl+Shift+Enter for CSE (Classic/Legacy Array Formula)
    bindings: crossPlatformBinding('Enter', 'ctrl', 'shift'),
    description: 'Enter array formula (CSE)',
    action: 'ENTER_ARRAY_FORMULA',
    enabled: true,
    priority: 'medium',
    category: 'formula',
    contexts: ['formulaEditing'],
    muscleMemory: 'rare',
    matchBy: 'code',
    notes: 'Commits formula with isArrayFormula flag, displays as {=FORMULA} in formula bar',
  },

  // ===========================================================================
  // F4 - Cycle Reference (in formula editing)
  // ===========================================================================

  {
    id: 'cycle-reference',
    bindings: universalBinding('F4'),
    description: 'Cycle absolute/relative reference',
    action: 'CYCLE_REFERENCE',
    enabled: true,
    priority: 'high',
    category: 'formula',
    contexts: ['formulaEditing'],
    muscleMemory: 'essential',
    matchBy: 'code',
  },

  // ===========================================================================
  // Formula Bar
  // ===========================================================================

  {
    id: 'toggle-formula-bar-expand',
    bindings: crossPlatformBinding('KeyU', 'ctrl', 'shift'),
    description: 'Expand/collapse formula bar',
    action: 'TOGGLE_FORMULA_BAR_EXPAND',
    enabled: true,
    priority: 'low',
    category: 'formula',
    contexts: ['any'],
    muscleMemory: 'rare',
    matchBy: 'key',
    expectedCharacter: 'u',
  },

  // ===========================================================================
  // NL Formula Bar (AI)
  // ===========================================================================

  {
    id: 'toggle-nl-formula-bar',
    bindings: crossPlatformBinding('KeyI', 'ctrl', 'shift'),
    description: 'Toggle AI formula bar',
    action: 'TOGGLE_NL_BAR',
    enabled: true,
    priority: 'medium',
    category: 'formula',
    contexts: ['any'],
    muscleMemory: 'rare',
    matchBy: 'key',
    expectedCharacter: 'i',
  },

  // ===========================================================================
  // Function Insert
  // ===========================================================================

  {
    id: 'open-insert-function-dialog',
    bindings: universalBinding('F3', 'shift'),
    description: 'Insert Function dialog',
    action: 'OPEN_INSERT_FUNCTION_DIALOG',
    enabled: true,
    priority: 'medium',
    category: 'formula',
    contexts: ['any'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'insert-function-args',
    bindings: crossPlatformBinding('KeyA', 'ctrl', 'shift'),
    description: 'Insert function arguments',
    action: 'INSERT_FUNCTION_ARGS',
    enabled: true,
    priority: 'low',
    category: 'formula',
    contexts: ['formulaEditing'],
    muscleMemory: 'rare',
    matchBy: 'key',
    expectedCharacter: 'a',
  },
  {
    id: 'open-function-arguments-dialog',
    bindings: crossPlatformBinding('KeyA', 'ctrl'),
    description: 'Show Function Arguments dialog (when cursor after function name)',
    action: 'OPEN_FUNCTION_ARGUMENTS_DIALOG',
    enabled: true,
    priority: 'medium',
    category: 'formula',
    contexts: ['formulaEditing'],
    muscleMemory: 'occasional',
    matchBy: 'key',
    expectedCharacter: 'a',
    notes:
      'Opens Function Arguments dialog when cursor is positioned after a function name in formula editing mode',
  },

  // ===========================================================================
  // AutoSum
  // ===========================================================================

  {
    id: 'auto-sum',
    // Alt+= - Equal key with Alt
    bindings: altBinding('Equal'),
    description: 'AutoSum',
    action: 'AUTO_SUM',
    enabled: true,
    priority: 'high',
    category: 'formula',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
  },

  // ===========================================================================
  // Name Management
  // ===========================================================================

  {
    id: 'open-name-manager',
    bindings: crossPlatformBinding('F3', 'ctrl'),
    description: 'Name Manager',
    action: 'OPEN_NAME_MANAGER',
    enabled: true,
    priority: 'medium',
    category: 'formula',
    contexts: ['any'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'create-names-from-selection',
    bindings: crossPlatformBinding('F3', 'ctrl', 'shift'),
    description: 'Create names from selection',
    action: 'CREATE_NAMES_FROM_SELECTION',
    enabled: true,
    priority: 'low',
    category: 'formula',
    contexts: ['grid'],
    muscleMemory: 'rare',
    matchBy: 'code',
    notes: 'Routes to UI callback to show Create Names from Selection dialog',
  },
  {
    id: 'paste-name-in-formula',
    bindings: universalBinding('F3'),
    description: 'Paste name into formula',
    action: 'PASTE_NAME_IN_FORMULA',
    enabled: true,
    priority: 'low',
    category: 'formula',
    contexts: ['formulaEditing'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Routes to onUIAction to show name picker dialog',
  },

  // ===========================================================================
  // Formula Auditing
  // ===========================================================================

  {
    id: 'toggle-formula-view',
    // Ctrl+` - Backquote key (without Shift = `)
    bindings: crossPlatformBinding('Backquote', 'ctrl'),
    description: 'Toggle formula view',
    action: 'TOGGLE_FORMULA_VIEW',
    enabled: true,
    priority: 'medium',
    category: 'formula',
    contexts: ['any'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'select-precedents-alt',
    // Ctrl+Shift+{ = Ctrl+Shift+BracketLeft
    // The { is Shift+BracketLeft on US keyboard
    bindings: crossPlatformBinding('BracketLeft', 'ctrl', 'shift'),
    description: 'Select precedent cells',
    action: 'SELECT_PRECEDENTS',
    enabled: true,
    priority: 'low',
    category: 'formula',
    contexts: ['grid'],
    muscleMemory: 'rare',
    matchBy: 'code',
    notes: '.5: Same action as Ctrl+[, navigates to first precedent cell',
  },
  {
    id: 'select-dependents-alt',
    // Ctrl+Shift+} = Ctrl+Shift+BracketRight
    // The } is Shift+BracketRight on US keyboard
    bindings: crossPlatformBinding('BracketRight', 'ctrl', 'shift'),
    description: 'Select dependent cells',
    action: 'SELECT_DEPENDENTS',
    enabled: true,
    priority: 'low',
    category: 'formula',
    contexts: ['grid'],
    muscleMemory: 'rare',
    matchBy: 'code',
    notes: '.5: Same action as Ctrl+], navigates to first dependent cell',
  },

  // ===========================================================================
  // Calculation
  // ===========================================================================

  {
    id: 'evaluate-formula-selection-enter',
    bindings: universalBinding('F9'),
    description: 'Evaluate selected formula portion',
    action: 'EVALUATE_FORMULA_SELECTION',
    enabled: true,
    priority: 'high',
    category: 'formula',
    contexts: ['formulaEnterMode'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes:
      'With selection, evaluates and replaces selected portion. Without selection, falls back to CALCULATE_ALL.',
  },
  {
    id: 'evaluate-formula-selection-edit',
    bindings: universalBinding('F9'),
    description: 'Evaluate selected formula portion',
    action: 'EVALUATE_FORMULA_SELECTION',
    enabled: true,
    priority: 'high',
    category: 'formula',
    contexts: ['formulaEditMode'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes:
      'With selection, evaluates and replaces selected portion. Without selection, falls back to CALCULATE_ALL.',
  },
  {
    id: 'calculate-all',
    bindings: universalBinding('F9'),
    description: 'Calculate all workbooks',
    action: 'CALCULATE_ALL',
    enabled: true,
    priority: 'medium',
    category: 'formula',
    contexts: ['any'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'calculate-sheet',
    bindings: universalBinding('F9', 'shift'),
    description: 'Calculate active sheet',
    action: 'CALCULATE_SHEET',
    enabled: true,
    priority: 'medium',
    category: 'formula',
    contexts: ['any'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },

  // ===========================================================================
  // Force Recalculation
  // ===========================================================================

  {
    id: 'calculate-all-force',
    // Ctrl+Alt+F9 - Force full recalculation
    // Mac uses physical Ctrl+Option+F9 (not Cmd+Option+F9)
    bindings: {
      default: { code: 'F9', modifiers: ['alt', 'ctrl'] },
      macos: { code: 'F9', modifiers: ['alt', 'ctrl'] },
    },
    description: 'Force calculate all worksheets (regardless of changes)',
    action: 'CALCULATE_ALL_FORCE',
    enabled: true,
    priority: 'low',
    category: 'formula',
    contexts: ['any'],
    muscleMemory: 'rare',
    matchBy: 'code',
    notes:
      'Recalculates all formulas in all open workbooks regardless of whether they have changed since last calculation. Mac uses physical Ctrl+Option (not Cmd+Option).',
  },
  {
    id: 'calculate-rebuild-dependencies',
    // Ctrl+Alt+Shift+F9 - Rebuild dependency tree and recalculate
    // Mac uses physical Ctrl+Option+Shift+F9 (not Cmd+Option+Shift+F9)
    bindings: {
      default: { code: 'F9', modifiers: ['alt', 'ctrl', 'shift'] },
      macos: { code: 'F9', modifiers: ['alt', 'ctrl', 'shift'] },
    },
    description: 'Rebuild dependency tree and force recalculate all',
    action: 'CALCULATE_REBUILD_DEPENDENCIES',
    enabled: true,
    priority: 'low',
    category: 'formula',
    contexts: ['any'],
    muscleMemory: 'rare',
    matchBy: 'code',
    notes:
      'Rechecks all dependent formulas and then recalculates all cells in all open workbooks. Mac uses physical Ctrl+Option+Shift (not Cmd+Option+Shift).',
  },
];
