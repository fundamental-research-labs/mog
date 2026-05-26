/**
 * Floating Object Scene Capability Implementation
 *
 * Wraps gridRenderer.boundsReader, gridRenderer.getObjectBoundsSync(),
 * and gridRenderer.updateObjectBounds() to provide the ISheetViewObjects
 * capability interface.
 *
 * @module @mog-sdk/sheet-view/capabilities/objects
 */

import type { FloatingObjectPatch, GridRenderer } from '@mog-sdk/contracts/rendering';
import type { FloatingObject } from '@mog-sdk/contracts/floating-objects';
import type { SceneObjectSnapshot } from '@mog-sdk/contracts/objects/scene-graph-reader';

import type { ISheetViewObjects } from '../capability-interfaces';
import type {
  ObjectBounds,
  ObjectSceneInfo,
  SheetFloatingObjectScenePatch,
  SheetPoint,
  SheetSceneObjectSnapshot,
} from '../public-types';
import { mapObjectBoundsToPublic, mapPublicBoundsToInternal } from './type-mappers';

// =============================================================================
// Internal accessor type
// =============================================================================

export interface ObjectsInternals {
  getRenderer(): GridRenderer;
}

// =============================================================================
// Implementation
// =============================================================================

function mapSceneObjectToPublic(obj: SceneObjectSnapshot): SheetSceneObjectSnapshot {
  return {
    id: obj.id,
    type: obj.type,
    bounds: {
      x: obj.bounds.x,
      y: obj.bounds.y,
      width: obj.bounds.width,
      height: obj.bounds.height,
    },
    zIndex: obj.zIndex,
    visible: obj.visible,
    groupId: obj.groupId,
    rotation: obj.rotation,
    locked: obj.locked,
    opacity: obj.opacity,
    data: obj.data,
  };
}

function mapScenePatchToInternal(patch: SheetFloatingObjectScenePatch): FloatingObjectPatch {
  return {
    objectId: patch.objectId,
    kind: patch.kind,
    data: patch.data as FloatingObject | undefined,
    bounds: patch.bounds
      ? {
          x: patch.bounds.x,
          y: patch.bounds.y,
          width: patch.bounds.width,
          height: patch.bounds.height,
          rotation: patch.bounds.rotation,
        }
      : undefined,
    changedFields: patch.changedFields ? [...patch.changedFields] : undefined,
  };
}

export class SheetViewObjects implements ISheetViewObjects {
  /** Transient bounds overrides keyed by object ID. */
  private _transientBounds: Map<string, ObjectBounds> = new Map();

  constructor(private readonly _internals: ObjectsInternals) {}

  hitTest(point: SheetPoint): ObjectSceneInfo | null {
    const renderer = this._internals.getRenderer();
    const hit = renderer.hitTest(point.x, point.y);

    if (hit.type === 'floatingObject') {
      const bounds = renderer.getObjectBoundsSync(hit.objectId);
      return {
        objectId: hit.objectId,
        bounds: bounds
          ? mapObjectBoundsToPublic(bounds)
          : { x: 0, y: 0, width: 0, height: 0, rotation: 0 },
        isGroup: hit.isGroup,
      };
    }
    return null;
  }

  getBounds(objectId: string): ObjectBounds | null {
    // Check transient bounds first.
    const transient = this._transientBounds.get(objectId);
    if (transient) return transient;

    const renderer = this._internals.getRenderer();
    const bounds = renderer.boundsReader.getBounds(objectId);
    if (!bounds) return null;
    return mapObjectBoundsToPublic(bounds);
  }

  getSceneObjectsByZOrder(): readonly SheetSceneObjectSnapshot[] {
    const renderer = this._internals.getRenderer();
    return renderer.sceneGraphReader.getByZOrder().map(mapSceneObjectToPublic);
  }

  getSceneObject(objectId: string): SheetSceneObjectSnapshot | null {
    const renderer = this._internals.getRenderer();
    const obj = renderer.sceneGraphReader.getById(objectId);
    return obj ? mapSceneObjectToPublic(obj) : null;
  }

  applyPatches(patches: readonly SheetFloatingObjectScenePatch[]): void {
    const renderer = this._internals.getRenderer();
    renderer.updateContext({
      floatingObjectPatches: patches.map(mapScenePatchToInternal),
    });
  }

  updateTransientBounds(objectId: string, bounds: ObjectBounds): void {
    this._transientBounds.set(objectId, bounds);
    const renderer = this._internals.getRenderer();
    renderer.updateObjectBounds(objectId, mapPublicBoundsToInternal(bounds));
  }

  clearTransientBounds(objectId?: string): void {
    if (objectId) {
      this._transientBounds.delete(objectId);
    } else {
      this._transientBounds.clear();
    }
    // The scene graph will revert to committed state on the next render
    // pass when transient state is cleared.
  }

  resyncScene(options?: { force?: boolean; sheetId?: string }): void {
    const renderer = this._internals.getRenderer();
    if (options?.force) {
      renderer.switchSheet(options.sheetId ?? renderer.getCurrentSheetId());
      return;
    }
    renderer.invalidateLayer('drawing');
  }

  invalidate(objectId?: string): void {
    const renderer = this._internals.getRenderer();
    if (objectId) {
      // Invalidate just the drawing layer for this object.
      renderer.invalidateLayer('drawing');
    } else {
      renderer.invalidateLayer('drawing');
    }
  }
}
