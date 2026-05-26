/**
 * useToolbarContext Hook
 *
 * Provides access to the current toolbar context (capabilities and state).
 * Toolbar context is provided by the active view adapter via getToolbarContext().
 *
 * Architecture:
 * - Views implement getToolbarContext() on their adapter
 * - This hook retrieves context from the active adapter via ShellCoordinator
 * - Context includes both capabilities (what CAN be done) and state (what IS)
 *
 * Design principle: Toolbar is view-agnostic.
 * It only knows about ToolbarContext interface, not CellRange or view internals.
 *
 * Usage:
 * ```typescript
 * const toolbarContext = useToolbarContext();
 * if (toolbarContext.formatting.canBold) {
 * // Show bold button
 * }
 * if (toolbarContext.state.isBold === true) {
 * // Highlight bold button
 * }
 * ```
 */

import { useMemo } from 'react';
import { getDefaultToolbarContext, type ToolbarContext } from '../../views/types';
import { useViewAdapter } from '../view/use-view-adapter';

/**
 * Get the current toolbar context.
 *
 * @returns Current toolbar context with capabilities and state
 */
export function useToolbarContext(): ToolbarContext {
  const adapter = useViewAdapter();

  return useMemo(() => {
    if (adapter) {
      try {
        return adapter.getToolbarContext();
      } catch {
        // Adapter might not be fully initialized
        return getDefaultToolbarContext();
      }
    }
    return getDefaultToolbarContext();
  }, [adapter]);
}
