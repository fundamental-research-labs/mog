/**
 * Navigation Keyboard Shortcuts (Unified v2)
 *
 * Physical-key-based shortcuts for moving around the spreadsheet:
 * - Arrow key navigation
 * - Ctrl+Arrow (jump to data edges)
 * - Home/End navigation
 * - Page navigation
 * - Tab/Enter navigation
 * - Sheet navigation
 * - Pane navigation (F6)
 * - Go To dialogs
 *
 * Total: 33 shortcuts
 */

import type { KeyboardShortcut } from '../types';
import {
  altBinding,
  crossPlatformBinding,
  macSpecificBinding,
  universalBinding,
} from '@mog-sdk/kernel/keyboard';

export const NAVIGATION_SHORTCUTS: KeyboardShortcut[] = [
  // ===========================================================================
  // Arrow Keys (grid context - in editing, arrows have different behavior)
  // ===========================================================================

  {
    id: 'move-up',
    bindings: universalBinding('ArrowUp'),
    description: 'Move up one cell',
    action: 'MOVE_UP',
    enabled: true,
    priority: 'critical',
    category: 'navigation',
    contexts: ['grid'],
    muscleMemory: 'essential',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'move-down',
    bindings: universalBinding('ArrowDown'),
    description: 'Move down one cell',
    action: 'MOVE_DOWN',
    enabled: true,
    priority: 'critical',
    category: 'navigation',
    contexts: ['grid'],
    muscleMemory: 'essential',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'move-left',
    bindings: universalBinding('ArrowLeft'),
    description: 'Move left one cell',
    action: 'MOVE_LEFT',
    enabled: true,
    priority: 'critical',
    category: 'navigation',
    contexts: ['grid'],
    muscleMemory: 'essential',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'move-right',
    bindings: universalBinding('ArrowRight'),
    description: 'Move right one cell',
    action: 'MOVE_RIGHT',
    enabled: true,
    priority: 'critical',
    category: 'navigation',
    contexts: ['grid'],
    muscleMemory: 'essential',
    matchBy: 'code',
    allowRepeat: true,
  },

  // ===========================================================================
  // Ctrl+Arrow (jump to edge of data region)
  // ===========================================================================

  {
    id: 'move-to-edge-up',
    bindings: crossPlatformBinding('ArrowUp', 'ctrl'),
    description: 'Move to top edge of data region',
    action: 'MOVE_TO_EDGE_UP',
    enabled: true,
    priority: 'critical',
    category: 'navigation',
    contexts: ['grid'],
    muscleMemory: 'essential',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'move-to-edge-down',
    bindings: crossPlatformBinding('ArrowDown', 'ctrl'),
    description: 'Move to bottom edge of data region',
    action: 'MOVE_TO_EDGE_DOWN',
    enabled: true,
    priority: 'critical',
    category: 'navigation',
    contexts: ['grid'],
    muscleMemory: 'essential',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'move-to-edge-left',
    bindings: crossPlatformBinding('ArrowLeft', 'ctrl'),
    description: 'Move to left edge of data region',
    action: 'MOVE_TO_EDGE_LEFT',
    enabled: true,
    priority: 'critical',
    category: 'navigation',
    contexts: ['grid'],
    muscleMemory: 'essential',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'move-to-edge-right',
    bindings: crossPlatformBinding('ArrowRight', 'ctrl'),
    description: 'Move to right edge of data region',
    action: 'MOVE_TO_EDGE_RIGHT',
    enabled: true,
    priority: 'critical',
    category: 'navigation',
    contexts: ['grid'],
    muscleMemory: 'essential',
    matchBy: 'code',
    allowRepeat: true,
  },

  // ===========================================================================
  // Home/End Navigation
  // ===========================================================================

  {
    id: 'move-to-row-start',
    bindings: universalBinding('Home'),
    description: 'Move to column A in current row',
    action: 'MOVE_TO_ROW_START',
    enabled: true,
    priority: 'critical',
    category: 'navigation',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'move-to-a1',
    bindings: crossPlatformBinding('Home', 'ctrl'),
    description: 'Move to cell A1',
    action: 'MOVE_TO_A1',
    enabled: true,
    priority: 'critical',
    category: 'navigation',
    contexts: ['grid'],
    muscleMemory: 'essential',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'toggle-end-mode',
    bindings: universalBinding('End'),
    description: 'Toggle End mode - next arrow navigates to data boundary',
    action: 'ACTIVATE_END_MODE',
    enabled: true,
    priority: 'high',
    category: 'navigation',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
    notes:
      'End key toggles End mode. Status bar shows "END". Next arrow key navigates to data boundary (like Ctrl+Arrow) then deactivates End mode.',
  },
  {
    id: 'move-to-last-used-cell',
    bindings: crossPlatformBinding('End', 'ctrl'),
    description: 'Move to last used cell',
    action: 'MOVE_TO_LAST_USED_CELL',
    enabled: true,
    priority: 'high',
    category: 'navigation',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
    allowRepeat: true,
  },

  // ===========================================================================
  // Page Navigation
  // ===========================================================================

  {
    id: 'page-up',
    bindings: universalBinding('PageUp'),
    description: 'Move up one screen',
    action: 'PAGE_UP',
    enabled: true,
    priority: 'high',
    category: 'navigation',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'page-down',
    bindings: universalBinding('PageDown'),
    description: 'Move down one screen',
    action: 'PAGE_DOWN',
    enabled: true,
    priority: 'high',
    category: 'navigation',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'page-left',
    bindings: altBinding('PageUp'),
    description: 'Move left one screen',
    action: 'PAGE_LEFT',
    enabled: true,
    priority: 'medium',
    category: 'navigation',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    allowRepeat: true,
  },
  {
    id: 'page-right',
    bindings: altBinding('PageDown'),
    description: 'Move right one screen',
    action: 'PAGE_RIGHT',
    enabled: true,
    priority: 'medium',
    category: 'navigation',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    allowRepeat: true,
  },

  // ===========================================================================
  // Tab/Enter Navigation
  // ===========================================================================

  {
    id: 'tab-forward',
    bindings: universalBinding('Tab'),
    description: 'Move right one cell',
    action: 'TAB_FORWARD',
    enabled: true,
    priority: 'critical',
    category: 'navigation',
    contexts: ['grid'],
    muscleMemory: 'essential',
    matchBy: 'code',
  },
  {
    id: 'tab-backward',
    bindings: universalBinding('Tab', 'shift'),
    description: 'Move left one cell',
    action: 'TAB_BACKWARD',
    enabled: true,
    priority: 'critical',
    category: 'navigation',
    contexts: ['grid'],
    muscleMemory: 'essential',
    matchBy: 'code',
  },
  {
    id: 'enter-navigate',
    bindings: universalBinding('Enter'),
    description: 'Move down one cell (or per settings)',
    action: 'ENTER_NAVIGATE',
    enabled: true,
    priority: 'critical',
    category: 'navigation',
    contexts: ['grid'],
    muscleMemory: 'essential',
    matchBy: 'code',
  },
  {
    id: 'shift-enter-navigate',
    bindings: universalBinding('Enter', 'shift'),
    description: 'Move up one cell (or reverse of settings)',
    action: 'SHIFT_ENTER_NAVIGATE',
    enabled: true,
    priority: 'critical',
    category: 'navigation',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
  },

  // ===========================================================================
  // Go To Dialogs
  // ===========================================================================

  {
    id: 'open-go-to-dialog',
    bindings: crossPlatformBinding('KeyG', 'ctrl'),
    description: 'Open Go To dialog',
    action: 'OPEN_GO_TO_DIALOG',
    enabled: true,
    priority: 'high',
    category: 'navigation',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'key',
    expectedCharacter: 'g',
  },
  {
    id: 'open-go-to-dialog-f5',
    bindings: universalBinding('F5'),
    description: 'Open Go To dialog',
    action: 'OPEN_GO_TO_DIALOG',
    enabled: true,
    priority: 'high',
    category: 'navigation',
    contexts: ['grid'],
    muscleMemory: 'common',
    browserConflict: {
      conflictsWith: 'Browser refresh',
      policy: 'override',
      workaround: 'Browser refresh via Ctrl+R still works',
    },
    matchBy: 'code',
  },
  {
    id: 'open-go-to-special-dialog',
    bindings: crossPlatformBinding('KeyP', 'ctrl', 'shift'),
    description: 'Open Go To Special dialog',
    action: 'OPEN_GO_TO_SPECIAL_DIALOG',
    enabled: true,
    priority: 'medium',
    category: 'navigation',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'key',
    expectedCharacter: 'p',
  },

  // ===========================================================================
  // Context Menu Invocation
  // ===========================================================================

  {
    id: 'invoke-context-menu-shift-f10',
    bindings: universalBinding('F10', 'shift'),
    description: 'Open context menu',
    action: 'INVOKE_CONTEXT_MENU',
    enabled: true,
    priority: 'high',
    category: 'navigation',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
    notes: 'WCAG 2.1 AA accessibility requirement - keyboard access to context menu',
  },
  {
    id: 'invoke-context-menu-key',
    bindings: universalBinding('ContextMenu'),
    description: 'Open context menu (Menu key)',
    action: 'INVOKE_CONTEXT_MENU',
    enabled: true,
    priority: 'high',
    category: 'navigation',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
    notes: 'Context menu key on Windows keyboards',
  },

  // ===========================================================================
  // Sheet Navigation
  // ===========================================================================

  {
    id: 'previous-sheet',
    bindings: crossPlatformBinding('PageUp', 'ctrl'),
    description: 'Move to previous sheet',
    action: 'PREVIOUS_SHEET',
    enabled: true,
    priority: 'high',
    category: 'navigation',
    contexts: ['any'],
    muscleMemory: 'common',
    matchBy: 'code',
  },
  {
    id: 'next-sheet',
    bindings: crossPlatformBinding('PageDown', 'ctrl'),
    description: 'Move to next sheet',
    action: 'NEXT_SHEET',
    enabled: true,
    priority: 'high',
    category: 'navigation',
    contexts: ['any'],
    muscleMemory: 'common',
    matchBy: 'code',
  },

  // ===========================================================================
  // Pane Navigation (F6)
  // ===========================================================================

  {
    id: 'focus-next-pane',
    bindings: universalBinding('F6'),
    description: 'Move to next pane (toolbar, formula bar, grid, status bar)',
    action: 'FOCUS_NEXT_PANE',
    enabled: true,
    priority: 'medium',
    category: 'navigation',
    contexts: ['any'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel parity quickwin E1: Cycles through panes',
  },
  {
    id: 'focus-previous-pane',
    bindings: universalBinding('F6', 'shift'),
    description: 'Move to previous pane',
    action: 'FOCUS_PREVIOUS_PANE',
    enabled: true,
    priority: 'medium',
    category: 'navigation',
    contexts: ['any'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Excel parity quickwin E1: Cycles backward through panes',
  },

  // ===========================================================================
  // Scroll to Active Cell
  // ===========================================================================

  {
    id: 'scroll-to-active-cell',
    bindings: crossPlatformBinding('Backspace', 'ctrl'),
    description: 'Scroll to active cell',
    action: 'SCROLL_TO_ACTIVE_CELL',
    enabled: true,
    priority: 'medium',
    category: 'navigation',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes:
      'Excel parity quickwin E4: Scrolls viewport to show active cell without changing selection',
  },

  // ===========================================================================
  // KeyTips
  // ===========================================================================

  {
    id: 'activate-ribbon-keytips',
    bindings: universalBinding('F10'),
    description: 'Activate KeyTips (Alt-key ribbon navigation)',
    action: 'ACTIVATE_RIBBON_KEYTIPS',
    enabled: true,
    priority: 'high',
    category: 'navigation',
    contexts: ['any'],
    muscleMemory: 'common',
    matchBy: 'code',
    notes:
      'Handled directly by KeyTipContext, not keyboard-coordinator. Firefox conflict: F10 opens browser menu.',
  },

  // ===========================================================================
  // Chart Navigation (objectSelected context)
  // ===========================================================================

  {
    id: 'cycle-next-chart',
    bindings: universalBinding('Tab'),
    description: 'Cycle to next chart on sheet',
    action: 'CYCLE_NEXT_CHART',
    enabled: true,
    priority: 'medium',
    category: 'navigation',
    contexts: ['objectSelected'],
    muscleMemory: 'common',
    matchBy: 'code',
    notes: 'Tab cycles through charts on current sheet',
  },
  {
    id: 'cycle-previous-chart',
    bindings: universalBinding('Tab', 'shift'),
    description: 'Cycle to previous chart on sheet',
    action: 'CYCLE_PREVIOUS_CHART',
    enabled: true,
    priority: 'medium',
    category: 'navigation',
    contexts: ['objectSelected'],
    muscleMemory: 'common',
    matchBy: 'code',
    notes: 'Shift+Tab cycles backward through charts',
  },

  // ===========================================================================
  // Search / Tell Me Box
  // ===========================================================================

  {
    id: 'open-search-box',
    // Windows/Linux: Alt+Q, Mac: Cmd+F6
    // Uses matchBy:'code' because Mac binding is an F-key (F6 produces event.key='F6',
    // not a letter character). matchBy:'key' with expectedCharacter:'q' would never match
    // on Mac since Cmd+F6 yields key='F6', not 'q'. Code-based matching works for both:
    // F6 is layout-independent, and KeyQ's physical position is acceptable for this
    // occasional shortcut even on non-QWERTY layouts.
    bindings: macSpecificBinding('KeyQ', ['alt'], 'F6', ['meta']),
    description: 'Open Search / Tell Me box',
    action: 'OPEN_SEARCH_BOX',
    enabled: true,
    priority: 'medium',
    category: 'navigation',
    contexts: ['any'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Opens the Search or Tell Me field for command search',
  },
];
