/**
 * useFloatingObjectsInSheet Hook
 *
 * Reactively subscribe to all floating objects in a given sheet.
 * Returns objects sorted by zIndex (ascending).
 */

import { useCallback } from 'react';
import { useStoreWithEqualityFn } from 'zustand/traditional';

import type { FloatingObject } from '@mog-sdk/contracts/floating-objects';

import type { FloatingObjectCacheState } from '../../cache/floating-object-cache';
import { useFloatingObjectCacheApi } from './use-floating-object-cache';

/**
 * Select objects for a sheet, sorted by zIndex ascending.
 */
function selectObjectsInSheet(state: FloatingObjectCacheState, sheetId: string): FloatingObject[] {
  const objectIds = state.objectsBySheet.get(sheetId);
  if (!objectIds || objectIds.size === 0) return EMPTY_ARRAY;

  const result: FloatingObject[] = [];
  for (const id of objectIds) {
    const obj = state.objects.get(id);
    if (obj) result.push(obj);
  }

  // Sort by zIndex ascending (lower zIndex renders first / behind)
  result.sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
  return result;
}

const EMPTY_ARRAY: FloatingObject[] = [];

/**
 * Shallow array equality: same length and same elements by reference.
 * Used as the Zustand equality function to prevent re-renders when
 * selectObjectsInSheet produces a new array with identical element refs.
 */
function shallowArrayEqual(a: FloatingObject[], b: FloatingObject[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Subscribe to all floating objects in a sheet, sorted by zIndex.
 *
 * @param sheetId - The sheet ID to get objects for
 * @returns Array of FloatingObjects sorted by zIndex ascending
 */
export function useFloatingObjectsInSheet(sheetId: string): FloatingObject[] {
  const store = useFloatingObjectCacheApi();
  return useStoreWithEqualityFn(
    store,
    useCallback((state) => selectObjectsInSheet(state, sheetId), [sheetId]),
    shallowArrayEqual,
  );
}
