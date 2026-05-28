/**
 * Focus and keyboard shortcut utilities
 */

import { focusSelectors } from '../../../selectors';
import type { FocusState } from '@mog-sdk/contracts/actors';
import type { FocusSnapshot } from '@mog-sdk/contracts/machines';

/**
 * Keyboard shortcut definition.
 * At least one modifier (ctrl or meta) must be present.
 */
interface KeyboardShortcut {
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  key: string;
}

/**
 * Global shortcuts that work regardless of focus state.
 * These shortcuts should be checked BEFORE checking if grid should handle keyboard.
 */
export const GLOBAL_SHORTCUTS: readonly KeyboardShortcut[] = [
  // Save
  { ctrl: true, key: 's' },
  { meta: true, key: 's' },
  // Undo
  { ctrl: true, key: 'z' },
  { meta: true, key: 'z' },
  // Redo
  { ctrl: true, shift: true, key: 'z' },
  { meta: true, shift: true, key: 'z' },
  { ctrl: true, key: 'y' },
  { meta: true, key: 'y' },
  // Copy
  { ctrl: true, key: 'c' },
  { meta: true, key: 'c' },
  // Cut
  { ctrl: true, key: 'x' },
  { meta: true, key: 'x' },
  // Paste
  { ctrl: true, key: 'v' },
  { meta: true, key: 'v' },
  // Find
  { ctrl: true, key: 'f' },
  { meta: true, key: 'f' },
  // Find and replace
  { ctrl: true, key: 'h' },
  { meta: true, key: 'h' },
  // Formula view
  { ctrl: true, key: '`' },
  { meta: true, key: '`' },
  // Ribbon visibility
  { ctrl: true, shift: true, key: 'f1' },
  { meta: true, shift: true, key: 'f1' },
  { ctrl: true, key: 'f1' },
  { meta: true, key: 'f1' },
] as const;

/**
 * Check if a keyboard event is a global shortcut.
 * Global shortcuts (Cmd+S, Ctrl+Z, etc.) work regardless of focus state.
 */
export function isGlobalShortcut(e: KeyboardEvent): boolean {
  const key = e.key.toLowerCase();
  const ctrl = e.ctrlKey;
  const meta = e.metaKey;
  const shift = e.shiftKey;

  return GLOBAL_SHORTCUTS.some((shortcut) => {
    const ctrlMatch = (shortcut.ctrl && ctrl) || (shortcut.meta && meta);
    const shiftMatch = shortcut.shift ? shift : !shift;
    const keyMatch = shortcut.key === key;

    return ctrlMatch && shiftMatch && keyMatch;
  });
}

/**
 * Get the focus snapshot from the focus state.
 * Composes selectors to build the complete snapshot.
 */
export function getFocusSnapshot(state: FocusState): FocusSnapshot {
  return {
    state: focusSelectors.state(state),
    currentLayer: focusSelectors.currentLayer(state),
    stack: focusSelectors.stack(state),
    shouldGridHandle: focusSelectors.shouldGridHandle(state),
    isInOverlay: focusSelectors.isInOverlay(state),
  };
}
