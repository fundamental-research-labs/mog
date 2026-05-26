/**
 * RenderLoop — rAF-Based Render Loop
 *
 * Drives the rendering pipeline: processes scheduler tasks, then renders
 * dirty layers in z-index-first order with per-layer renderMode handling.
 *
 * Key design decisions:
 * - z-index-first iteration (not regions-first) allows once and per-region
 *   layers to interleave freely at arbitrary z-positions.
 * - Animation clock: requestContinuousFrames/stopContinuousFrames keeps the
 *   loop alive for animated layers. Loop stops when idle.
 * - Error boundary: exponential backoff retry, never disable critical layers.
 *
 * @module @mog/canvas-engine/loop
 */

import type {
  AnimationClock,
  CanvasLayer,
  CanvasSpaceRect,
  DocSpaceRect,
  FrameContext,
  LayoutUpdateOptions,
  Rect,
  RegionLayout,
  RenderRegion,
  Size,
} from '../core/types';
import { docToCanvas } from '../core/coordinate-space';
import type { CanvasHost } from '../host/canvas-host';
import type { LayerRegistry } from '../registry/layer-registry';
import type { PriorityScheduler } from '../scheduler/priority-scheduler';
// __OS_DEVTOOLS__ type: use import type to reference canonical definition
import type { OSDevToolsHook } from '@mog/devtools';

declare global {
  interface Window {
    __OS_DEVTOOLS__?: OSDevToolsHook;
  }
}

// =============================================================================
// Types
// =============================================================================

export interface RenderLoopConfig {
  host: CanvasHost;
  registry: LayerRegistry;
  scheduler: PriorityScheduler;
  debugTiming?: boolean;
  onLayerError?: (layerId: string, error: unknown, consecutiveFailures: number) => void;
}

export interface LayerTiming {
  lastMs: number;
  avgMs: number;
  maxMs: number;
}

interface LayerErrorState {
  consecutiveFailures: number;
  backoffFrames: number;
  framesUntilRetry: number;
  disabled: boolean;
  consecutiveSuccesses: number;
}

// =============================================================================
// Constants
// =============================================================================

/** Layer IDs that are NEVER disabled on error */
const CRITICAL_LAYER_IDS = new Set(['background', 'cells', 'selection']);

/** Max consecutive failures before disabling non-critical layers */
const MAX_FAILURES_BEFORE_DISABLE = 10;

/** Consecutive successful frames to auto-reset error count */
const SUCCESS_RESET_THRESHOLD = 60;

/** Pseudo-region ID for 'once' mode layers */
const FULL_CANVAS_REGION_ID = '__full_canvas__';

// =============================================================================
// Implementation
// =============================================================================

export class RenderLoop implements AnimationClock {
  private host: CanvasHost;
  private registry: LayerRegistry;
  private scheduler: PriorityScheduler;
  private debugTiming: boolean;
  private onLayerError: RenderLoopConfig['onLayerError'];

  private running = false;
  private paused = false;
  private rafId: number | null = null;
  private frameNumber = 0;

  /** Layers requesting continuous frame rendering (e.g., marching ants) */
  private continuousFrameLayers = new Set<string>();

  /** Current region layout */
  private layout: RegionLayout | null = null;

  /** Per-layer error state */
  private errorStates = new Map<string, LayerErrorState>();

  /** Per-layer timing (debug mode only) */
  private layerTimings = new Map<string, LayerTiming>();

  /** Previous scroll offsets per region, for detecting scroll changes between frames */
  private previousScrollOffsets = new Map<string, { x: number; y: number }>();

  /** Previous canvas size, for detecting resize changes between frames */
  private previousCanvasSize: { width: number; height: number } | null = null;

