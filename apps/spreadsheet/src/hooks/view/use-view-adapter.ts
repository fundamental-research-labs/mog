/**
 * useViewAdapter Hook
 *
 * Provides access to the currently active view adapter.
 * View adapters implement the ViewAdapter contract and allow
 * shell-level coordination without knowing view internals.
 *
 * Architecture:
 * - ShellCoordinator manages adapter lifecycle
 * - This hook provides convenient React access to active adapter
 * - Returns null if no view is active
 *
 * Usage:
 * ```typescript
 * const adapter = useViewAdapter();
 * if (adapter) {
 * const selection = adapter.getSelection;
 * const toolbarContext = adapter.getToolbarContext;
 * }
 * ```
 */

import { useMemo } from 'react';
import type { ViewAdapter } from '../../views/types';
import { useShellCoordinator } from '../shared/use-shell-coordinator';

/**
 * Get the currently active view adapter.
 *
 * @returns Active ViewAdapter or null if no view is active
 */
export function useViewAdapter(): ViewAdapter | null {
  const coordinator = useShellCoordinator();

  // Memoize to prevent unnecessary re-renders
  // The adapter reference itself is stable until view switches
  return useMemo(() => {
    try {
      return coordinator.getActiveAdapter();
    } catch {
      // Coordinator might not be fully initialized yet
      return null;
    }
  }, [coordinator]);
}
