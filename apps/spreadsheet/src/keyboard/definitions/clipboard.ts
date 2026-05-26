/**
 * Clipboard Keyboard Shortcuts (Unified v2)
 *
 * Physical-key-based shortcuts for cut/copy/paste operations:
 * - Ctrl+C/X/V (copy, cut, paste)
 * - Paste Special dialogs
 * - Clear clipboard (Escape)
 * - Chart copy/cut/paste
 *
 * Total: 9 shortcuts
 */

import type { KeyboardShortcut } from '../types';
import { crossPlatformBinding, universalBinding } from '@mog-sdk/kernel/keyboard';

export const CLIPBOARD_SHORTCUTS: KeyboardShortcut[] = [
  // ===========================================================================
  // Chart Clipboard Operations — registered FIRST so they win the tie-break
  // over generic copy/cut/paste in objectSelected context (same priority).
  // The ShortcutMatcher performs stable sort by priority then registration
  // order, so earlier entries win when both context + modifiers match.
  // ===========================================================================

  {
    id: 'copy-chart',
    bindings: crossPlatformBinding('KeyC', 'ctrl'),
    description: 'Copy selected chart',
    action: 'COPY_CHART',
    enabled: true,
    priority: 'critical',
    category: 'clipboard',
    contexts: ['objectSelected'],
    muscleMemory: 'essential',
    matchBy: 'key',
    expectedCharacter: 'c',
    notes: 'Copies chart to clipboard when chart is selected',
  },
  {
    id: 'cut-chart',
    bindings: crossPlatformBinding('KeyX', 'ctrl'),
    description: 'Cut selected chart',
    action: 'CUT_CHART',
    enabled: true,
    priority: 'critical',
    category: 'clipboard',
    contexts: ['objectSelected'],
    muscleMemory: 'essential',
    matchBy: 'key',
    expectedCharacter: 'x',
    notes: 'Cuts chart to clipboard when chart is selected',
  },

  // ===========================================================================
  // Standard Clipboard Operations — come after chart variants so that
  // copy/cut-chart win in objectSelected context. In grid/any context the
  // chart shortcuts do NOT match, so these are still the only candidates.
  // ===========================================================================

  {
    id: 'copy',
    bindings: crossPlatformBinding('KeyC', 'ctrl'),
    description: 'Copy',
    action: 'COPY',
    enabled: true,
    priority: 'critical',
    category: 'clipboard',
    contexts: ['any'],
    muscleMemory: 'essential',
    matchBy: 'key',
    expectedCharacter: 'c',
  },
  {
    id: 'cut',
    bindings: crossPlatformBinding('KeyX', 'ctrl'),
    description: 'Cut',
    action: 'CUT',
    enabled: true,
    priority: 'critical',
    category: 'clipboard',
    contexts: ['any'],
    muscleMemory: 'essential',
    matchBy: 'key',
    expectedCharacter: 'x',
  },
  {
    id: 'paste',
    bindings: crossPlatformBinding('KeyV', 'ctrl'),
    description: 'Paste',
    action: 'PASTE',
    enabled: true,
    priority: 'critical',
    category: 'clipboard',
    contexts: ['any'],
    muscleMemory: 'essential',
    matchBy: 'key',
    expectedCharacter: 'v',
  },

  // ===========================================================================
  // Paste Special
  // ===========================================================================

  {
    id: 'open-paste-special-dialog',
    bindings: crossPlatformBinding('KeyV', 'ctrl', 'shift'),
    description: 'Open Paste Special dialog',
    action: 'OPEN_PASTE_SPECIAL_DIALOG',
    enabled: true,
    priority: 'high',
    category: 'clipboard',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'key',
    expectedCharacter: 'v',
  },
  {
    id: 'open-paste-special-dialog-alt',
    // Ctrl+Alt+V (Cmd+Option+V on macOS) — Excel's secondary binding for the
    // same dialog. Kept alongside the primary Ctrl+Shift+V so muscle memory
    // from either Excel for Windows or Excel for Mac users hits the dialog.
    bindings: {
      default: { code: 'KeyV', modifiers: ['alt', 'ctrl'] },
      macos: { code: 'KeyV', modifiers: ['alt', 'meta'] },
    },
    description: 'Open Paste Special dialog (alternative)',
    action: 'OPEN_PASTE_SPECIAL_DIALOG',
    enabled: true,
    priority: 'high',
    category: 'clipboard',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'key',
    expectedCharacter: 'v',
  },

  // ===========================================================================
  // Clear Clipboard
  // ===========================================================================

  {
    id: 'clear-clipboard',
    bindings: universalBinding('Escape'),
    description: 'Clear clipboard (stop marching ants)',
    action: 'CLEAR_CLIPBOARD',
    enabled: true,
    priority: 'high',
    category: 'clipboard',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
  },
];
