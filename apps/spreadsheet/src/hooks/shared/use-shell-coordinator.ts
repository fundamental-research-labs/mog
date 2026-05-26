/**
 * useShellCoordinator Hook
 *
 * Provides access to the ShellCoordinator instance for view coordination and actions.
 *
 * Architecture:
 * - ShellCoordinator is created once by ShellProvider
 * - This hook provides type-safe access to the coordinator
 * - Used by action handlers, keyboard shortcuts, and view components
 *
 * Usage:
 * ```typescript
 * const coordinator = useShellCoordinator();
 * coordinator.copy();
 * coordinator.paste();
 * const adapter = coordinator.getActiveAdapter();
 * ```
 */

import { createContext, useContext } from 'react';
// import type { ShellCoordinator } from '../../coordinator';

/**
 * Context for ShellCoordinator instance.
 * Populated by ShellProvider.
 */
const ShellCoordinatorContext = createContext<any | null>(null); // ShellCoordinator when ready

/**
 * Provider component for ShellCoordinator context.
 * Used internally by ShellProvider.
 */
export const ShellCoordinatorProvider = ShellCoordinatorContext.Provider;

/**
 * Access the shell coordinator instance.
 * Throws if used outside ShellProvider.
 *
 * @returns ShellCoordinator instance for view coordination
 * @throws Error if used outside ShellProvider
 */
export function useShellCoordinator(): any {
  // Return type: ShellCoordinator when ready
  const coordinator = useContext(ShellCoordinatorContext);
  if (!coordinator) {
    throw new Error('useShellCoordinator must be used within ShellCoordinatorProvider');
  }
  return coordinator;
}
