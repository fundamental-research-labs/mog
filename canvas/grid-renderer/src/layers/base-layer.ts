/**
 * Base Layer
 *
 * Abstract base class for grid-renderer layers implementing CanvasLayer.
 * Handles dirty tracking boilerplate so layers only need to implement render().
 * Provides off-screen canvas caching for per-layer compositing.
 */

import type {
  CanvasLayer,
  DirtyHint,
  DocSpaceRect,
  FrameContext,
  Rect,
  RenderRegion,
} from '@mog/canvas-engine';
import { DirtyRectAccumulator, snapToPixelGrid } from '@mog/canvas-engine';

export interface BaseLayerConfig {
  readonly id: string;
  readonly zIndex: number;
  readonly renderMode: 'per-region' | 'once';
  readonly canvas: number;
  /** Whether this layer should use off-screen caching. Default: true */
  readonly cacheable?: boolean;
  /** Expand per-region clip rect by this many CSS pixels on all sides. Default: 0 */
  readonly clipPadding?: number;
}

/**
 * Interface for `renderMode: 'once'` layers that paint canvas-spanning
 * chrome (backgrounds, outer borders, freeze-divider lines, the corner
 * cell, etc.) in addition to — or instead of — per-region content.
 *
 * The structural enforcement test
 * `canvas/grid-renderer/src/__tests__/once-layer-region-paint-containment.test.ts`
 * asserts that every paint a once-layer issues is fully contained in
 * either (a) some region's per-region clip band, or (b) a chrome rect
 * declared here. This interface is how layers declare (b).
 *
 * **Author note:** if you're adding a rect to `getChromeExemptions` to
 * silence the containment test, the test is probably asking the right
 * question — make sure that paint really is canvas-spanning chrome and
 * not per-region content that needs `BaseLayer.withRegionBandClip`. A
 * per-region paint that's been declared as chrome is the original bug
 * dressed up as a fix.
 */
export interface OnceLayerWithChrome {
  /**
   * Return the rects (in canvas-absolute CSS pixels, snapped to the same
   * grid the layer paints on) that this layer paints chrome into for the
   * given layout. The structural test treats every fillText / fillRect /
   * strokeRect / rect+stroke whose bbox is fully contained in any of
   * these rects as legitimate chrome.
   */
  getChromeExemptions(args: {
    readonly layout: { readonly regions: ReadonlyArray<{ readonly bounds: Rect }> };
    readonly canvasWidth: number;
    readonly canvasHeight: number;
    readonly dpr: number;
  }): ReadonlyArray<{ x: number; y: number; width: number; height: number }>;
}

export abstract class BaseLayer implements CanvasLayer {
  readonly id: string;
  readonly zIndex: number;
  readonly renderMode: 'per-region' | 'once';
  readonly canvas: number;
  readonly cacheable: boolean;
  readonly clipPadding: number;

  private _accumulator = new DirtyRectAccumulator();
  private _disposed = false;

  /** Off-screen canvas cache for this layer */
  private _cacheCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private _cacheCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  private _cacheWidth = 0;
  private _cacheHeight = 0;

  constructor(config: BaseLayerConfig) {
    this.id = config.id;
    this.zIndex = config.zIndex;
    this.renderMode = config.renderMode;
    this.canvas = config.canvas;
    this.cacheable = config.cacheable ?? true;
    this.clipPadding = config.clipPadding ?? 0;
    // Mark initially dirty so the first frame renders this layer
    this._accumulator.promoteToFull();
  }

  abstract render(ctx: CanvasRenderingContext2D, region: RenderRegion, frame: FrameContext): void;