  constructor(config: RenderLoopConfig) {
    this.host = config.host;
    this.registry = config.registry;
    this.scheduler = config.scheduler;
    this.debugTiming =
      config.debugTiming ?? !!(typeof window !== 'undefined' && window.__OS_DEVTOOLS__);
    this.onLayerError = config.onLayerError;
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  start(): void {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.scheduleFrame();
  }

  stop(): void {
    this.running = false;
    this.cancelFrame();
  }

  pause(): void {
    this.paused = true;
    this.cancelFrame();
  }

  resume(): void {
    if (!this.running) return;
    this.paused = false;
    // While the tab was hidden Chrome may have evicted the GPU-backed
    // surfaces of our OffscreenCanvas layer caches and zeroed the main
    // canvas. The first frame after resume must therefore be a full
    // repaint, not a partial that composites from a freed cache —
    // otherwise the canvas shows stale pixels even though the kernel,
    // selection actor, and rAF loop have all moved on, and the user
    // perceives a total freeze (input lands, nothing visible changes).
    // Forcing every layer dirty pushes the next frame down the
    // full-cache-clear path in renderAndCompositeLayer.
    this.registry.markAllDirty();
    this.previousScrollOffsets.clear();
    this.previousCanvasSize = null;
    this.scheduleFrame();
  }

  isRunning(): boolean {
    return this.running && !this.paused;
  }

  /** Request a single frame to be rendered */
  requestFrame(): void {
    if (this.running && !this.paused) {
      this.scheduleFrame();
    }
  }

  /** Set the region layout for per-region layers */
  setLayout<TMeta>(layout: RegionLayout<TMeta>, options: LayoutUpdateOptions = {}): void {
    this.layout = layout as RegionLayout;
    if ((options.invalidation ?? 'structural') === 'structural') {
      this.registry.markAllDirty();
    }
  }

  getLayout(): RegionLayout | null {
    return this.layout;
  }

  /** Get per-layer timing stats (debug mode only) */
  getLayerTimings(): ReadonlyMap<string, LayerTiming> {
    return this.layerTimings;
  }

  /** Reset error count for a specific layer (re-enable it) */
  resetErrorCount(layerId: string): void {
    this.errorStates.delete(layerId);
  }

  // ===========================================================================
  // AnimationClock
  // ===========================================================================

  requestContinuousFrames(layerId: string): void {
    this.continuousFrameLayers.add(layerId);
    if (this.running && !this.paused) {
      this.scheduleFrame();
    }
  }

  stopContinuousFrames(layerId: string): void {
    this.continuousFrameLayers.delete(layerId);
  }

  // ===========================================================================
  // Frame Loop
  // ===========================================================================

  private scheduleFrame(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame((timestamp) => this.onFrame(timestamp));
  }

  private cancelFrame(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private onFrame(timestamp: number): void {
    this.rafId = null;
    if (!this.running || this.paused) return;

    // 1. Process scheduler tasks (cheap dirty-marking operations)
    this.scheduler.processFrame();

    // 2. Check if we need to render
    const hasDirty = this.anyCanvasDirty();
    const hasContinuous = this.continuousFrameLayers.size > 0;

    if (hasDirty || hasContinuous) {
      // Mark continuous-frame layers as dirty, using targeted hints when available
      for (const layerId of this.continuousFrameLayers) {
        const layer = this.registry.get(layerId);
        const hint = layer?.getContinuousFrameDirtyHint?.();
        this.registry.markDirty(layerId, hint);
      }

      this.renderFrame(timestamp);
    }

    // 3. Continue loop if there's more work
    if (this.shouldContinue()) {
      this.scheduleFrame();
    }
  }

  private renderFrame(timestamp: number): void {
    // Apply deferred canvas dimension changes in the same frame as the render,
    // preventing a blank-frame flash during resize.
    this.host.flushResize();

    const frame: FrameContext = {
      timestamp,
      canvasSize: this.host.getSize(),
      dpr: this.host.getDPR(),
      frameNumber: this.frameNumber++,
    };

    const physicalWidth = Math.ceil(frame.canvasSize.width * frame.dpr);
    const physicalHeight = Math.ceil(frame.canvasSize.height * frame.dpr);
    const canvasCount = this.host.getCanvasCount();

    // --- Scroll change detection ---
    // If scroll offset changed, dirty rects are in stale pixel coordinates — promote to full
    if (this.layout) {
      let scrollChanged = false;
      for (const region of this.layout.regions) {
        const prev = this.previousScrollOffsets.get(region.id);
        if (prev && (prev.x !== region.scrollOffset.x || prev.y !== region.scrollOffset.y)) {
          scrollChanged = true;
          break;
        }
      }
      if (scrollChanged) {
        this.promoteAllToFull();
      }
      // Snapshot current scroll offsets for next frame comparison
      for (const region of this.layout.regions) {
        this.previousScrollOffsets.set(region.id, {
          x: region.scrollOffset.x,
          y: region.scrollOffset.y,
        });
      }
    }

    // --- Canvas resize detection ---
    if (
      this.previousCanvasSize &&
      (this.previousCanvasSize.width !== frame.canvasSize.width ||
        this.previousCanvasSize.height !== frame.canvasSize.height)
    ) {
      this.promoteAllToFull();
    }
    this.previousCanvasSize = {
      width: frame.canvasSize.width,
      height: frame.canvasSize.height,
    };

    // Render each canvas independently
    for (let canvasIdx = 0; canvasIdx < canvasCount; canvasIdx++) {
      const hasDirty = this.registry.hasDirtyLayers(canvasIdx);
      if (!hasDirty) continue;

      const ctx = this.host.getContext(canvasIdx);
      const layers = this.registry.getVisibleLayersForCanvas(canvasIdx);

      // Compute dirty union for this canvas
      const dirtyUnion = this.collectDirtyUnion(canvasIdx, frame.dpr);

      if (dirtyUnion === null) {
        // --- Full dirty path (current behavior, no regression) ---
        this.clearCanvas(ctx, frame.canvasSize, frame.dpr);

        for (const layer of layers) {
          this.renderAndCompositeLayer(ctx, layer, frame, physicalWidth, physicalHeight, null);
        }
      } else {
        // --- Partial dirty path ---
        // Clear only the dirty rect on the main canvas
        this.clearDirtyRect(ctx, dirtyUnion, frame.dpr);

        // Re-render dirty layers to their caches (partial), then composite
        // ALL layers' dirty region to main canvas (clean layers contribute cached pixels)
        for (const layer of layers) {
          this.renderAndCompositeLayer(
            ctx,
            layer,
            { ...frame, dirtyRects: [dirtyUnion] },
            physicalWidth,
            physicalHeight,
            dirtyUnion,
          );
        }
      }
    }

    // Report frame timings to devtools
    if (this.debugTiming && typeof window !== 'undefined') {
      const devtools = window.__OS_DEVTOOLS__;
      if (devtools) {
        const timings: Record<string, LayerTiming> = {};
        for (const [id, timing] of this.layerTimings) {
          timings[id] = { lastMs: timing.lastMs, avgMs: timing.avgMs, maxMs: timing.maxMs };
        }
        devtools.reportCanvasFrame?.(timings);
      }
    }
  }

  /**
   * Render a single layer, using off-screen cache when available.
   *
   * For cacheable layers (duck-typed via getOrCreateCache):
   * - If dirty: render to cache canvas, then composite to main canvas
   * - If clean: composite from cache (zero render work)
   *
   * For non-cacheable layers or layers without cache support:
   * - Render directly to main canvas (existing behavior)
   *
   * @param dirtyUnion - If non-null, only the dirty rect region needs updating.
   *   For cached dirty layers: partial clear + clip on cache before render.
   *   For compositing: only copy the dirty rect region from cache to main canvas.
   *   If null, full clear + full composite (current behavior).
   */
  private renderAndCompositeLayer(
    mainCtx: CanvasRenderingContext2D,
    layer: CanvasLayer,
    frame: FrameContext,
    physicalWidth: number,
    physicalHeight: number,
    dirtyUnion: CanvasSpaceRect | null,
  ): void {
    // Check error state
    const errorState = this.errorStates.get(layer.id);
    if (errorState) {
      if (errorState.disabled) return;
      if (errorState.framesUntilRetry > 0) {
        errorState.framesUntilRetry--;
        return;
      }
    }

    const startTime = this.debugTiming ? performance.now() : 0;

    try {
      // Duck-type check for cacheable layers (BaseLayer from grid-renderer)
      const cacheableLayer = layer as CanvasLayer & {
        getOrCreateCache?: (
          w: number,
          h: number,
        ) => {
          canvas: OffscreenCanvas | HTMLCanvasElement;
          ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
        } | null;
        clearCache?: () => void;
      };

      const cache = cacheableLayer.getOrCreateCache?.(physicalWidth, physicalHeight);

      if (cache) {
        // === Cached layer path ===
        if (layer.isDirty()) {
          if (dirtyUnion !== null) {
            // --- Partial cache clear + clip ---
            // DPR transform is active, so dirty rect coords are CSS pixels
            cache.ctx.save();
            cache.ctx.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);

            // Clear only the dirty rect on the cache
            cache.ctx.clearRect(dirtyUnion.x, dirtyUnion.y, dirtyUnion.width, dirtyUnion.height);

            if (layer.renderMode === 'per-region') {
              // For per-region layers, the dirty rect clip must be applied AFTER
              // the per-region translate (in region-local coordinates). Clipping
              // here in canvas-space would cause drawing at region-local coords
              // to fall outside the clip, producing zero pixels.
              // The clip is applied inside renderPerRegion() using frame.dirtyRects.
              this.renderPerRegion(cache.ctx as CanvasRenderingContext2D, layer, frame);
            } else {
              // For once-mode layers, canvas-space clip is correct (no translate)
              cache.ctx.beginPath();
              cache.ctx.rect(dirtyUnion.x, dirtyUnion.y, dirtyUnion.width, dirtyUnion.height);
              cache.ctx.clip();
              this.renderOnce(cache.ctx as CanvasRenderingContext2D, layer, frame);
            }

            cache.ctx.restore();
          } else {
            // --- Full cache clear (current behavior) ---
            cacheableLayer.clearCache?.();

            cache.ctx.save();
            cache.ctx.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);

            if (layer.renderMode === 'per-region') {
              this.renderPerRegion(cache.ctx as CanvasRenderingContext2D, layer, frame);
            } else {
              this.renderOnce(cache.ctx as CanvasRenderingContext2D, layer, frame);
            }

            cache.ctx.restore();
          }
          layer.markClean();
        }

        // Composite cache to main canvas
        if (dirtyUnion !== null) {
          // --- Partial composite ---
          // Under identity transform, use physical pixel coordinates for drawImage
          const dpr = frame.dpr;
          const physX = Math.floor(dirtyUnion.x * dpr);
          const physY = Math.floor(dirtyUnion.y * dpr);
          const physW = Math.ceil((dirtyUnion.x + dirtyUnion.width) * dpr) - physX;
          const physH = Math.ceil((dirtyUnion.y + dirtyUnion.height) * dpr) - physY;

          mainCtx.save();
          mainCtx.setTransform(1, 0, 0, 1, 0, 0);
          mainCtx.drawImage(
            cache.canvas,
            physX,
            physY,
            physW,
            physH, // source rect (physical pixels on cache)
            physX,
            physY,
            physW,
            physH, // dest rect (same position on main canvas)
          );
          mainCtx.restore();
        } else {
          // --- Full composite (current behavior) ---
          mainCtx.save();
          mainCtx.setTransform(1, 0, 0, 1, 0, 0);
          mainCtx.drawImage(cache.canvas, 0, 0);
          mainCtx.restore();
        }
      } else {
        // === Non-cached layer: render directly ===
        // When in partial dirty path, clip to dirty rect to prevent
        // semi-transparent content from accumulating alpha outside the
        // cleared region (e.g., selection fill during marching ants animation).
        if (dirtyUnion !== null) {
          mainCtx.save();
          mainCtx.beginPath();
          mainCtx.rect(dirtyUnion.x, dirtyUnion.y, dirtyUnion.width, dirtyUnion.height);
          mainCtx.clip();
        }
        if (layer.renderMode === 'per-region') {
          this.renderPerRegion(mainCtx, layer, frame);
        } else {
          this.renderOnce(mainCtx, layer, frame);
        }
        if (dirtyUnion !== null) {
          mainCtx.restore();
        }
        layer.markClean();
      }

      // Success — update error state
      if (errorState) {
        errorState.consecutiveSuccesses++;
        if (errorState.consecutiveSuccesses >= SUCCESS_RESET_THRESHOLD) {
          this.errorStates.delete(layer.id);
        }
      }
    } catch (error) {
      this.handleLayerError(layer.id, error);
    }

    // Debug timing
    if (this.debugTiming) {
      const elapsed = performance.now() - startTime;
      this.updateLayerTiming(layer.id, elapsed);
    }
  }

