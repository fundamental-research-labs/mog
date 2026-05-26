/**
 * Renderer Status Hook - Granular Renderer Subscription
 *
 * This hook provides a granular subscription to ONLY the renderer status,
 * NOT the full renderer state. This is a critical performance optimization.
 *
 * Problem: useRenderer() uses an identity selector `(s) => s` causing
 * SpreadsheetGrid to re-render on EVERY XState state transition (620 times
 * in profiling data), even when it only needs status information.
 *
 * Solution: Use XState's useSelector with a custom equality function that
 * only triggers re-renders when status actually changes.
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 14: Render Isolation
 */

import { useSelector } from '@xstate/react';

import type { RendererStatus } from '@mog-sdk/contracts/machines';
import { useCoordinator } from '../shared/use-coordinator';

// =============================================================================
// TYPES
// =============================================================================

export interface UseRendererStatusReturn {
  /** Current renderer status */
  status: RendererStatus;

  /** Whether renderer is fully ready */
  isReady: boolean;

  /** Whether renderer is initializing */
  isInitializing: boolean;

  /** Whether currently switching sheets */
  isSwitching: boolean;

  /** Whether renderer is suspended (tab hidden) */
  isSuspended: boolean;

  /** Whether renderer is in error state */
  hasError: boolean;

  /** Current sheet ID being rendered */
  currentSheetId: string | null;

  /** Current dimensions */
  dimensions: { width: number; height: number };

  /** Last error (if any) */
  error: Error | null;
}

// =============================================================================
// SELECTORS
// =============================================================================

/**
 * Map from XState state value to RendererStatus.
 * This is the canonical mapping from machine states to the public status type.
 */
const STATUS_MAP: Record<string, RendererStatus> = {
  unmounted: 'unmounted',
  waitingForLayout: 'waitingForLayout',
  initializing: 'initializing',
  ready: 'ready',
  switchingSheet: 'switchingSheet',
  suspended: 'suspended',
  error: 'error',
  disposing: 'disposing',
};

/**
 * Internal state slice type for selector.
 */
interface RendererStateSlice {
  status: RendererStatus;
  currentSheetId: string | null;
  width: number;
  height: number;
  error: Error | null;
}

/**
 * Extract all tracked fields from XState snapshot.
 * These are the only fields we subscribe to for re-renders.
 */

function selectRendererState(state: any): RendererStateSlice {
  const stateValue = state.value as string;
  return {
    status: STATUS_MAP[stateValue] ?? 'unmounted',
    currentSheetId: state.context?.currentSheetId ?? null,
    width: state.context?.width ?? 0,
    height: state.context?.height ?? 0,
    error: state.context?.error ?? null,
  };
}

// =============================================================================
// EQUALITY FUNCTION
// =============================================================================

/**
 * Custom equality function for renderer state slice comparison.
 * Only returns true (preventing re-render) if all tracked fields are identical.
 *
 * This is critical for performance - we only want to re-render when
 * these specific fields change, not on every state machine transition.
 */
function rendererStateEqual(a: RendererStateSlice, b: RendererStateSlice): boolean {
  return (
    a.status === b.status &&
    a.currentSheetId === b.currentSheetId &&
    a.width === b.width &&
    a.height === b.height &&
    a.error === b.error
  );
}

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

/**
 * Hook for accessing ONLY the renderer status from renderer state.
 *
 * This is a performance-optimized alternative to useRenderer() for components
 * that only need to know the current renderer status (ready, initializing, etc.)
 * without subscribing to context changes like dimensions or sheet IDs.
 *
 * Key optimization: Uses useSelector with custom equality function to prevent
 * re-renders when context changes but status stays the same.
 *
 * @example
 * ```tsx
 * function GridContainer() {
 * const { isReady, status } = useRendererStatus;
 *
 * // Only re-renders when status changes (e.g., initializing -> ready),
 * // NOT on every resize or context update
 * if (!isReady) {
 * return <div>Loading... ({status})</div>;
 * }
 * return <Grid />;
 * }
 * ```
 */
export function useRendererStatus(): UseRendererStatusReturn {
  const coordinator = useCoordinator();
  const actor = coordinator.renderer.access.actors.renderer;

  // Subscribe to tracked fields with custom equality
  // This prevents re-renders when untracked context changes
  const stateSlice = useSelector(actor, selectRendererState, rendererStateEqual);

  // Derive boolean flags from status - computed synchronously, no additional subscription
  const isReady = stateSlice.status === 'ready';
  const isInitializing = stateSlice.status === 'initializing';
  const isSwitching = stateSlice.status === 'switchingSheet';
  const isSuspended = stateSlice.status === 'suspended';
  const hasError = stateSlice.status === 'error';

  return {
    status: stateSlice.status,
    isReady,
    isInitializing,
    isSwitching,
    isSuspended,
    hasError,
    currentSheetId: stateSlice.currentSheetId,
    dimensions: { width: stateSlice.width, height: stateSlice.height },
    error: stateSlice.error,
  };
}
