/**
 * HitMap — Drawing Object Hit Testing
 *
 * Implements HitTestProvider from canvas-engine to provide hit testing for
 * drawing objects. Manages Path2D registrations during render and bounding-box
 * querying during input handling.
 *
 * Architecture: Two-phase hit testing
 *   - Broad phase: SpatialIndex (grid-based, O(1) candidate lookup)
 *   - Narrow phase: Path2D pixel-perfect testing via testPointInPath()
 *
 * The SpatialIndex is maintained incrementally via addToIndex/removeFromIndex/
 * updateInIndex. It is NOT cleared per-frame. Path2D registrations are cleared
 * per-frame during render (unchanged from before).
 *
 * Lifecycle:
 *   1. clear() — called at the start of each render frame (Path2D only)
 *   2. registerBody() — called per-object during render to register Path2D shapes
 *   3. setViewportTransform() — called once per region render with scroll/zoom
 *   4. addToIndex/removeFromIndex/updateInIndex — called on scene graph mutations
 *   5. hitTest() — called during input handling to find objects under the pointer
 *
 * Objects are tested in reverse z-order (topmost first) so the visually
 * frontmost object is returned on hit. Group hits return both the objectId
 * and groupId so the consumer can decide selection behavior (single click
 * selects group, double click selects individual).
 *
 * @module @mog/drawing-canvas/hit-testing/hit-map
 */

import type { HitResult, HitTestProvider, Point } from '@mog/canvas-engine';
import { createSpatialIndex, hitTestPipeline, testPointInPath } from '@mog/spatial';
import type { SpatialIndex } from '@mog/spatial';
import type { BoundingBox } from '@mog-sdk/contracts/geometry';
import type { SceneGraph } from '../scene/scene-graph';
import type { ObjectHitRegion } from '../scene/types';

// =============================================================================
// Hit Result Types
// =============================================================================

/** Result of hitting a drawing object, carried as HitResult.target. */
export interface ObjectHitResult {
  readonly objectId: string;
  readonly groupId: string | null;
  readonly region: ObjectHitRegion;
}

/** Data stored per entry in the spatial index. */
interface SpatialObjectData {
  readonly zIndex: number;
  readonly visible: boolean;
  readonly groupId: string | null;
}

// =============================================================================
// HitMap
// =============================================================================

export class HitMap implements HitTestProvider {
  private readonly layerId = 'drawing';
  private readonly sceneGraph: SceneGraph;

  /**
   * Path2D registrations populated during render and cleared before each frame.
   * Used for pixel-perfect hit testing via isPointInPath().
   */
  private readonly bodyPaths = new Map<string, Path2D>();

  /**
   * Grid-based spatial index for O(1) broad-phase candidate lookup.
   * Maintained incrementally — NOT cleared per-frame.
   */
  private readonly spatialIndex: SpatialIndex<SpatialObjectData>;

  /** Scroll offset from the last render (needed to convert screen -> document coords). */
  private scrollOffset: Point = { x: 0, y: 0 };

  /** Zoom level from the last render. */
  private zoom: number = 1;

  /** Top-left origin of the render region in screen pixels (accounts for headers). */
  private regionOrigin: Point = { x: 0, y: 0 };

  /** Lazily initialized OffscreenCanvas context for isPointInPath() calls. */
  private offscreenCtx: OffscreenCanvasRenderingContext2D | null = null;

  constructor(sceneGraph: SceneGraph) {
    this.sceneGraph = sceneGraph;
    this.spatialIndex = createSpatialIndex<SpatialObjectData>();
  }

  /**
   * Get or lazily create an OffscreenCanvas 2D context for isPointInPath() calls.
   * A 1x1 canvas suffices since we only use it for path-in-point geometric queries.
   */
  private getOffscreenCtx(): OffscreenCanvasRenderingContext2D | null {
    if (!this.offscreenCtx) {
      try {
        const canvas = new OffscreenCanvas(1, 1);
        this.offscreenCtx = canvas.getContext('2d');
      } catch {
        // OffscreenCanvas not available (e.g., older browsers)
        return null;
      }
    }
    return this.offscreenCtx;
  }

  // ===========================================================================
  // Registration API (called during render)
  // ===========================================================================

  /** Clear all Path2D registrations. Called at the start of each frame. */
  clear(): void {
    this.bodyPaths.clear();
  }

  /**
   * Register a body Path2D for an object.
   *
   * Called by individual object renderers during the render pass. The Path2D
   * is used for pixel-perfect hit testing via isPointInPath(). Objects without
   * a registered path fall back to bounding-box hit testing.
   */
  registerBody(objectId: string, path: Path2D): void {
    this.bodyPaths.set(objectId, path);
  }

  /**
   * Update the current viewport transform.
   *
   * Called once per region render so that hitTest() can convert screen-space
   * pointer coordinates into document-space coordinates.
   *
   * @param scrollOffset — document scroll position
   * @param zoom — current zoom level
   * @param dpr — device pixel ratio
   * @param regionOrigin — top-left of the render region in screen pixels
   *   (e.g., accounts for row/column header offsets)
   */
  setViewportTransform(scrollOffset: Point, zoom: number, _dpr: number, regionOrigin: Point): void {
    this.scrollOffset = scrollOffset;
    this.zoom = zoom;
    this.regionOrigin = regionOrigin;
  }

  // ===========================================================================
  // Spatial Index API (incremental maintenance)
  // ===========================================================================

