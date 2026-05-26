/**
 * useAppManifests - Hook to access all discovered app manifests
 *
 * Returns the list of all available apps discovered at build time.
 * Used by AppSwitcher to display available apps.
 *
 */

import { useMemo } from 'react';

import type { AppManifest } from '@mog-sdk/contracts/apps';

import { APP_MANIFESTS } from '../app-registry';

/**
 * useAppManifests - Get all available app manifests
 *
 * Returns an array of all app manifests discovered at build time.
 * The list is stable (same reference across renders).
 *
 * @returns Array of app manifests
 *
 * @example
 * ```tsx
 * function AppSwitcher() {
 *   const manifests = useAppManifests();
 *   return (
 *     <div>
 *       {manifests.map(m => (
 *         <button key={m.id}>{m.name}</button>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useAppManifests(): AppManifest[] {
  return useMemo(() => {
    return Object.values(APP_MANIFESTS);
  }, []);
}

/**
 * useAppManifest - Get manifest for a specific app
 *
 * @param appId - App identifier
 * @returns App manifest or null if not found
 */
export function useAppManifest(appId: string): AppManifest | null {
  return useMemo(() => {
    return APP_MANIFESTS[appId] ?? null;
  }, [appId]);
}
