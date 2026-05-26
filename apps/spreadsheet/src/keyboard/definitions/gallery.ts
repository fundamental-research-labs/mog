/**
 * Gallery View Keyboard Shortcuts
 *
 * Shortcuts for navigating and interacting with the Gallery card view:
 * - Arrow key navigation between cards
 * - Enter to edit, Delete/Backspace to remove cards
 * - Escape to clear selection
 * - Ctrl+A / Cmd+A to select all cards
 *
 * Total: 9 shortcuts
 */

import type { KeyboardShortcut } from '../types';
import { crossPlatformBinding, universalBinding } from '@mog-sdk/kernel/keyboard';

export const GALLERY_SHORTCUTS: KeyboardShortcut[] = [
  // ===========================================================================
  // Arrow Navigation
  // ===========================================================================

  {
    id: 'gallery.move-up',
    bindings: universalBinding('ArrowUp'),
    matchBy: 'code',
    description: 'Move selection up',
    action: 'GALLERY_MOVE_UP',
    contexts: ['gallery'],
    category: 'navigation',
    priority: 'medium',
    muscleMemory: 'common',
    enabled: true,
    allowRepeat: true,
  },
  {
    id: 'gallery.move-down',
    bindings: universalBinding('ArrowDown'),
    matchBy: 'code',
    description: 'Move selection down',
    action: 'GALLERY_MOVE_DOWN',
    contexts: ['gallery'],
    category: 'navigation',
    priority: 'medium',
    muscleMemory: 'common',
    enabled: true,
    allowRepeat: true,
  },
  {
    id: 'gallery.move-left',
    bindings: universalBinding('ArrowLeft'),
    matchBy: 'code',
    description: 'Move to previous card',
    action: 'GALLERY_MOVE_LEFT',
    contexts: ['gallery'],
    category: 'navigation',
    priority: 'medium',
    muscleMemory: 'common',
    enabled: true,
    allowRepeat: true,
  },
  {
    id: 'gallery.move-right',
    bindings: universalBinding('ArrowRight'),
    matchBy: 'code',
    description: 'Move to next card',
    action: 'GALLERY_MOVE_RIGHT',
    contexts: ['gallery'],
    category: 'navigation',
    priority: 'medium',
    muscleMemory: 'common',
    enabled: true,
    allowRepeat: true,
  },

  // ===========================================================================
  // Actions
  // ===========================================================================

  {
    id: 'gallery.edit',
    bindings: universalBinding('Enter'),
    matchBy: 'code',
    description: 'Edit selected card',
    action: 'GALLERY_EDIT',
    contexts: ['gallery'],
    category: 'editing',
    priority: 'medium',
    muscleMemory: 'common',
    enabled: true,
  },
  {
    id: 'gallery.delete',
    bindings: universalBinding('Delete'),
    matchBy: 'code',
    description: 'Delete selected card',
    action: 'GALLERY_DELETE',
    contexts: ['gallery'],
    category: 'editing',
    priority: 'medium',
    muscleMemory: 'common',
    enabled: true,
  },
  {
    id: 'gallery.delete-backspace',
    bindings: universalBinding('Backspace'),
    matchBy: 'code',
    description: 'Delete selected card',
    action: 'GALLERY_DELETE',
    contexts: ['gallery'],
    category: 'editing',
    priority: 'medium',
    muscleMemory: 'common',
    enabled: true,
  },
  {
    id: 'gallery.deselect',
    bindings: universalBinding('Escape'),
    matchBy: 'code',
    description: 'Clear selection',
    action: 'GALLERY_DESELECT',
    contexts: ['gallery'],
    category: 'navigation',
    priority: 'medium',
    muscleMemory: 'common',
    enabled: true,
  },
  {
    id: 'gallery.select-all',
    bindings: crossPlatformBinding('KeyA', 'ctrl'),
    matchBy: 'key',
    expectedCharacter: 'a',
    description: 'Select all cards',
    action: 'GALLERY_SELECT_ALL',
    contexts: ['gallery'],
    category: 'selection',
    priority: 'medium',
    muscleMemory: 'common',
    enabled: true,
  },
];
