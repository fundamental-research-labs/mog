/**
 * Timeline View Keyboard Shortcuts
 *
 * Shortcuts for interacting with the Timeline view:
 * - Delete/Backspace to remove selected items
 * - Escape to clear selection
 * - Ctrl+A / Cmd+A to select all items
 *
 * Total: 4 shortcuts
 */

import type { KeyboardShortcut } from '../types';
import { crossPlatformBinding, universalBinding } from '@mog-sdk/kernel/keyboard';

export const TIMELINE_SHORTCUTS: KeyboardShortcut[] = [
  // ===========================================================================
  // Actions
  // ===========================================================================

  {
    id: 'timeline.delete',
    bindings: universalBinding('Delete'),
    matchBy: 'code',
    description: 'Delete selected item',
    action: 'TIMELINE_DELETE',
    contexts: ['timeline'],
    category: 'editing',
    priority: 'medium',
    muscleMemory: 'common',
    enabled: true,
  },
  {
    id: 'timeline.delete-backspace',
    bindings: universalBinding('Backspace'),
    matchBy: 'code',
    description: 'Delete selected item',
    action: 'TIMELINE_DELETE',
    contexts: ['timeline'],
    category: 'editing',
    priority: 'medium',
    muscleMemory: 'common',
    enabled: true,
  },
  {
    id: 'timeline.deselect',
    bindings: universalBinding('Escape'),
    matchBy: 'code',
    description: 'Clear selection',
    action: 'TIMELINE_DESELECT',
    contexts: ['timeline'],
    category: 'navigation',
    priority: 'medium',
    muscleMemory: 'common',
    enabled: true,
  },
  {
    id: 'timeline.select-all',
    bindings: crossPlatformBinding('KeyA', 'ctrl'),
    matchBy: 'key',
    expectedCharacter: 'a',
    description: 'Select all items',
    action: 'TIMELINE_SELECT_ALL',
    contexts: ['timeline'],
    category: 'selection',
    priority: 'medium',
    muscleMemory: 'common',
    enabled: true,
  },
];
