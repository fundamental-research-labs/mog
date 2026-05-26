/**
 * Floating Object Cache Hook (base)
 *
 * Provides access to the FloatingObjectCache instance from the coordinator.
 * This is the base hook — specific hooks (useFloatingObject, useFloatingObjectsInSheet)
 * build on top of this.
 */

import {
  createFloatingObjectCache,
  type FloatingObjectCache,
} from '../../cache/floating-object-cache';
import { useCoordinator } from '../shared/use-coordinator';

/**
 * Static empty cache for workbooks without floating object support (blank sheets, no-doc mode).
 * Zustand hooks need a real store to subscribe to — this provides an always-empty one.
 */
const EMPTY_CACHE: FloatingObjectCache = createFloatingObjectCache();

/**
 * Get the FloatingObjectCache instance from the coordinator.
 *
 * Returns a static empty cache when the coordinator has no floating object support
 * (e.g., blank workbooks without a document context). This ensures Zustand hooks
 * downstream always have a valid store to subscribe to.
 */
export function useFloatingObjectCacheApi(): FloatingObjectCache {
  const coordinator = useCoordinator();
  return coordinator.floatingObjectCache ?? EMPTY_CACHE;
}
