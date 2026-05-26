/**
 * useFloatingObject Hook
 *
 * Reactively subscribe to a single floating object by ID.
 * Returns undefined if the object does not exist.
 */

import { useCallback } from 'react';
import { useStore } from 'zustand';

import type { FloatingObject } from '@mog-sdk/contracts/floating-objects';

import { useFloatingObjectCacheApi } from './use-floating-object-cache';

/**
 * Subscribe to a single floating object by ID.
 *
 * Re-renders only when the specific object changes (referential equality check).
 *
 * @param objectId - The object ID to subscribe to
 * @returns The FloatingObject, or undefined if not found
 */
export function useFloatingObject(objectId: string): FloatingObject | undefined {
  const store = useFloatingObjectCacheApi();
  return useStore(
    store,
    useCallback((state) => state.objects.get(objectId), [objectId]),
  );
}
