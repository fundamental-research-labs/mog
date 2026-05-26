/**
 * Dispatcher Types & Handler-Facing Indirection
 *
 * This module exists to break the cycle between `dispatcher.ts` and handler
 * modules (e.g., `handlers/repeat.ts`, `handlers/ui/misc-handlers.ts`) that
 * need to re-dispatch other actions.
 *
 * - `dispatcher.ts` imports handler namespaces to build HANDLER_MAP.
 * - A handler that calls `dispatch()` to delegate to another action would
 * normally import `dispatcher.ts`, forming a cycle.
 *
 * Instead:
 * - Handlers import `dispatch` from this file.
 * - `dispatcher.ts` registers its concrete `dispatch` function here at module
 * init via `registerDispatchImpl`.
 *
 * This file has NO import from `dispatcher.ts`, so the cycle is broken.
 */

import type { ActionDependencies, ActionResult, ActionType } from '@mog-sdk/contracts/actions';

// =============================================================================
// Dispatch Function Type
// =============================================================================

/**
 * Signature of the unified action dispatch function.
 *
 * The real implementation lives in `dispatcher.ts` and is registered here at
 * module init (see `registerDispatchImpl`).
 */
export type DispatchFn = (
  action: ActionType,
  deps: ActionDependencies,
  payload?: unknown,
) => ActionResult | Promise<ActionResult>;

// =============================================================================
// Dispatcher Implementation Holder
// =============================================================================

let dispatchImpl: DispatchFn | null = null;

/**
 * Register the concrete dispatcher implementation.
 *
 * Called exactly once from `dispatcher.ts` at module init.
 */
export function registerDispatchImpl(fn: DispatchFn): void {
  dispatchImpl = fn;
}

/**
 * Handler-facing dispatch function.
 *
 * Delegates to the implementation registered by `dispatcher.ts`. Handlers
 * import this symbol instead of importing from `dispatcher.ts` directly,
 * which would otherwise form a cycle with the handler imports that populate
 * the dispatcher's HANDLER_MAP.
 *
 * Throws if called before the dispatcher has registered its implementation
 * (which should never happen in practice — `dispatcher.ts` is always imported
 * before any handler is invoked).
 */
export const dispatch: DispatchFn = (action, deps, payload) => {
  if (!dispatchImpl) {
    throw new Error(
      '[dispatcher-types] dispatch() called before dispatcher.ts was imported. ' +
        'Ensure dispatcher.ts is loaded before any handler that re-dispatches.',
    );
  }
  return dispatchImpl(action, deps, payload);
};
