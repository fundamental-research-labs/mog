/**
 * Accessibility Keyboard Shortcuts (Unified v2)
 *
 * Physical-key-based shortcuts for accessibility features:
 * - Screen reader announcements
 * - Accessibility checker
 *
 * Total: 4 shortcuts
 */

import type { KeyboardShortcut } from '../types';
import { altBinding, crossPlatformBinding } from '@mog-sdk/kernel/keyboard';

export const ACCESSIBILITY_SHORTCUTS: KeyboardShortcut[] = [
  // ===========================================================================
  // Screen Reader Announcements
  // ===========================================================================

  {
    id: 'announce-cell-format',
    // Alt+Shift+F - F key with Alt+Shift
    bindings: altBinding('KeyF', 'shift'),
    description: 'Announce cell format for screen readers',
    action: 'ANNOUNCE_CELL_FORMAT',
    enabled: true,
    priority: 'medium',
    category: 'accessibility',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes:
      ' Accessibility: Announces font family, size, and formatting for screen readers. Uses UIStore accessibility slice to trigger live region announcement.',
  },

  // ===========================================================================
  // Accessibility Checker
  // ===========================================================================

  {
    id: 'check-accessibility',
    bindings: crossPlatformBinding('KeyA', 'ctrl', 'shift'),
    description: 'Check Accessibility',
    action: 'CHECK_ACCESSIBILITY',
    enabled: true,
    priority: 'medium',
    category: 'accessibility',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'key',
    expectedCharacter: 'a',
    notes:
      ' Accessibility Checker: Opens the accessibility checker panel to find and fix accessibility issues.',
  },

  // ===========================================================================
  // Read Active Cell (Screen Reader)
  // ===========================================================================

  {
    id: 'read-active-cell',
    // Ctrl+Alt+5 - Digit5 with Ctrl+Alt
    bindings: {
      default: { code: 'Digit5', modifiers: ['alt', 'ctrl'] },
      macos: { code: 'Digit5', modifiers: ['alt', 'meta'] },
    },
    description: 'Read active cell for screen readers',
    action: 'READ_ACTIVE_CELL',
    enabled: true,
    priority: 'medium',
    category: 'accessibility',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Announces the active cell content, position, and format for screen reader users',
  },

  // ===========================================================================
  // Accessibility Shortcut Guide
  // ===========================================================================

  {
    id: 'open-accessibility-guide',
    bindings: altBinding('KeyA', 'shift'),
    description: 'Show accessibility shortcuts guide',
    action: 'OPEN_ACCESSIBILITY_GUIDE',
    enabled: true,
    priority: 'medium',
    category: 'accessibility',
    contexts: ['any'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes:
      'Opens the accessibility shortcuts guide overlay showing all available keyboard shortcuts',
  },
];
