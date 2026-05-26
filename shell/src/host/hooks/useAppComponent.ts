/**
 * useAppComponent - Hook for lazy loading app components
 *
 * Dynamically imports app components using React.lazy pattern.
 *
 */

import React from 'react';

import type { AppComponent, AppLoader } from '../../apps/types';
import { APP_LOADERS } from '../app-registry';

/**
 * Cache for lazy components.
 *
 * IMPORTANT: React.lazy must return the SAME component reference across renders.
 * If we create a new lazy component on each render, React will see it as a different
 * component and suspend again, causing an infinite loop.
 *
 * This cache ensures we only create one lazy component per appId.
 */
const lazyComponentCache = new Map<string, React.LazyExoticComponent<AppComponent>>();

/**
 * Get or create a lazy component for an app.
 * Uses a module-level cache to ensure referential stability.
 */
function getOrCreateLazyComponent(
  appId: string,
  loader: AppLoader,
): React.LazyExoticComponent<AppComponent> {
  let component = lazyComponentCache.get(appId);
  if (!component) {
    component = React.lazy(loader);
    lazyComponentCache.set(appId, component);
  }
  return component;
}

/**
 * useAppComponent - Lazy load an app component
 *
 * Uses React.lazy to dynamically import the app component.
 * Returns null if app not found or while loading (handled by Suspense).
 *
 * @param appId - App identifier
 * @returns Lazy component or null if app not found
 *
 * @example
 * ```tsx
 * function AppLoader({ appId }: { appId: string }) {
 *   const Component = useAppComponent(appId);
 *   if (!Component) return <div>App not found</div>;
 *   return <Component kernel={kernel} />;
 * }
 * ```
 */
export function useAppComponent(appId: string): React.LazyExoticComponent<AppComponent> | null {
  const loader = APP_LOADERS[appId];
  if (!loader) {
    console.warn(`[useAppComponent] App not found: ${appId}`);
    return null;
  }

  // Return cached lazy component (or create and cache it)
  return getOrCreateLazyComponent(appId, loader);
}
