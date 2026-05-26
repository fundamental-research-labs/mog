/**
 * Calendar View Keyboard Shortcuts
 *
 * Shortcuts for interacting with the Calendar view:
 * - Delete/Backspace to remove selected events
 * - Escape to clear selection
 * - Ctrl+A / Cmd+A to select all events
 *
 * Total: 4 shortcuts
 */

import type { KeyboardShortcut } from '../types';
import { crossPlatformBinding, universalBinding } from '@mog-sdk/kernel/keyboard';

export const CALENDAR_SHORTCUTS: KeyboardShortcut[] = [
  // ===========================================================================
  // Actions
  // ===========================================================================

  {
    id: 'calendar.delete',
    bindings: universalBinding('Delete'),
    matchBy: 'code',
    description: 'Delete selected event',
    action: 'CALENDAR_DELETE',
    contexts: ['calendar'],
    category: 'editing',
    priority: 'medium',
    muscleMemory: 'common',
    enabled: true,
  },
  {
    id: 'calendar.delete-backspace',
    bindings: universalBinding('Backspace'),
    matchBy: 'code',
    description: 'Delete selected event',
    action: 'CALENDAR_DELETE',
    contexts: ['calendar'],
    category: 'editing',
    priority: 'medium',
    muscleMemory: 'common',
    enabled: true,
  },
  {
    id: 'calendar.deselect',
    bindings: universalBinding('Escape'),
    matchBy: 'code',
    description: 'Clear selection',
    action: 'CALENDAR_DESELECT',
    contexts: ['calendar'],
    category: 'navigation',
    priority: 'medium',
    muscleMemory: 'common',
    enabled: true,
  },
  {
    id: 'calendar.select-all',
    bindings: crossPlatformBinding('KeyA', 'ctrl'),
    matchBy: 'key',
    expectedCharacter: 'a',
    description: 'Select all events',
    action: 'CALENDAR_SELECT_ALL',
    contexts: ['calendar'],
    category: 'selection',
    priority: 'medium',
    muscleMemory: 'common',
    enabled: true,
  },
];