  isDirty(): boolean {
    return this._accumulator.isDirty() && !this._disposed;
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

  dispose(): void {
    this._disposed = true;
    this._cacheCanvas = null;
    this._cacheCtx = null;
  }

  protected get isDisposed(): boolean {
    return this._disposed;
  }

  // ===========================================================================
  // Region-Band Clip Helper (for renderMode: 'once' layers)
  // ===========================================================================

  /**
   * Apply a pixel-snapped rect clip, run `fn`, restore.
   *
   * Use from `renderMode: 'once'` layers that paint per-region content into
   * a band that depends on a `RenderRegion` — typically a gutter strip
   * (row-header, col-header, outline-gutter) but also any future use where
   * once-mode chrome paints per-region content (floating-object handles,
   * cross-region annotations). Without this clip, a per-row paint at
   * `y + h/2` for the partially-visible top row in a scrolling region lands
   * in the adjacent region's gutter band — the freeze-divider bleed bug.
   *
   * `band` is canvas-absolute CSS pixels. The clip is pixel-snapped so the
   * boundary lands on a physical pixel at any DPR — this kills the class of
   * bugs where a layer-author forgets to snap and gets a 1-pixel anti-
   * aliasing seam at the freeze divider on fractional-DPR displays.
   *
   * The `try/finally` is load-bearing: a once-layer calls this helper N
   * times within a single `render()` (once per region); a throw on
   * iteration k must not leak the clip into iteration k+1, otherwise the
   * next region paints under a stale clip from the previous region's band.
   *
   * @example
   *   for (const reg of this.regions) {
   *     this.withRegionBandClip(
   *       ctx,
   *       { x: headerX, y: reg.bounds.y, width: headerWidth, height: reg.bounds.height },
   *       dpr,
   *       () => {
   *         // per-row loop: highlight, label, per-row bottom border, hidden indicator
   *       },
   *     );
   *   }
   */
  protected withRegionBandClip(
    ctx: CanvasRenderingContext2D,
    band: { x: number; y: number; width: number; height: number },
    dpr: number,
    fn: () => void,
  ): void {
    const x0 = snapToPixelGrid(band.x, dpr);
    const y0 = snapToPixelGrid(band.y, dpr);
    const x1 = snapToPixelGrid(band.x + band.width, dpr);
    const y1 = snapToPixelGrid(band.y + band.height, dpr);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.clip();
    try {
      fn();
    } finally {
      ctx.restore();
    }
  }

  // ===========================================================================
  // Layer Cache API (used by RenderLoop for per-layer compositing)
  // ===========================================================================

  /**
   * Get or create the off-screen cache canvas for this layer.
   * The cache is lazily created and resized to match the physical canvas dimensions.
   * Returns null if the layer is not cacheable.
   */
  getOrCreateCache(
    physicalWidth: number,
    physicalHeight: number,
  ): {
    canvas: OffscreenCanvas | HTMLCanvasElement;
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  } | null {
    if (!this.cacheable) return null;

    // Return existing cache if dimensions match
    if (
      this._cacheCanvas &&
      this._cacheWidth === physicalWidth &&
      this._cacheHeight === physicalHeight
    ) {
      return { canvas: this._cacheCanvas, ctx: this._cacheCtx! };
    }

    // Create or resize cache
    if (typeof OffscreenCanvas !== 'undefined') {
      this._cacheCanvas = new OffscreenCanvas(physicalWidth, physicalHeight);
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = physicalWidth;
      canvas.height = physicalHeight;
      this._cacheCanvas = canvas;
    }

    this._cacheCtx = this._cacheCanvas.getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D;
    this._cacheWidth = physicalWidth;
    this._cacheHeight = physicalHeight;

    // Mark dirty since the cache was just created/resized
    this._accumulator.add({ type: 'full' });

    return { canvas: this._cacheCanvas, ctx: this._cacheCtx };
  }

  /**
   * Clear the layer cache (used before re-rendering a dirty layer to its cache).
   */
  clearCache(): void {
    if (this._cacheCtx && this._cacheCanvas) {
      this._cacheCtx.clearRect(0, 0, this._cacheWidth, this._cacheHeight);
    }
  }

  /**
   * Get the cache canvas for compositing (null if no cache exists).
   */
  getCacheCanvas(): OffscreenCanvas | HTMLCanvasElement | null {
    return this.cacheable ? this._cacheCanvas : null;
  }

  /**
   * Invalidate the cache (e.g., on resize or DPR change).
   */
  invalidateCache(): void {
    this._cacheCanvas = null;
    this._cacheCtx = null;
    this._cacheWidth = 0;
    this._cacheHeight = 0;
    this._accumulator.add({ type: 'full' });
  }
}
