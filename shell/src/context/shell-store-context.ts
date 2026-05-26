/**
 * Shell Store Context
 *
 * Provides app-wide UI state via a zustand store (navigation, record detail,
 * project). Extracted from the `context` barrel so sibling context modules
 * (e.g. `project-service-context`) can depend on the store hooks without
 * creating a barrel re-export cycle through `context/index.ts`.
 */

import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import type { ShellStoreApi, ShellUIState } from '../ui-store/shell-store';

export const ShellStoreContext = createContext<ShellStoreApi | null>(null);

/**
 * Hook to access shell-level UI store.
 * Used for app-wide state like view navigation and project state.
 *
 * @example
 * ```tsx
 * const activeAppId = useShellStore((s) => s.activeAppId);
 * const projectPath = useShellStore((s) => s.projectPath);
 * const fileTree = useShellStore((s) => s.fileTree);
 * ```
 */
export function useShellStore<T>(selector: (state: ShellUIState) => T): T {
  const store = useContext(ShellStoreContext);
  if (!store) {
    throw new Error('useShellStore must be used within ShellProvider');
  }
  return useStore(store, selector);
}

/**
 * Hook to access shell store API for subscriptions.
 * Used by services that need direct store access.
 *
 * @example
 * ```tsx
 * const storeApi = useShellStoreApi();
 * // In an effect or callback
 * storeApi.getState().setActiveAppId('docs');
 * ```
 */
export function useShellStoreApi(): ShellStoreApi {
  const store = useContext(ShellStoreContext);
  if (!store) {
    throw new Error('useShellStoreApi must be used within ShellProvider');
  }
  return store;
}
