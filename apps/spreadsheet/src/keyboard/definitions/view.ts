/**
 * View Keyboard Shortcuts (Unified v2)
 *
 * Physical-key-based shortcuts for view controls:
 * - Zoom (mostly deferred to browser)
 * - Hide/Unhide rows/columns
 * - Ribbon visibility
 * - Full screen
 * - Page Break Preview
 * - Help
 * - Command Palette
 *
 * Total: 15 shortcuts
 */

import type { KeyboardShortcut } from '../types';
import { crossPlatformBinding, universalBinding } from '@mog-sdk/kernel/keyboard';

export const VIEW_SHORTCUTS: KeyboardShortcut[] = [
  // ===========================================================================
  // Zoom
  // ===========================================================================

  {
    id: 'zoom-in',
    // Ctrl+= (Equal key without Shift = '=')
    // This is DIFFERENT from Ctrl+Shift+= which is Insert Cells
    bindings: crossPlatformBinding('Equal', 'ctrl'),
    description: 'Zoom in',
    action: 'ZOOM_IN',
    enabled: true,
    priority: 'medium',
    category: 'view',
    contexts: ['any'],
    muscleMemory: 'common',
    browserConflict: {
      conflictsWith: 'Browser zoom in',
      policy: 'override',
    },
    matchBy: 'code',
  },
  {
    id: 'zoom-out',
    // Ctrl+Minus (browser zoom out)
    // Note: Shares binding with delete-cells (Ctrl+Minus in 'grid' context).
    // delete-cells has context 'grid' and higher priority, so it wins in grid.
    bindings: crossPlatformBinding('Minus', 'ctrl'),
    description: 'Zoom out',
    action: 'ZOOM_OUT',
    enabled: true,
    priority: 'medium',
    category: 'view',
    contexts: ['any'],
    muscleMemory: 'common',
    browserConflict: {
      conflictsWith: 'Browser zoom out',
      policy: 'override',
    },
    matchBy: 'code',
  },
  {
    id: 'zoom-reset',
    // Ctrl+0 - Reset zoom to 100%
    bindings: crossPlatformBinding('Digit0', 'ctrl'),
    description: 'Reset zoom to 100%',
    action: 'ZOOM_RESET',
    enabled: true,
    priority: 'medium',
    category: 'view',
    contexts: ['any'],
    muscleMemory: 'common',
    browserConflict: {
      conflictsWith: 'Reset browser zoom',
      policy: 'override',
    },
    matchBy: 'code',
  },

  // ===========================================================================
  // Hide/Unhide Rows and Columns
  // ===========================================================================

  {
    id: 'hide-column',
    // Ctrl+0 - Digit0 key (Excel behavior: hides selected column)
    // Note: Shares binding with zoom-reset. In 'grid' context with a column
    // selected, HIDE_COLUMN takes precedence. zoom-reset uses 'any' context.
    bindings: crossPlatformBinding('Digit0', 'ctrl'),
    description: 'Hide column',
    action: 'HIDE_COLUMN',
    enabled: true,
    priority: 'high',
    category: 'view',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes:
      'In Excel, Ctrl+0 hides selected column. Shares key with zoom-reset; higher priority in grid context.',
  },
  {
    id: 'hide-row',
    // Ctrl+9 - Digit9 key
    bindings: crossPlatformBinding('Digit9', 'ctrl'),
    description: 'Hide row',
    action: 'HIDE_ROW',
    enabled: true,
    priority: 'medium',
    category: 'view',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'unhide-row',
    // Ctrl+Shift+9 - Digit9 with Shift
    bindings: crossPlatformBinding('Digit9', 'ctrl', 'shift'),
    description: 'Unhide row',
    action: 'UNHIDE_ROW',
    enabled: true,
    priority: 'medium',
    category: 'view',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'unhide-column',
    // Ctrl+Shift+0 - Digit0 with Shift
    bindings: crossPlatformBinding('Digit0', 'ctrl', 'shift'),
    description: 'Unhide column',
    action: 'UNHIDE_COLUMN',
    enabled: true,
    priority: 'medium',
    category: 'view',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },

  // ===========================================================================
  // Ribbon Visibility
  // ===========================================================================

  {
    id: 'toggle-ribbon',
    bindings: crossPlatformBinding('F1', 'ctrl', 'shift'),
    description: 'Toggle ribbon visibility (collapse/expand)',
    action: 'TOGGLE_RIBBON',
    enabled: true,
    priority: 'low',
    category: 'view',
    contexts: ['any'],
    muscleMemory: 'rare',
    matchBy: 'code',
  },
  {
    id: 'toggle-ribbon-tabs-mode',
    bindings: crossPlatformBinding('F1', 'ctrl'),
    description: 'Toggle ribbon tabs mode (Show Tabs vs Show Tabs and Commands)',
    action: 'TOGGLE_RIBBON_TABS_MODE',
    enabled: true,
    priority: 'low',
    category: 'view',
    contexts: ['any'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },

  // ===========================================================================
  // Full Screen
  // ===========================================================================

  {
    id: 'full-screen',
    bindings: universalBinding('F11'),
    description: 'Full screen (browser)',
    action: 'FULL_SCREEN',
    enabled: false, // Deferred to browser
    priority: 'low',
    category: 'view',
    contexts: ['any'],
    muscleMemory: 'occasional',
    browserConflict: {
      conflictsWith: 'Browser full screen',
      policy: 'defer',
    },
    matchBy: 'code',
  },

  // ===========================================================================
  // Page Break Preview
  // ===========================================================================

  {
    id: 'toggle-page-break-preview',
    // NOTE: Page Break Preview has no standard keyboard shortcut in Excel.
    // It is accessed via the ribbon (Alt+W,I). The previous Ctrl+Shift+F2
    // binding was incorrect and collided with open-threaded-comments.
    // Using Ctrl+Shift+F7 as a non-conflicting placeholder until
    // ribbon key sequence support is implemented.
    bindings: crossPlatformBinding('F7', 'ctrl', 'shift'),
    description: 'Toggle Page Break Preview mode',
    action: 'TOGGLE_PAGE_BREAK_PREVIEW',
    enabled: false, // Not yet implemented; needs ribbon key sequence (Alt+W,I)
    priority: 'medium',
    category: 'view',
    contexts: ['any'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes:
      'Toggle between Normal view and Page Break Preview for adjusting page breaks before printing. Correct access is via ribbon Alt+W,I — no standard keyboard shortcut exists.',
  },

  // ===========================================================================
  // Help
  // ===========================================================================

  {
    id: 'open-help',
    bindings: universalBinding('F1'),
    description: 'Open Help',
    action: 'OPEN_HELP',
    enabled: true,
    priority: 'medium',
    category: 'view',
    contexts: ['any'],
    muscleMemory: 'common',
    matchBy: 'code',
    notes: 'F1 opens help documentation',
  },

  // ===========================================================================
  // Outline Symbols / Object Visibility
  // ===========================================================================

  {
    id: 'toggle-outline-symbols',
    // Ctrl+8 - Digit8 key
    bindings: crossPlatformBinding('Digit8', 'ctrl'),
    description: 'Toggle outline symbols visibility',
    action: 'TOGGLE_OUTLINE_SYMBOLS',
    enabled: true,
    priority: 'low',
    category: 'view',
    contexts: ['grid'],
    muscleMemory: 'rare',
    matchBy: 'code',
    notes: 'Shows or hides the outline symbols (+/- buttons) for grouped rows/columns',
  },
  {
    id: 'toggle-objects-visibility',
    // Ctrl+6 - Digit6 key
    bindings: crossPlatformBinding('Digit6', 'ctrl'),
    description: 'Toggle object visibility',
    action: 'TOGGLE_OBJECTS_VISIBILITY',
    enabled: true,
    priority: 'low',
    category: 'view',
    contexts: ['any'],
    muscleMemory: 'rare',
    matchBy: 'code',
    notes: 'Cycles between showing objects, showing placeholders, and hiding all objects',
  },

  // ===========================================================================
  // Command Palette
  // ===========================================================================

  {
    id: 'open-command-palette',
    bindings: crossPlatformBinding('KeyP', 'ctrl', 'shift'),
    description: 'Open command palette',
    action: 'OPEN_COMMAND_PALETTE',
    enabled: true,
    priority: 'high',
    category: 'view',
    contexts: ['global'],
    muscleMemory: 'common',
    matchBy: 'key',
    expectedCharacter: 'p',
  },

  // ===========================================================================
  // Scroll Lock
  // ===========================================================================

  {
    id: 'view.toggle-scroll-lock',
    bindings: universalBinding('ScrollLock'),
    matchBy: 'code',
    description: 'Toggle Scroll Lock',
    action: 'TOGGLE_SCROLL_LOCK',
    contexts: ['grid'],
    category: 'view',
    priority: 'medium',
    muscleMemory: 'rare',
    enabled: true,
    allowRepeat: false,
  },
  {
    id: 'view.toggle-scroll-lock-alt',
    bindings: crossPlatformBinding('KeyL', 'ctrl', 'alt'),
    matchBy: 'code',
    description: 'Toggle Scroll Lock (alternative)',
    action: 'TOGGLE_SCROLL_LOCK',
    contexts: ['grid'],
    category: 'view',
    priority: 'medium',
    muscleMemory: 'rare',
    enabled: true,
    allowRepeat: false,
  },

  // ===========================================================================
  // Extension Panel
  // ===========================================================================

  {
    id: 'view.toggle-extension-panel',
    bindings: crossPlatformBinding('KeyE', 'ctrl', 'shift'),
    matchBy: 'key',
    expectedCharacter: 'e',
    description: 'Toggle Extension Panel',
    action: 'TOGGLE_EXTENSION_PANEL',
    contexts: ['global'],
    category: 'view',
    priority: 'medium',
    muscleMemory: 'rare',
    enabled: true,
    allowRepeat: false,
  },
];
