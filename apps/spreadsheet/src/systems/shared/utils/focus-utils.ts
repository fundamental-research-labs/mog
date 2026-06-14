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
  // Go To
  { ctrl: true, key: 'g' },
  { meta: true, key: 'g' },
  // Formula view
  { ctrl: true, key: '`' },
  { meta: true, key: '`' },
  // Ribbon visibility
  { ctrl: true, shift: true, key: 'f1' },
  { meta: true, shift: true, key: 'f1' },
  { ctrl: true, key: 'f1' },
  { meta: true, key: 'f1' },
] as const;

const EDITABLE_NAVIGATION_KEYS = new Set(['Enter', 'Tab', 'Escape']);

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

export function keyboardEventTargetElement(e: KeyboardEvent): HTMLElement | null {
  if (typeof HTMLElement === 'undefined') return null;
  if (e.target instanceof HTMLElement) return e.target;
  const path = e.composedPath?.() ?? [];
  return path.find((target): target is HTMLElement => target instanceof HTMLElement) ?? null;
}

export function isEditableKeyboardTarget(target: HTMLElement | null): boolean {
  if (!target) return false;
  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'),
  );
}

export function isDialogKeyboardTarget(target: HTMLElement | null): boolean {
  if (!target) return false;
  return Boolean(target.closest('[role="dialog"]'));
}

export function isSpreadsheetEditorKeyboardTarget(target: HTMLElement | null): boolean {
  if (!target) return false;
  return Boolean(
    target.closest('[data-testid="inline-cell-editor"], [data-testid="formula-bar-input"]'),
  );
}

export function isEditableChromeKeyboardTarget(target: HTMLElement | null): boolean {
  return isEditableKeyboardTarget(target) && !isSpreadsheetEditorKeyboardTarget(target);
}

export function shouldDeferNavigationKeyToEditableTarget(
  e: KeyboardEvent,
  target = keyboardEventTargetElement(e),
): boolean {
  if (!EDITABLE_NAVIGATION_KEYS.has(e.key)) return false;
  return isEditableChromeKeyboardTarget(target);
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