  /**
   * Add an object to the spatial index.
   * Called when an object enters the scene graph.
   */
  addToIndex(
    objectId: string,
    bounds: BoundingBox,
    zIndex: number,
    visible: boolean,
    groupId: string | null,
  ): void {
    this.spatialIndex.insert(objectId, bounds, { zIndex, visible, groupId });
  }

  /**
   * Remove an object from the spatial index.
   * Called when an object leaves the scene graph.
   */
  removeFromIndex(objectId: string): void {
    this.spatialIndex.remove(objectId);
  }

  /**
   * Update an object's bounds and/or metadata in the spatial index.
   * Called on move/resize/visibility change.
   */
  updateInIndex(
    objectId: string,
    bounds: BoundingBox,
    zIndex: number,
    visible: boolean,
    groupId: string | null,
  ): void {
    // SpatialIndex.updateBounds only changes bounds; for full update, remove+insert.
    this.spatialIndex.remove(objectId);
    this.spatialIndex.insert(objectId, bounds, { zIndex, visible, groupId });
  }

  /**
   * Sync the spatial index with the current scene graph state.
   * Processes dirty IDs from the scene graph and updates the index accordingly.
   * Called before hit testing when dirty objects exist.
   */
  syncIndex(): void {
    const dirtyIds = this.sceneGraph.getDirtyIds();
    if (dirtyIds.size === 0) return;

    for (const id of dirtyIds) {
      const obj = this.sceneGraph.getById(id);
      if (obj) {
        // Object exists — add or update
        this.spatialIndex.remove(id);
        this.spatialIndex.insert(id, obj.bounds, {
          zIndex: obj.zIndex,
          visible: obj.visible,
          groupId: obj.groupId,
        });
      } else {
        // Object was removed
        this.spatialIndex.remove(id);
      }
    }

    this.sceneGraph.clearDirtyIds();
  }

  // ===========================================================================
  // Viewport Transform Getters (for doc→screen conversion by overlay)
  // ===========================================================================

  /** Current scroll offset (document space). */
  getScrollOffset(): Point {
    return this.scrollOffset;
  }

  /** Current zoom level. */
  getZoom(): number {
    return this.zoom;
  }

  /** Top-left origin of the render region in screen pixels. */
  getRegionOrigin(): Point {
    return this.regionOrigin;
  }

  // ===========================================================================
  // HitTestProvider implementation
  // ===========================================================================

  /**
   * Test whether a screen-space point hits any drawing object.
   *
   * Uses the spatial index for O(1) broad-phase candidate lookup when the
   * index has entries, falling back to O(N) full scan when the index is empty
   * (graceful degradation for callers that don't maintain the index).
   *
   * Converts the screen point to document space, then tests candidates in
   * reverse z-order (topmost first). Returns the first hit as a HitResult
   * with an ObjectHitResult target, or null if nothing is hit.
   */
  hitTest(screenPoint: Point): HitResult | null {
    // Convert screen point to document space
    const docX = (screenPoint.x - this.regionOrigin.x) / this.zoom + this.scrollOffset.x;
    const docY = (screenPoint.y - this.regionOrigin.y) / this.zoom + this.scrollOffset.y;

    // Sync spatial index with scene graph dirty state
    this.syncIndex();

    // Use spatial index for broad-phase when it has entries
    if (this.spatialIndex.size() > 0) {
      return this.hitTestWithSpatialIndex(docX, docY, screenPoint);
    }

    // Fallback: O(N) scan (when spatial index is empty)
    return this.hitTestLinearScan(docX, docY, screenPoint);
  }

  /**
   * Broad-phase via spatial index + narrow-phase via Path2D,
   * using the unified hitTestPipeline from @mog/spatial.
   */
  private hitTestWithSpatialIndex(
    docX: number,
    docY: number,
    screenPoint: Point,
  ): HitResult | null {
    const hit = hitTestPipeline(
      this.spatialIndex,
      { x: docX, y: docY },
      (entry) => entry.data.zIndex,
      {
        test: (entry, point) => {
          if (!entry.data.visible) return false;
          const path = this.bodyPaths.get(entry.id);
          if (!path) return true; // no path registered yet — accept broad-phase hit
          const ctx = this.getOffscreenCtx();
          if (!ctx) return true;
          return testPointInPath(ctx, path, point.x, point.y);
        },
      },
    );

    if (!hit) return null;

    return {
      layerId: this.layerId,
      target: {
        objectId: hit.id,
        groupId: hit.data.groupId,
        region: 'body' as const,
      },
      position: screenPoint,
    };
  }

  /**
   * Fallback O(N) linear scan (used when spatial index is empty).
   */
  private hitTestLinearScan(docX: number, docY: number, screenPoint: Point): HitResult | null {
    // Get objects sorted by z-index (ascending)
    const objects = this.sceneGraph.getByZOrder();

    // Iterate in reverse order (topmost first) for correct visual hit priority
    for (let i = objects.length - 1; i >= 0; i--) {
      const obj = objects[i];

      // Skip invisible objects
      if (!obj.visible) continue;

      // Fast bounding-box rejection
      const b = obj.bounds;
      if (docX < b.x || docY < b.y || docX > b.x + b.width || docY > b.y + b.height) continue;

      // Pixel-perfect hit testing via testPointInPath() when a Path2D is registered.
      const path = this.bodyPaths.get(obj.id);
      if (path) {
        const ctx = this.getOffscreenCtx();
        if (ctx && !testPointInPath(ctx, path, docX, docY)) continue;
      }

      const target: ObjectHitResult = {
        objectId: obj.id,
        groupId: obj.groupId,
        region: 'body',
      };

      return {
        layerId: this.layerId,
        target,
        position: screenPoint,
      };
    }

    return null;
  }
}
