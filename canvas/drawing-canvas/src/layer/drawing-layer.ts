/**
 * Drawing Layer
 *
 * Implements the CanvasLayer interface from canvas-engine to render all floating
 * objects (pictures, textboxes, shapes, charts, ink, equations, diagram).
 *
 * The layer iterates the scene graph in z-order and dispatches each visible object
 * to the correct renderer via dispatchRender(). It performs viewport culling by
 * testing object bounds against the visible region (AABB intersection).
 * The scene graph is the single authority for object state — interactive
 * operations (drag/resize/rotate) update the scene graph directly.
 *
 * Coordinate contract (per-region mode):
 *   The engine pre-configures the canvas context with clip, translate (to region
 *   bounds origin), and scale (by region.zoom). The layer draws in "region-local
 *   document space": document position minus scrollOffset.
 *
 * Ownership:
 *   The layer does NOT own the SceneGraph or BridgeRegistry (they are owned by
 *   the factory). It DOES clear the ImageCache on dispose since cached images
 *   are rendering-specific resources.
 *
 * @module @mog/drawing-canvas/layer/drawing-layer
 */

import type {
  CanvasLayer,
  DirtyHint,
  DocSpaceRect,
  FrameContext,
  Rect,
  RenderRegion,
  TextMeasurer,
} from '@mog/canvas-engine';
import { DirtyRectAccumulator, regionLocalVisibleRect } from '@mog/canvas-engine';
import type { BridgeRegistry } from '../bridges/bridge-registry';
import type { HitMap } from '../hit-testing/hit-map';
import { dispatchRender } from '../renderers/dispatcher';
import type { ImageCache } from '../renderers/image-cache';
import type { SceneGraph } from '../scene/scene-graph';

// =============================================================================
// Configuration
// =============================================================================

export interface DrawingLayerConfig {
  sceneGraph: SceneGraph;
  bridges: BridgeRegistry;
  imageCache: ImageCache;
  hitMap?: HitMap | null;
  textMeasurer?: TextMeasurer | null;
}

// =============================================================================
// Drawing Layer
// =============================================================================

export class DrawingLayer implements CanvasLayer {
  // ---------------------------------------------------------------------------
  // CanvasLayer constants
  // ---------------------------------------------------------------------------

  readonly id = 'drawing';
  readonly zIndex = 500;
  readonly renderMode = 'per-region' as const;
  readonly canvas = 0;

  // ---------------------------------------------------------------------------
  // Dependencies
  // ---------------------------------------------------------------------------

  private readonly sceneGraph: SceneGraph;
  private readonly bridges: BridgeRegistry;
  private readonly imageCache: ImageCache;
  private readonly hitMap: HitMap | null;
  private readonly textMeasurer: TextMeasurer | null;

  // ---------------------------------------------------------------------------
  // Dirty tracking
  // ---------------------------------------------------------------------------

  private _accumulator = new DirtyRectAccumulator();

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  constructor(config: DrawingLayerConfig) {
    this.sceneGraph = config.sceneGraph;
    this.bridges = config.bridges;
    this.imageCache = config.imageCache;
    this.hitMap = config.hitMap ?? null;
    this.textMeasurer = config.textMeasurer ?? null;
    // Mark initially dirty so the first frame renders this layer
    this._accumulator.promoteToFull();
  }

  // ---------------------------------------------------------------------------
  // CanvasLayer implementation
  // ---------------------------------------------------------------------------

  /**
   * Render all visible drawing objects within the given region.
   *
   * For each object in z-order:
   *   1. Skip if not visible
   *   2. Cull if object bounds do not intersect the visible region
   *   3. Dispatch to the type-specific renderer
   */
  render(ctx: CanvasRenderingContext2D, region: RenderRegion, frame: FrameContext): void {
    // Sync hit map with current viewport state for accurate hit testing
    this.hitMap?.clear();
    this.hitMap?.setViewportTransform(region.scrollOffset, region.zoom, frame.dpr, {
      x: region.bounds.x,
      y: region.bounds.y,
    });

    const objects = this.sceneGraph.getByZOrder();
    // Translate from region-local space to document space minus scrollOffset.
    // The engine already translated ctx to region.bounds origin; we subtract
    // scrollOffset so object renderers can use document-space coordinates
    // directly and they appear anchored to cells during scrolling.
    ctx.translate(-region.scrollOffset.x, -region.scrollOffset.y);

    const visible = regionLocalVisibleRect(region);
    const visibleWidth = visible.width;
    const visibleHeight = visible.height;

    for (let i = 0; i < objects.length; i++) {
      const obj = objects[i];

      // 1. Skip invisible objects
      if (!obj.visible) continue;

      // 2. Viewport culling — convert object bounds from document space to
      //    region-local space and test AABB intersection with region bounds.
      const left = obj.bounds.x - region.scrollOffset.x;
      const top = obj.bounds.y - region.scrollOffset.y;
      const right = left + obj.bounds.width;
      const bottom = top + obj.bounds.height;

      if (right < 0 || bottom < 0 || left > visibleWidth || top > visibleHeight) {
        continue;
      }

      // 3. Dispatch to the type-specific renderer
      dispatchRender(ctx, obj, this.bridges, this.imageCache, this.textMeasurer, this.hitMap);
    }
  }

  isDirty(): boolean {
    return this._accumulator.isDirty();
  }

  markDirty(hint?: DirtyHint): void {
    this._accumulator.add(hint ?? { type: 'full' });
  }

  markClean(): void {
    this._accumulator.clear();
  }

  getDirtyRects(): readonly DocSpaceRect[] {
    return this._accumulator.getRects();
  }

  isFullDirty(): boolean {
    return this._accumulator.isFull();
  }

  /**
   * Release rendering resources.
   *
   * Clears the image cache (rendering-specific). Does NOT dispose the
   * SceneGraph or BridgeRegistry — those are owned by the factory.
   */
  dispose(): void {
    this.imageCache.clear();
  }
}
