/**
 * Overlay Layer
 *
 * The main OverlayLayer that implements CanvasLayer from @mog/canvas-engine.
 * Renders screen-space UX chrome on canvas 1 (the top canvas): selection outlines,
 * handles, guides, rubber band, drag preview, and ink preview.
 *
 * Also implements HitTestProvider for handle hit testing.
 *
 * All coordinates are in screen-space CSS pixels (post-zoom).
 *
 * @module @mog/canvas-overlay/overlay-layer
 */

import type {
  CanvasLayer,
  DirtyHint,
  DocSpaceRect,
  FrameContext,
  HitResult,
  HitTestProvider,
  Point,
  Rect,
  RenderRegion,
} from '@mog/canvas-engine';
import { DirtyRectAccumulator } from '@mog/canvas-engine';
import type { OverlayDataSource } from '@mog-sdk/contracts/rendering';

import { renderConnectionPointIndicators } from './connection-points';
import type { CustomHandle } from './custom-handles';
import { renderCustomHandles } from './custom-handles';
import { renderDragPreview } from './drag-preview';
import { hitTestHandles } from './handle-hit-testing';
import { renderInkPreview } from './ink-preview';
import { renderInsertionPreview } from './insertion-preview';
import { renderRubberBand } from './rubber-band';
import {
  renderGroupOutline,
  renderResizeHandles,
  renderRotationHandle,
  renderSelectionOutline,
} from './selection-chrome';
import { renderSmartGuides } from './smart-guides';
import type { OverlayConfig, ScreenBounds } from './types';
import { DEFAULT_OVERLAY_CONFIG, getHandleVisibility } from './types';

// =============================================================================
// Configuration
// =============================================================================

/**
 * Configuration for creating an OverlayLayer.
 */
export interface OverlayLayerConfig {
  /** Data source for overlay state (selection, guides, drag preview, etc.) */
  readonly dataSource: OverlayDataSource;
  /** Partial overlay configuration (merged with defaults) */
  readonly config?: Partial<OverlayConfig>;
  /** Custom handles to render and hit-test (e.g., WordArt warp-adjust) */
  readonly customHandles?: ReadonlyArray<CustomHandle>;
}

// =============================================================================
// OverlayLayer
// =============================================================================

/**
 * The overlay layer renders screen-space UX chrome on canvas 1.
 *
 * Compositing order (back to front):
 *   1. Selection outlines (per-object solid outlines)
 *   2. Group bounding box (dashed, multi-selection only)
 *   3. Resize handles
 *   4. Rotation handle
 *   5. Custom handles
 *   6. Connection point indicators (during connector drag)
 *   7. Smart guide lines
 *   8. Rubber band selection
 *   9. Drag preview
 *  10. Insertion preview (drag-to-insert shape)
 *  11. Ink preview (strokes, eraser, lasso)
 */
export class OverlayLayer implements CanvasLayer, HitTestProvider {
  // CanvasLayer identity
  readonly id = 'overlay';
  readonly zIndex = 0;
  readonly renderMode = 'once' as const;
  readonly canvas = 1;

  // Internal state
  private _accumulator = new DirtyRectAccumulator();
  private readonly _dataSource: OverlayDataSource;
  private readonly _config: OverlayConfig;
  private readonly _customHandles: ReadonlyArray<CustomHandle>;

  /** Stashed context from last render -- used by hitTest */
  private _lastCtx: CanvasRenderingContext2D | null = null;

  constructor(layerConfig: OverlayLayerConfig) {
    this._dataSource = layerConfig.dataSource;
    this._config = { ...DEFAULT_OVERLAY_CONFIG, ...layerConfig.config };
    this._customHandles = layerConfig.customHandles ?? [];
    // Mark initially dirty so the first frame renders this layer
    this._accumulator.promoteToFull();
  }

  // ===========================================================================
  // CanvasLayer: Dirty Tracking
  // ===========================================================================

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

  // ===========================================================================
  // CanvasLayer: Render
  // ===========================================================================

