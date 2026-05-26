/**
 * SceneGraphBoundsReader
 *
 * Implements IObjectBoundsReader by reading from the canvas SceneGraph.
 * Returns document-space pixel bounds synchronously (O(1) lookups).
 *
 * This formalizes the ad-hoc getObjectBoundsSync() pattern into a proper contract.
 */

import type {
  IObjectBoundsReader,
  ObjectBounds,
} from '@mog-sdk/contracts/objects/object-bounds-reader';
import type { SceneGraph } from '@mog/drawing-canvas';

export class SceneGraphBoundsReader implements IObjectBoundsReader {
  constructor(private sceneGraph: SceneGraph) {}

  getBounds(objectId: string): ObjectBounds | null {
    const obj = this.sceneGraph.getById(objectId);
    if (!obj) return null;
    return {
      x: obj.bounds.x,
      y: obj.bounds.y,
      width: obj.bounds.width,
      height: obj.bounds.height,
      rotation: obj.rotation ?? 0,
    };
  }

  getGroupBounds(groupId: string): ObjectBounds | null {
    const rect = this.sceneGraph.getGroupBounds(groupId);
    if (!rect) return null;
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      rotation: 0,
    };
  }

  getBoundsMany(objectIds: readonly string[]): Map<string, ObjectBounds> {
    const result = new Map<string, ObjectBounds>();
    for (const id of objectIds) {
      const bounds = this.getBounds(id);
      if (bounds) result.set(id, bounds);
    }
    return result;
  }
}
