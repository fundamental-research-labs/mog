/**
 * Renderer Hook
 *
 * React hook that wraps the renderer lifecycle state machine actor.
 * Provides type-safe access to renderer state and lifecycle actions.
 *
 * PERFORMANCE NOTE: This hook composes useRendererStatus() and useRendererActions()
 * for backwards compatibility. For new code, prefer using the granular hooks directly:
 *
 * - useRendererStatus() - For components that only need status (isReady, isInitializing, etc.)
 * - useRendererActions() - For components that only need actions (mount, unmount, etc.)
 *
 * @see ARCHITECTURE.md - State Machine 1: Renderer Lifecycle
 */

import { useSelector } from '@xstate/react';
import { useMemo } from 'react';

import type { RendererSnapshot } from '@mog-sdk/contracts/machines';
import { useCoordinator } from '../shared/use-coordinator';
import { useRendererActions, type UseRendererActionsReturn } from './use-renderer-actions';
import { useRendererStatus, type UseRendererStatusReturn } from './use-renderer-status';

// =============================================================================
// HOOK RETURN TYPE
// =============================================================================

export interface UseRendererReturn extends UseRendererStatusReturn, UseRendererActionsReturn {
  /** Current sheet ID */
  currentSheetId: string | null;

  /** Target sheet ID when switching */
  targetSheetId: string | null;

  /** Last error */
  error: Error | null;

  /** Current dimensions */
  dimensions: { width: number; height: number };

  /** Full snapshot for advanced usage */
  snapshot: RendererSnapshot;
}

// =============================================================================
// GRANULAR SELECTORS FOR CONTEXT VALUES
// =============================================================================

/**
 * Selector that extracts context values that change less frequently than status.
 * This groups related context values to minimize selector calls while still
 * being more granular than the identity selector.
 */
interface RendererContextValues {
  currentSheetId: string | null;
  targetSheetId: string | null;
  error: Error | null;
  width: number;
  height: number;
}

/**
 * Extract context values from XState snapshot.
 * Works with any XState snapshot shape that has a `context` property.
 */

function selectRendererContext(state: any): RendererContextValues {
  return {
    currentSheetId: state.context.currentSheetId,
    targetSheetId: state.context.targetSheetId,
    error: state.context.error,
    width: state.context.width,
    height: state.context.height,
  };
}

/**
 * Custom equality function for context values.
 * Only triggers re-render if any of the context values actually changed.
 */
function contextEqual(a: RendererContextValues, b: RendererContextValues): boolean {
  return (
    a.currentSheetId === b.currentSheetId &&
    a.targetSheetId === b.targetSheetId &&
    a.error === b.error &&
    a.width === b.width &&
    a.height === b.height
  );
}

// =============================================================================
// HOOK IMPLEMENTATION
// =============================================================================

/**
 * Hook for accessing and controlling the renderer lifecycle state machine.
 *
 * NOTE: This hook is provided for backwards compatibility. For better performance,
 * use the granular hooks directly:
 *
 * - useRendererStatus() - Only subscribes to status changes
 * - useRendererActions() - No subscriptions, only stable functions
 *
 * @example
 * ```tsx
 * // RECOMMENDED: Use granular hooks for better performance
 * function OptimizedGrid() {
 * const { isReady, status } = useRendererStatus;
 * const { mount, unmount } = useRendererActions;
 * // ...
 * }
 *
 * // LEGACY: Full hook (triggers more re-renders)
 * function LegacyGrid() {
 * const { status, isReady, mount, unmount } = useRenderer;
 * // ...
 * }
 * ```
 */
export function useRenderer(): UseRendererReturn {
  // Use granular hooks for status and actions
  const statusValues = useRendererStatus();
  const actions = useRendererActions();

  // Get coordinator for context subscription
  const coordinator = useCoordinator();
  const actor = coordinator.renderer.access.actors.renderer;

  // Subscribe to context values with custom equality
  // This is more granular than (s) => s but still provides all needed context
  const contextValues = useSelector(actor, selectRendererContext, contextEqual);

  // Build snapshot from granular values (computed, not subscribed)
  const snapshot: RendererSnapshot = useMemo(
    () => ({
      status: statusValues.status,
      currentSheetId: contextValues.currentSheetId,
      isSwitching: statusValues.isSwitching,
    }),
    [statusValues.status, contextValues.currentSheetId, statusValues.isSwitching],
  );

  // Build dimensions object (computed, not subscribed)
  const dimensions = useMemo(
    () => ({
      width: contextValues.width,
      height: contextValues.height,
    }),
    [contextValues.width, contextValues.height],
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // RETURN VALUE
  // ═══════════════════════════════════════════════════════════════════════════

  return useMemo(
    () => ({
      // Status values (from useRendererStatus)
      ...statusValues,

      // Context values (from granular selector)
      currentSheetId: contextValues.currentSheetId,
      targetSheetId: contextValues.targetSheetId,
      error: contextValues.error,
      dimensions,
      snapshot,

      // Actions (from useRendererActions)
      ...actions,
    }),
    [statusValues, contextValues, dimensions, snapshot, actions],
  );
}
