/**
 * Synchronous, O(1) reads of floating object pixel bounds.
 * Backed by the scene graph (populated during render from Rust-computed bounds).
 *
 * Use for: overlay rendering, drag initiation, hit-test augmentation,
 * selection chrome, any code that needs bounds within a single frame.
 *
 * Do NOT use for: persistence, anchor resolution, position writes.
 */

import type { ObjectBounds } from '@mog/types-viewport/rendering/bounds';
export type { ObjectBounds };

export interface IObjectBoundsReader {
  /** Pixel bounds in document space. Null if object not in scene graph. */
  getBounds(objectId: string): ObjectBounds | null;

  /** Union bounds of all objects in a group. */
  getGroupBounds(groupId: string): ObjectBounds | null;

  /** Bounds for multiple objects. Skips objects not in scene graph. */
  getBoundsMany(objectIds: readonly string[]): Map<string, ObjectBounds>;
}
