/**
 * Shared Handler Utilities
 *
 * Canonical helpers for all action handlers. Every handler file imports from here
 * instead of defining local copies of getUIStore, handled, notHandled, etc.
 *
 * WHY: ActionDependencies.uiStore is typed as IUIStoreApi (getState(): unknown)
 * in contracts to avoid circular dependencies. This file is the ONE cast point —
 * all handlers get type-safe UIState access through getUIStore().
 */

import type { ActionDependencies, ActionResult } from '@mog-sdk/contracts/actions';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { StoreApi } from 'zustand';

import type { UIState } from '../../ui-store/types';

/**
 * Get typed UIStore from ActionDependencies.
 *
 * IUIStoreApi uses `unknown` in contracts to avoid circular dependencies.
 * This is the ONE cast point — all handlers import this instead of casting locally.
 */
export function getUIStore(deps: ActionDependencies): StoreApi<UIState> {
  return deps.uiStore as StoreApi<UIState>;
}

/**
 * Get the active sheet ID from dependencies.
 */
export function getActiveSheetId(deps: ActionDependencies): SheetId {
  return deps.getActiveSheetId();
}

/** Return a successful handled result, optionally with receipts or other overrides. */
export function handled(overrides?: Omit<Partial<ActionResult>, 'handled'>): ActionResult {
  if (overrides) {
    return { handled: true, ...overrides };
  }
  return { handled: true };
}

/** Return not handled with reason. */
export function notHandled(
  reason: 'not_found' | 'not_implemented' | 'wrong_context' | 'disabled' | 'blocked',
): ActionResult {
  return { handled: false, reason };
}

export function showProtectionFeedback(
  deps: ActionDependencies,
  message = 'This action is disabled because the sheet is protected.',
): void {
  const state = getUIStore(deps).getState();
  state.setSelectionError?.('protection', message);
  state.showProtectionAlert?.(message);
}

export function isProtectionRejection(error: unknown): boolean {
  if (!error) return false;
  const maybe = error as { code?: string; message?: string };
  if (maybe.code === 'API_PROTECTED_SHEET') return true;
  return (
    maybe.code === 'OPERATION_FAILED' &&
    typeof maybe.message === 'string' &&
    maybe.message.toLowerCase().includes('protected')
  );
}
