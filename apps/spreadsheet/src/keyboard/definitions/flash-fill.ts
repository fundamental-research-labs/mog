/**
 * Flash Fill Keyboard Shortcuts
 *
 * When the Flash Fill preview popup is showing AND the user is not editing,
 * Enter/Tab accept the suggestion and Escape dismisses it. These shortcuts
 * specialize 'grid' via the 'flashFillPreview' context — when no preview is
 * visible the context falls back to 'grid' and the normal navigation /
 * clipboard shortcuts handle these keys.
 *
 * Two-pass exact-then-hierarchy matching in the kernel ensures that these
 * exact-context shortcuts beat the same-priority 'grid' shortcuts (Enter ->
 * ENTER_NAVIGATE, Tab -> TAB_FORWARD, Escape -> CLEAR_CLIPBOARD) at the same
 * key when the popup is up.
 *
 * Total: 3 shortcuts.
 */

import type { KeyboardShortcut } from '../types';
import { universalBinding } from '@mog-sdk/kernel/keyboard';

export const FLASH_FILL_SHORTCUTS: KeyboardShortcut[] = [
  {
    id: 'accept-flash-fill-enter',
    bindings: universalBinding('Enter'),
    description: 'Accept Flash Fill suggestion',
    action: 'ACCEPT_FLASH_FILL',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['flashFillPreview'],
    muscleMemory: 'common',
    matchBy: 'code',
  },
  {
    id: 'accept-flash-fill-tab',
    bindings: universalBinding('Tab'),
    description: 'Accept Flash Fill suggestion (Tab)',
    action: 'ACCEPT_FLASH_FILL',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['flashFillPreview'],
    muscleMemory: 'common',
    matchBy: 'code',
  },
  {
    id: 'reject-flash-fill',
    bindings: universalBinding('Escape'),
    description: 'Dismiss Flash Fill suggestion',
    action: 'REJECT_FLASH_FILL',
    enabled: true,
    priority: 'critical',
    category: 'editing',
    contexts: ['flashFillPreview'],
    muscleMemory: 'common',
    matchBy: 'code',
  },
];