  render(ctx: CanvasRenderingContext2D, _region: RenderRegion, _frame: FrameContext): void {
    // Stash context for hit testing
    this._lastCtx = ctx;

    const ds = this._dataSource;
    const config = this._config;

    const selectedIds = ds.getSelectedObjectIds();

    // ----- 1. Selection outlines (per-object, solid) -----
    for (const id of selectedIds) {
      const rawBounds = ds.getObjectBounds(id);
      if (!rawBounds) continue;

      const rotation = ds.getObjectRotation(id);
      const bounds: ScreenBounds = { ...rawBounds, rotation };
      renderSelectionOutline(ctx, bounds, config);
    }

    // ----- 2. Group bounding box (dashed, multi-selection only) -----
    const isMultiSelect = selectedIds.length >= 2;
    let groupBounds: { x: number; y: number; width: number; height: number } | null = null;

    if (isMultiSelect) {
      groupBounds = ds.getSelectedObjectBounds();
      if (groupBounds) {
        renderGroupOutline(ctx, groupBounds, config);
      }
    }

    // ----- 3 & 4. Resize handles + Rotation handle -----
    if (selectedIds.length > 0) {
      if (isMultiSelect) {
        // Multi-select: handles on group bounding box (no rotation)
        if (groupBounds) {
          const groupScreenBounds: ScreenBounds = { ...groupBounds, rotation: 0 };
          // Group is not "locked" -- if all objects locked, show no handles
          const allLocked = selectedIds.every((id) => ds.isObjectLocked(id));
          const visibility = getHandleVisibility(groupScreenBounds, allLocked, config);
          renderResizeHandles(ctx, groupScreenBounds, visibility, config);
          if (visibility !== 'none') {
            renderRotationHandle(ctx, groupScreenBounds, config);
          }
        }
      } else {
        // Single select: handles on the object itself
        const id = selectedIds[0];
        const rawBounds = ds.getObjectBounds(id);
        if (rawBounds) {
          const rotation = ds.getObjectRotation(id);
          const bounds: ScreenBounds = { ...rawBounds, rotation };
          const locked = ds.isObjectLocked(id);
          const visibility = getHandleVisibility(bounds, locked, config);
          renderResizeHandles(ctx, bounds, visibility, config);
          if (visibility !== 'none') {
            renderRotationHandle(ctx, bounds, config);
          }
        }
      }
    }

    // ----- 5. Custom handles -----
    if (this._customHandles.length > 0 && selectedIds.length === 1) {
      const id = selectedIds[0];
      const rawBounds = ds.getObjectBounds(id);
      if (rawBounds) {
        const rotation = ds.getObjectRotation(id);
        const bounds: ScreenBounds = { ...rawBounds, rotation };
        renderCustomHandles(ctx, this._customHandles, bounds);
      }
    }

    // ----- 6. Connection point indicators -----
    const connectionPointIndicators = ds.getConnectionPointIndicators();
    if (connectionPointIndicators) {
      renderConnectionPointIndicators(ctx, connectionPointIndicators, config);
    }

    // ----- 7. Smart guide lines -----
    const guides = ds.getGuides();
    if (guides.length > 0) {
      renderSmartGuides(ctx, guides, config);
    }

    // ----- 8. Rubber band -----
    const rubberBand = ds.getRubberBand();
    if (rubberBand) {
      renderRubberBand(ctx, rubberBand, config);
    }

    // ----- 9. Drag preview -----
    const dragPreview = ds.getDragPreview();
    if (dragPreview) {
      renderDragPreview(ctx, dragPreview, (id: string) => ds.getObjectBounds(id), config);
    }

    // ----- 10. Insertion preview -----
    const insertionPreview = ds.getInsertionPreview();
    if (insertionPreview) {
      renderInsertionPreview(ctx, insertionPreview, config);
    }

    // ----- 11. Ink preview -----
    const inkPreview = ds.getInkPreview();
    if (inkPreview) {
      renderInkPreview(ctx, inkPreview);
    }
  }

  // ===========================================================================
  // HitTestProvider
  // ===========================================================================

  hitTest(screenPoint: Point): HitResult | null {
    if (!this._lastCtx) return null;

    const ds = this._dataSource;
    const selectedIds = ds.getSelectedObjectIds();
    if (selectedIds.length === 0) return null;

    const isMultiSelect = selectedIds.length >= 2;
    let groupBoundsForHit: ScreenBounds | null = null;

    if (isMultiSelect) {
      const rawGroup = ds.getSelectedObjectBounds();
      if (rawGroup) {
        groupBoundsForHit = { ...rawGroup, rotation: 0 };
      }
    }

    const getObjectBoundsForHit = (id: string): ScreenBounds | null => {
      const rawBounds = ds.getObjectBounds(id);
      if (!rawBounds) return null;
      const rotation = ds.getObjectRotation(id);
      return { ...rawBounds, rotation };
    };

    // Reset DPR transform for hit testing. isPointInPath applies the CTM to
    // the Path2D but NOT to the test point, so with a DPR scale active the
    // paths would be at 2x while the test point stays in CSS-pixel space.
    this._lastCtx.save();
    this._lastCtx.setTransform(1, 0, 0, 1, 0, 0);

    const result = hitTestHandles(
      this._lastCtx,
      screenPoint,
      selectedIds,
      getObjectBoundsForHit,
      (id: string) => ds.isObjectLocked(id),
      groupBoundsForHit,
      this._customHandles,
      this._config,
    );

    this._lastCtx.restore();

    if (!result) return null;

    return {
      layerId: this.id,
      target: result,
      position: screenPoint,
    };
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  dispose(): void {
    this._lastCtx = null;
    this._accumulator.clear();
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create an OverlayLayer with merged configuration.
 *
 * @param config - Layer configuration (data source, optional config overrides, custom handles)
 * @returns A fully configured OverlayLayer
 */
export function createOverlayLayer(config: OverlayLayerConfig): OverlayLayer {
  return new OverlayLayer(config);
}
