/**
 * Workbook/File Keyboard Shortcuts (Unified v2)
 *
 * Physical-key-based shortcuts for file and workbook operations:
 * - File operations (Save, Open, Print)
 * - Sheet operations (Insert sheet)
 * - Backstage view
 * - Chart sheet creation
 *
 * Total: 14 shortcuts
 */

import type { KeyboardShortcut } from '../types';
import {
  altBinding,
  binding,
  crossPlatformBinding,
  universalBinding,
} from '@mog-sdk/kernel/keyboard';

export const WORKBOOK_SHORTCUTS: KeyboardShortcut[] = [
  // ===========================================================================
  // File Operations
  // ===========================================================================

  {
    id: 'save',
    bindings: crossPlatformBinding('KeyS', 'ctrl'),
    description: 'Save',
    action: 'SAVE',
    enabled: true,
    priority: 'high',
    category: 'file',
    contexts: ['any'],
    muscleMemory: 'essential',
    browserConflict: {
      conflictsWith: 'Save page',
      policy: 'override',
    },
    matchBy: 'key',
    expectedCharacter: 's',
  },
  {
    id: 'open',
    bindings: crossPlatformBinding('KeyO', 'ctrl'),
    description: 'Open',
    action: 'OPEN',
    enabled: true,
    priority: 'medium',
    category: 'file',
    contexts: ['any'],
    muscleMemory: 'common',
    browserConflict: {
      conflictsWith: 'Open file',
      policy: 'override',
    },
    matchBy: 'key',
    expectedCharacter: 'o',
  },
  {
    id: 'new-workbook',
    bindings: crossPlatformBinding('KeyN', 'ctrl'),
    description: 'New workbook',
    action: 'NEW_WORKBOOK',
    // Disabled: browserConflict policy is 'defer', so we let the browser handle Ctrl+N.
    // If enabled were true, the action would fire AND the browser would open a new window
    // (since defer does not call preventDefault), causing a double action.
    enabled: false,
    priority: 'medium',
    category: 'file',
    contexts: ['any'],
    muscleMemory: 'common',
    browserConflict: {
      conflictsWith: 'New window',
      policy: 'defer',
      workaround: 'Use File menu or toolbar button',
    },
    matchBy: 'key',
    expectedCharacter: 'n',
  },
  {
    id: 'print',
    bindings: crossPlatformBinding('KeyP', 'ctrl'),
    description: 'Print',
    action: 'PRINT',
    enabled: true,
    priority: 'medium',
    category: 'file',
    contexts: ['any'],
    muscleMemory: 'common',
    browserConflict: {
      conflictsWith: 'Print page',
      policy: 'override',
    },
    matchBy: 'key',
    expectedCharacter: 'p',
  },
  {
    id: 'quick-print',
    bindings: crossPlatformBinding('F12', 'ctrl', 'shift'),
    description: 'Quick Print (print directly using default settings)',
    action: 'QUICK_PRINT',
    enabled: true,
    priority: 'medium',
    category: 'file',
    contexts: ['any'],
    muscleMemory: 'rare',
    matchBy: 'code',
  },
  {
    id: 'close-workbook',
    // Windows/Linux: Ctrl+F4, Mac: Cmd+W
    bindings: {
      default: binding('F4', 'ctrl'),
      macos: binding('KeyW', 'meta'),
    },
    description: 'Close current workbook',
    action: 'CLOSE_WORKBOOK',
    // Disabled: Cmd+W on Mac cannot be overridden in most browsers — the browser
    // intercepts it before JavaScript sees the event. Setting policy to 'defer'
    // and disabling the shortcut to avoid inconsistent cross-platform behavior.
    enabled: false,
    priority: 'high',
    category: 'file',
    contexts: ['any'],
    muscleMemory: 'common',
    browserConflict: {
      conflictsWith: 'Close tab',
      policy: 'defer',
      workaround: 'Use File menu or close button',
    },
    matchBy: 'code',
  },

  // ===========================================================================
  // Sheet Operations
  // ===========================================================================

  {
    id: 'insert-sheet',
    bindings: universalBinding('F11', 'shift'),
    description: 'Insert new sheet',
    action: 'INSERT_SHEET',
    enabled: true,
    priority: 'high',
    category: 'workbook',
    contexts: ['any'],
    muscleMemory: 'common',
    matchBy: 'code',
  },
  {
    id: 'insert-sheet-alt',
    bindings: altBinding('F1', 'shift'),
    description: 'Insert new sheet (alternative)',
    action: 'INSERT_SHEET',
    enabled: true,
    priority: 'medium',
    category: 'workbook',
    contexts: ['any'],
    muscleMemory: 'rare',
    matchBy: 'code',
  },

  // ===========================================================================
  // Chart Sheet Creation
  // ===========================================================================

  {
    id: 'create-chart-sheet',
    bindings: universalBinding('F11'),
    description: 'Create chart sheet from selection',
    action: 'CREATE_CHART_SHEET',
    enabled: true,
    priority: 'low',
    category: 'workbook',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'F11 creates new sheet with chart from current selection',
  },

  // ===========================================================================
  // Save As
  // ===========================================================================

  {
    id: 'save-as',
    // Windows/Linux: F12, Mac: Cmd+Shift+S
    bindings: {
      default: { code: 'F12', modifiers: [] },
      macos: { code: 'KeyS', modifiers: ['meta', 'shift'] },
    },
    description: 'Save As',
    action: 'SAVE_AS',
    enabled: true,
    priority: 'medium',
    category: 'file',
    contexts: ['any'],
    muscleMemory: 'common',
    matchBy: 'code',
    notes: 'Opens Save As dialog to save file with a new name or format',
  },

  // ===========================================================================
  // Open File (alternative)
  // ===========================================================================

  {
    id: 'open-file-dialog-alt',
    bindings: crossPlatformBinding('F12', 'ctrl'),
    description: 'Open file (alternative)',
    action: 'OPEN',
    enabled: true,
    priority: 'low',
    category: 'file',
    contexts: ['any'],
    muscleMemory: 'rare',
    matchBy: 'code',
    notes: 'Ctrl+F12 is an alternative shortcut for Open dialog; same as Ctrl+O',
  },

  // ===========================================================================
  // Print Preview
  // ===========================================================================

  {
    id: 'open-print-preview',
    bindings: crossPlatformBinding('F2', 'ctrl'),
    description: 'Open Print Preview',
    action: 'OPEN_PRINT_PREVIEW',
    enabled: true,
    priority: 'medium',
    category: 'file',
    contexts: ['any'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Ctrl+F2 opens Print Preview tab in Backstage view',
  },

  // ===========================================================================
  // Export File
  // ===========================================================================

  {
    id: 'export-file',
    bindings: crossPlatformBinding('KeyS', 'ctrl', 'shift'),
    description: 'Export file',
    action: 'EXPORT_FILE',
    enabled: true,
    priority: 'medium',
    category: 'file',
    contexts: ['global'],
    muscleMemory: 'common',
    matchBy: 'key',
    expectedCharacter: 's',
  },
];
