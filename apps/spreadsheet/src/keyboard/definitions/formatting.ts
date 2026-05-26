/**
 * Formatting Keyboard Shortcuts (Unified v2)
 *
 * Physical-key-based shortcuts for cell formatting:
 * - Format Cells dialog
 * - Font style (bold, italic, underline, strikethrough)
 * - Number formats (using Shift+number keys)
 * - Font size
 * - Borders
 * - Conditional Formatting
 *
 * NOTE: Number format shortcuts like Ctrl+Shift+~ use shifted characters.
 * These work correctly with physical keys:
 * - Ctrl+Shift+~ = Ctrl+Shift+Backquote (physical key)
 * - Ctrl+Shift+! = Ctrl+Shift+Digit1 (physical key)
 *
 * Total: 20 shortcuts
 */

import type { KeyboardShortcut } from '../types';
import { altBinding, crossPlatformBinding } from '@mog-sdk/kernel/keyboard';

export const FORMATTING_SHORTCUTS: KeyboardShortcut[] = [
  // ===========================================================================
  // Format Cells Dialog
  // ===========================================================================

  {
    id: 'open-format-cells-dialog',
    // Ctrl+1 - Digit1 key
    bindings: crossPlatformBinding('Digit1', 'ctrl'),
    description: 'Format Cells dialog',
    action: 'OPEN_FORMAT_CELLS_DIALOG',
    enabled: true,
    priority: 'high',
    category: 'formatting',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
  },

  // ===========================================================================
  // Font Style (Bold, Italic, Underline, Strikethrough)
  // ===========================================================================

  {
    id: 'toggle-bold',
    bindings: crossPlatformBinding('KeyB', 'ctrl'),
    description: 'Toggle bold',
    action: 'TOGGLE_BOLD',
    enabled: true,
    priority: 'critical',
    category: 'formatting',
    contexts: ['any'],
    muscleMemory: 'essential',
    matchBy: 'key',
    expectedCharacter: 'b',
  },
  {
    id: 'toggle-italic',
    bindings: crossPlatformBinding('KeyI', 'ctrl'),
    description: 'Toggle italic',
    action: 'TOGGLE_ITALIC',
    enabled: true,
    priority: 'critical',
    category: 'formatting',
    contexts: ['any'],
    muscleMemory: 'essential',
    matchBy: 'key',
    expectedCharacter: 'i',
  },
  {
    id: 'toggle-underline',
    bindings: crossPlatformBinding('KeyU', 'ctrl'),
    description: 'Toggle underline',
    action: 'TOGGLE_UNDERLINE',
    enabled: true,
    priority: 'critical',
    category: 'formatting',
    contexts: ['any'],
    muscleMemory: 'essential',
    matchBy: 'key',
    expectedCharacter: 'u',
  },
  {
    id: 'toggle-strikethrough',
    // Ctrl+5 - Digit5 key
    bindings: crossPlatformBinding('Digit5', 'ctrl'),
    description: 'Toggle strikethrough',
    action: 'TOGGLE_STRIKETHROUGH',
    enabled: true,
    priority: 'high',
    category: 'formatting',
    contexts: ['any'],
    muscleMemory: 'common',
    matchBy: 'code',
  },

  // ===========================================================================
  // Number Formats
  // These all use Ctrl+Shift+[key] pattern
  // ===========================================================================

  {
    id: 'format-general',
    // Ctrl+Shift+~ = Ctrl+Shift+Backquote
    // The ~ is Shift+Backquote on US keyboard
    bindings: crossPlatformBinding('Backquote', 'ctrl', 'shift'),
    description: 'General format',
    action: 'FORMAT_GENERAL',
    enabled: true,
    priority: 'high',
    category: 'formatting',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'format-number',
    // Ctrl+Shift+! = Ctrl+Shift+Digit1
    // The ! is Shift+Digit1 on US keyboard
    bindings: crossPlatformBinding('Digit1', 'ctrl', 'shift'),
    description: 'Number format (2 decimals, comma)',
    action: 'FORMAT_NUMBER',
    enabled: true,
    priority: 'high',
    category: 'formatting',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
  },
  {
    id: 'format-time',
    // Ctrl+Shift+@ = Ctrl+Shift+Digit2
    // The @ is Shift+Digit2 on US keyboard
    bindings: crossPlatformBinding('Digit2', 'ctrl', 'shift'),
    description: 'Time format',
    action: 'FORMAT_TIME',
    enabled: true,
    priority: 'high',
    category: 'formatting',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'format-date',
    // Ctrl+Shift+# = Ctrl+Shift+Digit3
    // The # is Shift+Digit3 on US keyboard
    bindings: crossPlatformBinding('Digit3', 'ctrl', 'shift'),
    description: 'Date format',
    action: 'FORMAT_DATE',
    enabled: true,
    priority: 'high',
    category: 'formatting',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
  },
  {
    id: 'format-currency',
    // Ctrl+Shift+$ = Ctrl+Shift+Digit4
    // The $ is Shift+Digit4 on US keyboard
    bindings: crossPlatformBinding('Digit4', 'ctrl', 'shift'),
    description: 'Currency format',
    action: 'FORMAT_CURRENCY',
    enabled: true,
    priority: 'high',
    category: 'formatting',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
  },
  {
    id: 'format-percentage',
    // Ctrl+Shift+% = Ctrl+Shift+Digit5
    // The % is Shift+Digit5 on US keyboard
    bindings: crossPlatformBinding('Digit5', 'ctrl', 'shift'),
    description: 'Percentage format',
    action: 'FORMAT_PERCENTAGE',
    enabled: true,
    priority: 'high',
    category: 'formatting',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
  },
  {
    id: 'format-scientific',
    // Ctrl+Shift+^ = Ctrl+Shift+Digit6
    // The ^ is Shift+Digit6 on US keyboard
    bindings: crossPlatformBinding('Digit6', 'ctrl', 'shift'),
    description: 'Scientific format',
    action: 'FORMAT_SCIENTIFIC',
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: ['grid'],
    muscleMemory: 'rare',
    matchBy: 'code',
  },

  // ===========================================================================
  // Font Size
  // ===========================================================================

  {
    id: 'increase-font-size',
    // Ctrl+Shift+. = Ctrl+Shift+Period
    // The > is Shift+Period, but we're using Period with Shift
    bindings: crossPlatformBinding('Period', 'ctrl', 'shift'),
    description: 'Increase font size',
    action: 'INCREASE_FONT_SIZE',
    enabled: true,
    priority: 'high',
    category: 'formatting',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
  },
  {
    id: 'decrease-font-size',
    // Ctrl+Shift+, = Ctrl+Shift+Comma
    // The < is Shift+Comma, but we're using Comma with Shift
    bindings: crossPlatformBinding('Comma', 'ctrl', 'shift'),
    description: 'Decrease font size',
    action: 'DECREASE_FONT_SIZE',
    enabled: true,
    priority: 'high',
    category: 'formatting',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
  },

  // ===========================================================================
  // Borders
  // ===========================================================================

  {
    id: 'apply-outline-border',
    // Ctrl+Shift+& = Ctrl+Shift+Digit7
    // The & is Shift+Digit7 on US keyboard
    bindings: crossPlatformBinding('Digit7', 'ctrl', 'shift'),
    description: 'Apply outline border',
    action: 'APPLY_OUTLINE_BORDER',
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },
  {
    id: 'remove-borders',
    // Ctrl+Shift+_ = Ctrl+Shift+Minus
    // The _ is Shift+Minus on US keyboard
    bindings: crossPlatformBinding('Minus', 'ctrl', 'shift'),
    description: 'Remove borders',
    action: 'REMOVE_BORDERS',
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
  },

  // ===========================================================================
  // Conditional Formatting (Alt+H,L)
  //
  // unified keytip router: the bare-Alt+letter stub entries that
  // used to live here (`open-cf-menu` on `altBinding('KeyH')` and
  // `open-cf-menu-legacy` on `altBinding('KeyO')`) were placeholders
  // that hijacked the Home and (legacy) Format ribbon-tab keys on
  // first keystroke. They have been replaced by the real chord
  // shortcut below, which uses 's `sequence` follow-on field so
  // `Alt+H` falls through to the ribbon-tab switch and `OPEN_CF_MENU`
  // only fires after the `KeyL` follow-on.
  //
  // Excel 365 removed the legacy `Alt+O,D` Format menu entirely, so
  // there is no `open-cf-menu-legacy` replacement; users press
  // `Alt+H,KeyL` (this entry) on modern Excel.
  // ===========================================================================

  {
    id: 'open-cf-menu',
    bindings: altBinding('KeyH'),
    sequence: ['KeyL'],
    description: 'Open Conditional Formatting menu (Alt+H,L)',
    action: 'OPEN_CF_MENU',
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: ['grid', 'keyTipMode'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes:
      'Excel 365: Home → L opens Conditional Formatting menu. unified keytip router migration.',
  },

  // ===========================================================================
  // Font Dialog
  // ===========================================================================

  {
    id: 'open-font-dialog',
    bindings: crossPlatformBinding('KeyF', 'ctrl', 'shift'),
    description: 'Open Format Cells dialog (Font tab)',
    action: 'OPEN_FONT_DIALOG',
    enabled: true,
    priority: 'medium',
    category: 'formatting',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'key',
    expectedCharacter: 'f',
    notes: 'Opens the Format Cells dialog with the Font tab pre-selected',
  },
];