  private renderPerRegion(
    ctx: CanvasRenderingContext2D,
    layer: CanvasLayer,
    frame: FrameContext,
  ): void {
    const regions = this.layout?.regions;
    if (!regions || regions.length === 0) {
      // No layout yet — skip per-region layers (they require region metadata)
      return;
    }

    for (const region of regions) {
      ctx.save();

      // Clip to region bounds, optionally expanded by clipPadding for layers
      // whose strokes extend slightly beyond region edges (e.g., selection borders).
      const pad = layer.clipPadding ?? 0;
      ctx.beginPath();
      ctx.rect(
        region.bounds.x - pad,
        region.bounds.y - pad,
        region.bounds.width + pad * 2,
        region.bounds.height + pad * 2,
      );
      ctx.clip();

      // Translate to region origin
      ctx.translate(region.bounds.x, region.bounds.y);

      // Apply zoom
      if (region.zoom !== 1) {
        ctx.scale(region.zoom, region.zoom);
      }

      // Apply dirty rect clip in region-local coordinates (after translate+zoom)
      if (frame.dirtyRects && frame.dirtyRects.length > 0) {
        const zoom = region.zoom || 1;
        ctx.beginPath();
        for (const dr of frame.dirtyRects) {
          const localX = (dr.x - region.bounds.x) / zoom;
          const localY = (dr.y - region.bounds.y) / zoom;
          const localW = dr.width / zoom;
          const localH = dr.height / zoom;
          ctx.rect(localX, localY, localW, localH);
        }
        ctx.clip();
      }

      layer.render(ctx, region, frame);

      ctx.restore();
    }
  }

