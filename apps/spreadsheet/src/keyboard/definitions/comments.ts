/**
 * Comments Keyboard Shortcuts (Unified v2)
 *
 * Physical-key-based shortcuts for comment operations:
 * - Insert/Edit comment (Shift+F2)
 * - Show/Hide comments
 * - Google Sheets style (Ctrl+Alt+M)
 *
 * Total: 4 shortcuts
 */

import type { KeyboardShortcut } from '../types';
import { binding, crossPlatformBinding, universalBinding } from '@mog-sdk/kernel/keyboard';

export const COMMENTS_SHORTCUTS: KeyboardShortcut[] = [
  // ===========================================================================
  // Insert/Edit Comment
  // ===========================================================================

  {
    id: 'insert-comment',
    bindings: universalBinding('F2', 'shift'),
    description: 'Insert/Edit Comment',
    action: 'EDIT_COMMENT',
    enabled: true,
    priority: 'high',
    category: 'comments',
    contexts: ['grid'],
    muscleMemory: 'common',
    matchBy: 'code',
    notes:
      'Opens comment editor. If cell has comment, edits existing; otherwise creates new comment. Excel Shift+F2 traditionally opened Notes, but we use Comments only.',
  },

  // ===========================================================================
  // Show/Hide Comments
  // ===========================================================================

  {
    id: 'show-hide-comments',
    bindings: crossPlatformBinding('KeyO', 'ctrl', 'shift'),
    description: 'Show/Hide all comments',
    action: 'SHOW_HIDE_COMMENTS',
    enabled: true,
    priority: 'medium',
    category: 'comments',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'key',
    expectedCharacter: 'o',
    notes:
      'Toggles visibility of all comment indicators. ' +
      'NOTE: In desktop Excel, Ctrl+Shift+O selects cells containing comments (Go To Special > Comments), ' +
      'not show/hide. We deliberately deviate here to provide a more useful toggle-visibility action ' +
      'since Go To Special can be accessed via Ctrl+G > Special.',
  },

  // ===========================================================================
  // Google Sheets Style
  // ===========================================================================

  {
    id: 'insert-comment-google',
    // Ctrl+Alt+M / Cmd+Option+M
    bindings: {
      default: binding('KeyM', 'alt', 'ctrl'),
      macos: binding('KeyM', 'alt', 'meta'),
    },
    description: 'New Comment (Google Sheets style)',
    action: 'INSERT_COMMENT',
    enabled: true,
    priority: 'medium',
    category: 'comments',
    contexts: ['grid'],
    muscleMemory: 'occasional',
    matchBy: 'key',
    expectedCharacter: 'm',
    notes: 'Alternative shortcut for insert comment (Google Sheets compatibility)',
  },

  // ===========================================================================
  // Threaded Comments
  // ===========================================================================

  {
    id: 'open-threaded-comments',
    bindings: crossPlatformBinding('F2', 'ctrl', 'shift'),
    description: 'Open/close Threaded Comments pane',
    action: 'OPEN_THREADED_COMMENTS',
    enabled: true,
    priority: 'medium',
    category: 'comments',
    contexts: ['any'],
    muscleMemory: 'occasional',
    matchBy: 'code',
    notes: 'Opens or closes the Threaded Comments task pane',
  },
];
