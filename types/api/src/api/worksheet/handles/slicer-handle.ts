import type { FloatingObjectHandle } from './types';

/**
 * Slicer handle — hosting ops only.
 * Content ops (selection, filter state) via ws.slicers.*
 *
 * Note: SlicerObject is not in the FloatingObject union (slicers use
 * their own type system in contracts/src/data/slicers.ts).
 * getData() returns the base FloatingObject type.
 */
export interface SlicerHandle extends FloatingObjectHandle {
  duplicate(offsetX?: number, offsetY?: number): Promise<SlicerHandle>;
}