  private renderOnce(ctx: CanvasRenderingContext2D, layer: CanvasLayer, frame: FrameContext): void {
    const fullRegion = this.createFullCanvasRegion(frame.canvasSize);
    layer.render(ctx, fullRegion, frame);
  }

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  private handleLayerError(layerId: string, error: unknown): void {
    let state = this.errorStates.get(layerId);
    if (!state) {
      state = {
        consecutiveFailures: 0,
        backoffFrames: 1,
        framesUntilRetry: 0,
        disabled: false,
        consecutiveSuccesses: 0,
      };
      this.errorStates.set(layerId, state);
    }

    state.consecutiveFailures++;
    state.consecutiveSuccesses = 0;

    // Exponential backoff: 1, 2, 4, 8 frames
    state.backoffFrames = Math.min(8, Math.pow(2, state.consecutiveFailures - 1));
    state.framesUntilRetry = state.backoffFrames;

    // Disable non-critical layers after MAX_FAILURES_BEFORE_DISABLE
    const isCritical = CRITICAL_LAYER_IDS.has(layerId);
    if (!isCritical && state.consecutiveFailures >= MAX_FAILURES_BEFORE_DISABLE) {
      state.disabled = true;
    }

    // Always mark dirty for retry (if not disabled)
    if (!state.disabled) {
      this.registry.markDirty(layerId);
    }

    // Emit error event
    this.onLayerError?.(layerId, error, state.consecutiveFailures);

    console.error(
      `[RenderLoop] Layer '${layerId}' error (failure #${state.consecutiveFailures}):`,
      error,
    );
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Collect the union dirty rect from all dirty layers on a canvas.
   * Returns null if any layer is full-dirty (meaning full repaint needed).
   * The returned rect is in CSS pixels.
   */
  private collectDirtyUnion(canvasIndex: number, dpr: number): CanvasSpaceRect | null {
    const layers = this.registry.getVisibleLayersForCanvas(canvasIndex);
    let hasPartialDirty = false;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    for (const layer of layers) {
      if (!layer.isDirty()) continue;

      // If any layer doesn't support dirty rects or is full dirty, fall back
      if (!layer.isFullDirty || !layer.getDirtyRects || layer.isFullDirty()) {
        return null; // full repaint
      }

      const rects = layer.getDirtyRects();
      if (rects.length === 0) continue;

      // All layers emit dirty rects in document-space (DirtyHint.bounds is DocSpaceRect).
      // Convert to canvas-space via docToCanvas() for each region.
      const regions = this.layout?.regions;

      if (!regions || regions.length === 0) {
        // No layout yet — fall back to full repaint
        return null;
      }

      hasPartialDirty = true;
      for (const r of rects) {
        // Convert doc-space rect to canvas-space for each region it may appear in
        for (const region of regions) {
          const canvasRect = docToCanvas(r as DocSpaceRect, region);
          minX = Math.min(minX, canvasRect.x);
          minY = Math.min(minY, canvasRect.y);
          maxX = Math.max(maxX, canvasRect.x + canvasRect.width);
          maxY = Math.max(maxY, canvasRect.y + canvasRect.height);
        }
      }
    }

    if (!hasPartialDirty) return null;

    // Expand by snap safety margin: ceil(1/dpr) in each direction
    const margin = Math.ceil(1 / dpr);
    minX -= margin;
    minY -= margin;
    maxX += margin;
    maxY += margin;

    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY } as CanvasSpaceRect;
  }

