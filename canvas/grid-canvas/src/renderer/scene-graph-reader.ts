/**
 * SceneGraphReader
 *
 * Implements ISceneGraphReader by adapting the canvas-internal SceneGraph
 * to the public read-only contract.
 *
 * The public contract carries a structural shape (`SceneObjectSnapshot`)
 * that intersects what every SceneObject guarantees plus an opaque `data`
 * field. The renderer-internal discriminated union (`PictureScene`,
 * `ChartScene`, etc.) stays inside `canvas/drawing-canvas` — exposing it
 * publicly would lock the contract to renderer details that change
 * frequently as new object types ship.
 *
 * Used by `__dt.getRenderedDrawings` (devtools) to validate that drawings
 * made it from the kernel into the canvas. Live: every call returns the
 * current scene-graph contents, no caching.
 */

import type {
  ISceneGraphReader,
  SceneObjectSnapshot,
} from '@mog-sdk/contracts/objects/scene-graph-reader';
import type { SceneGraph, SceneObject } from '@mog/drawing-canvas';

function snapshot(obj: SceneObject): SceneObjectSnapshot {
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
    // `data` is renderer-internal but devtools probe it for fields
    // like `src` (picture) and `chartId` (chart). Pass through as-is.
    // The public type is `Readonly<Record<string, unknown>>`; the
    // concrete payload (`PictureData`, `ChartData`, …) doesn't carry an
    // index signature, so we route through `unknown` before re-typing.
    data: (obj as unknown as { data?: Readonly<Record<string, unknown>> }).data,
  };
}

export class SceneGraphReader implements ISceneGraphReader {
  constructor(private sceneGraph: SceneGraph) {}

  getByZOrder(): ReadonlyArray<SceneObjectSnapshot> {
    return this.sceneGraph.getByZOrder().map(snapshot);
  }

  getById(id: string): SceneObjectSnapshot | null {
    const obj = this.sceneGraph.getById(id);
    return obj ? snapshot(obj) : null;
  }
}
