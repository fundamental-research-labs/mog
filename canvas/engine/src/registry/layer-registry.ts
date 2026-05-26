/**
 * LayerRegistry — Layer Management & Dirty Tracking
 *
 * Manages canvas layer registration, z-order sorting, per-canvas grouping,
 * visibility control, and dirty state tracking.
 *
 * @module @mog/canvas-engine/registry
 */

import type { CanvasLayer, DirtyHint } from '../core/types';

interface LayerEntry {
  layer: CanvasLayer;
  visible: boolean;
}

/**
 * Registry for canvas layers with dirty tracking and visibility control.
 *
 * Layers are sorted by zIndex within each canvas. The sorted cache is
 * rebuilt lazily when the registry is modified.
 */
export class LayerRegistry {
  private layers = new Map<string, LayerEntry>();
  private sortedCacheDirty = true;
  /** Sorted layers per canvas index */
  private sortedByCanvas = new Map<number, CanvasLayer[]>();
  /** All layers sorted by zIndex (used by render loop for z-index-first iteration) */
  private allSorted: CanvasLayer[] = [];

  // ===========================================================================
  // Registration
  // ===========================================================================

  register(layer: CanvasLayer): void {
    if (this.layers.has(layer.id)) {
      throw new Error(`Layer '${layer.id}' is already registered`);
    }
    this.layers.set(layer.id, { layer, visible: true });
    this.sortedCacheDirty = true;
  }

  unregister(id: string): void {
    const entry = this.layers.get(id);
    if (entry) {
      entry.layer.dispose();
      this.layers.delete(id);
      this.sortedCacheDirty = true;
    }
  }

  get(id: string): CanvasLayer | undefined {
    return this.layers.get(id)?.layer;
  }

  has(id: string): boolean {
    return this.layers.has(id);
  }

  // ===========================================================================
  // Visibility
  // ===========================================================================

  setVisibility(id: string, visible: boolean): void {
    const entry = this.layers.get(id);
    if (entry) {
      entry.visible = visible;
    }
  }

  isVisible(id: string): boolean {
    return this.layers.get(id)?.visible ?? false;
  }

  // ===========================================================================
  // Sorted Access
  // ===========================================================================

  /**
   * Get layers for a specific canvas index, sorted by zIndex.
   * Only returns visible layers.
   */
  getLayersForCanvas(canvasIndex: number): ReadonlyArray<CanvasLayer> {
    this.rebuildIfNeeded();
    return this.sortedByCanvas.get(canvasIndex) ?? [];
  }

  /**
   * Get ALL visible layers sorted by zIndex (across all canvases).
   * Used by render loop for z-index-first iteration.
   */
  getAllSorted(): ReadonlyArray<CanvasLayer> {
    this.rebuildIfNeeded();
    return this.allSorted;
  }

  /**
   * Get visible layers for a specific canvas, sorted by zIndex.
   * Includes both 'per-region' and 'once' layers interleaved by z-order.
   */
  getVisibleLayersForCanvas(canvasIndex: number): ReadonlyArray<CanvasLayer> {
    this.rebuildIfNeeded();
    return this.sortedByCanvas.get(canvasIndex) ?? [];
  }

  // ===========================================================================
  // Dirty Tracking Facade
  // ===========================================================================

  /**
   * Mark a specific layer as dirty.
   * Only marks if the layer exists and is visible.
   */
  markDirty(id: string, hint?: DirtyHint): void {
    const entry = this.layers.get(id);
    if (entry && entry.visible) {
      entry.layer.markDirty(hint);
    }
  }

  /** Mark all visible layers as dirty */
  markAllDirty(): void {
    for (const entry of this.layers.values()) {
      if (entry.visible) {
        entry.layer.markDirty({ type: 'full' });
      }
    }
  }

  /**
   * Check if any visible layers on a specific canvas are dirty.
   * If no canvas specified, checks all canvases.
   */
  hasDirtyLayers(canvasIndex?: number): boolean {
    for (const entry of this.layers.values()) {
      if (!entry.visible) continue;
      if (canvasIndex !== undefined && entry.layer.canvas !== canvasIndex) continue;
      if (entry.layer.isDirty()) return true;
    }
    return false;
  }

  /** Mark a specific layer as clean */
  markClean(id: string): void {
    const entry = this.layers.get(id);
    if (entry) {
      entry.layer.markClean();
    }
  }

  // ===========================================================================
  // Bulk Operations
  // ===========================================================================

  /** Reset all layers (mark clean, useful for full redraw scenarios) */
  resetAll(): void {
    for (const entry of this.layers.values()) {
      entry.layer.markClean();
    }
  }

  /** Dispose all layers and clear the registry */
  disposeAll(): void {
    for (const entry of this.layers.values()) {
      entry.layer.dispose();
    }
    this.layers.clear();
    this.sortedByCanvas.clear();
    this.allSorted = [];
    this.sortedCacheDirty = true;
  }

  /** Get the total number of registered layers */
  get size(): number {
    return this.layers.size;
  }

  // ===========================================================================
  // Internal
  // ===========================================================================

  private rebuildIfNeeded(): void {
    if (!this.sortedCacheDirty) return;
    this.sortedCacheDirty = false;

    // Clear caches
    this.sortedByCanvas.clear();

    // Collect visible layers
    const visible: CanvasLayer[] = [];
    for (const entry of this.layers.values()) {
      if (entry.visible) {
        visible.push(entry.layer);
      }
    }

    // Sort by zIndex
    visible.sort((a, b) => a.zIndex - b.zIndex);
    this.allSorted = visible;

    // Group by canvas
    for (const layer of visible) {
      let list = this.sortedByCanvas.get(layer.canvas);
      if (!list) {
        list = [];
        this.sortedByCanvas.set(layer.canvas, list);
      }
      list.push(layer);
    }
  }
}