  /**
   * Promote all dirty layers that support partial dirty to full dirty.
   * Used when scroll or resize invalidates accumulated dirty rect coordinates.
   */
  private promoteAllToFull(): void {
    for (const entry of this.registry.getAllSorted()) {
      if (entry.isDirty() && entry.isFullDirty && !entry.isFullDirty()) {
        entry.markDirty({ type: 'full' });
      }
    }
  }

  private clearCanvas(ctx: CanvasRenderingContext2D, size: Size, dpr: number): void {
    // Reset transform to clear the full physical canvas
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size.width * dpr, size.height * dpr);
    ctx.restore();
  }

  /**
   * Clear only the dirty rect region on a canvas context.
   * Operates under identity transform with physical pixels, same as clearCanvas.
   */
  private clearDirtyRect(
    ctx: CanvasRenderingContext2D,
    dirtyUnion: CanvasSpaceRect,
    dpr: number,
  ): void {
    // Convert CSS dirty rect to physical pixels: floor origin, ceil far edge
    const physX = Math.floor(dirtyUnion.x * dpr);
    const physY = Math.floor(dirtyUnion.y * dpr);
    const physW = Math.ceil((dirtyUnion.x + dirtyUnion.width) * dpr) - physX;
    const physH = Math.ceil((dirtyUnion.y + dirtyUnion.height) * dpr) - physY;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(physX, physY, physW, physH);
    ctx.restore();
  }

  private createFullCanvasRegion(size: Size): RenderRegion {
    return {
      id: FULL_CANVAS_REGION_ID,
      bounds: { x: 0, y: 0, width: size.width, height: size.height },
      viewportOrigin: { x: 0, y: 0 },
      scrollOffset: { x: 0, y: 0 },
      zoom: 1,
      metadata: undefined,
    };
  }

  private anyCanvasDirty(): boolean {
    const canvasCount = this.host.getCanvasCount();
    for (let i = 0; i < canvasCount; i++) {
      if (this.registry.hasDirtyLayers(i)) return true;
    }
    return false;
  }

  private shouldContinue(): boolean {
    // Continue if: dirty layers, continuous frames, or scheduler has work
    return this.anyCanvasDirty() || this.continuousFrameLayers.size > 0 || this.scheduler.hasWork();
  }

  private updateLayerTiming(layerId: string, elapsed: number): void {
    let timing = this.layerTimings.get(layerId);
    if (!timing) {
      timing = { lastMs: 0, avgMs: 0, maxMs: 0 };
      this.layerTimings.set(layerId, timing);
    }
    timing.lastMs = elapsed;
    // Rolling average (approximate, weighted towards recent)
    timing.avgMs = timing.avgMs * 0.9 + elapsed * 0.1;
    timing.maxMs = Math.max(timing.maxMs, elapsed);
  }
}
