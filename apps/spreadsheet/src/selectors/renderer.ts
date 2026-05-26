/**
 * Renderer Actor Selectors
 *
 * Pure functions that extract data from renderer state.
 * Copied from kernel/src/selectors/ during kernel export tightening.
 */

import type { RendererState, RendererStatus } from '@mog-sdk/contracts/actors/renderer';

export const rendererSelectors = {
  // ===========================================================================
  // Value Selectors (context fields)
  // ===========================================================================

  /** Get the container element */
  container: (state: RendererState) => state.context.container,

  /** Get the canvas width */
  width: (state: RendererState): number => state.context.width,

  /** Get the canvas height */
  height: (state: RendererState): number => state.context.height,

  /** Get the current sheet ID */
  currentSheetId: (state: RendererState) => state.context.currentSheetId,

  /** Get the target sheet ID (during sheet switching) */
  targetSheetId: (state: RendererState) => state.context.targetSheetId,

  /** Get pending actions */
  pendingActions: (state: RendererState) => state.context.pendingActions,

  /** Get the last error */
  error: (state: RendererState) => state.context.error,

  /** Get the retry count */
  retryCount: (state: RendererState): number => state.context.retryCount,

  /** Get the max retries */
  maxRetries: (state: RendererState): number => state.context.maxRetries,

  // ===========================================================================
  // State Matching Selectors (state.matches())
  // ===========================================================================

  /** Check if in unmounted state */
  isUnmounted: (state: RendererState): boolean => state.matches('unmounted'),

  /** Check if waiting for layout */
  isWaitingForLayout: (state: RendererState): boolean => state.matches('waitingForLayout'),

  /** Check if initializing */
  isInitializing: (state: RendererState): boolean => state.matches('initializing'),

  /** Check if ready */
  isReady: (state: RendererState): boolean => state.matches('ready'),

  /** Check if switching sheet */
  isSwitchingSheet: (state: RendererState): boolean => state.matches('switchingSheet'),

  /** Check if suspended */
  isSuspended: (state: RendererState): boolean => state.matches('suspended'),

  /** Check if in error state */
  isError: (state: RendererState): boolean => state.matches('error'),

  /** Check if disposing */
  isDisposing: (state: RendererState): boolean => state.matches('disposing'),

  // ===========================================================================
  // Derived Selectors (computed from state or context)
  // ===========================================================================

  /** Get the renderer status (maps state name to RendererStatus type) */
  status: (state: RendererState): RendererStatus => {
    const stateValue = state.value as string;
    const statusMap: Record<string, RendererStatus> = {
      unmounted: 'unmounted',
      waitingForLayout: 'waitingForLayout',
      initializing: 'initializing',
      ready: 'ready',
      switchingSheet: 'switchingSheet',
      suspended: 'suspended',
      error: 'error',
      disposing: 'disposing',
    };
    return statusMap[stateValue] ?? 'unmounted';
  },

  /** Check if switching (same as isSwitchingSheet, but named to match snapshot) */
  isSwitching: (state: RendererState): boolean => state.matches('switchingSheet'),

  /** Check if renderer can accept operations (ready or suspended states) */
  canAcceptOperations: (state: RendererState): boolean =>
    state.matches('ready') || state.matches('switchingSheet'),

  /** Check if renderer has valid dimensions */
  hasValidDimensions: (state: RendererState): boolean =>
    state.context.width > 0 && state.context.height > 0,

  /** Check if there are pending actions */
  hasPendingActions: (state: RendererState): boolean => state.context.pendingActions.length > 0,

  /** Check if retry is possible */
  canRetry: (state: RendererState): boolean => state.context.retryCount < state.context.maxRetries,
};
