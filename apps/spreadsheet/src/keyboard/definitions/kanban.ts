/**
 * Kanban View Keyboard Shortcuts
 *
 * Shortcuts for navigating and interacting with the Kanban board view:
 * - Arrow key navigation between cards and columns
 * - Enter to edit, Delete/Backspace to remove cards
 * - Escape to clear selection
 * - N to create a new card
 * - Ctrl+A / Cmd+A to select all cards
 *
 * Total: 10 shortcuts
 */

import type { KeyboardShortcut } from '../types';
import { crossPlatformBinding, universalBinding } from '@mog-sdk/kernel/keyboard';

export const KANBAN_SHORTCUTS: KeyboardShortcut[] = [
  // ===========================================================================
  // Arrow Navigation
  // ===========================================================================

  {
    id: 'kanban.move-up',
    bindings: universalBinding('ArrowUp'),
    matchBy: 'code',
    description: 'Move selection up',
    action: 'KANBAN_MOVE_UP',
    contexts: ['kanban'],
    category: 'navigation',
    priority: 'medium',
    muscleMemory: 'common',
    enabled: true,
    allowRepeat: true,
  },
  {
    id: 'kanban.move-down',
    bindings: universalBinding('ArrowDown'),
    matchBy: 'code',
    description: 'Move selection down',
    action: 'KANBAN_MOVE_DOWN',
    contexts: ['kanban'],
    category: 'navigation',
    priority: 'medium',
    muscleMemory: 'common',
    enabled: true,
    allowRepeat: true,
  },
  {
    id: 'kanban.move-left',
    bindings: universalBinding('ArrowLeft'),
    matchBy: 'code',
    description: 'Move to previous column',
    action: 'KANBAN_MOVE_LEFT',
    contexts: ['kanban'],
    category: 'navigation',
    priority: 'medium',
    muscleMemory: 'common',
    enabled: true,
    allowRepeat: true,
  },
  {
    id: 'kanban.move-right',
    bindings: universalBinding('ArrowRight'),
    matchBy: 'code',
    description: 'Move to next column',
    action: 'KANBAN_MOVE_RIGHT',
    contexts: ['kanban'],
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
    id: 'kanban.edit',
    bindings: universalBinding('Enter'),
    matchBy: 'code',
    description: 'Edit selected card',
    action: 'KANBAN_EDIT',
    contexts: ['kanban'],
    category: 'editing',
    priority: 'medium',
    muscleMemory: 'common',
    enabled: true,
  },
  {
    id: 'kanban.delete',
    bindings: universalBinding('Delete'),
    matchBy: 'code',
    description: 'Delete selected card',
    action: 'KANBAN_DELETE',
    contexts: ['kanban'],
    category: 'editing',
    priority: 'medium',
    muscleMemory: 'common',
    enabled: true,
  },
  {
    id: 'kanban.delete-backspace',
    bindings: universalBinding('Backspace'),
    matchBy: 'code',
    description: 'Delete selected card',
    action: 'KANBAN_DELETE',
    contexts: ['kanban'],
    category: 'editing',
    priority: 'medium',
    muscleMemory: 'common',
    enabled: true,
  },
  {
    id: 'kanban.deselect',
    bindings: universalBinding('Escape'),
    matchBy: 'code',
    description: 'Clear selection',
    action: 'KANBAN_DESELECT',
    contexts: ['kanban'],
    category: 'navigation',
    priority: 'medium',
    muscleMemory: 'common',
    enabled: true,
  },
  {
    id: 'kanban.new-card',
    bindings: universalBinding('KeyN'),
    matchBy: 'code',
    description: 'Add new card',
    action: 'KANBAN_NEW_CARD',
    contexts: ['kanban'],
    category: 'editing',
    priority: 'medium',
    muscleMemory: 'rare',
    enabled: true,
  },
  {
    id: 'kanban.select-all',
    bindings: crossPlatformBinding('KeyA', 'ctrl'),
    matchBy: 'key',
    expectedCharacter: 'a',
    description: 'Select all cards',
    action: 'KANBAN_SELECT_ALL',
    contexts: ['kanban'],
    category: 'selection',
    priority: 'medium',
    muscleMemory: 'common',
    enabled: true,
  },
];
